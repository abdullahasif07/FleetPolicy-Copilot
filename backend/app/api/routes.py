"""HTTP API routes."""

from __future__ import annotations

import json
import logging
import statistics
from collections import Counter
from collections.abc import AsyncIterator
from datetime import UTC, datetime
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import JSONResponse, StreamingResponse
from sqlmodel import Session, col, func, select

from app.agent.graph import NODE_LABELS, NODE_ORDER, stream_analysis
from app.agent.injection import detect_injection
from app.agent.llm import LLMUnavailableError
from app.agent.schemas import AnalysisResult
from app.api.deps import get_container, get_db, session_id
from app.api.schemas import (
    AuditEntry,
    CheckOut,
    ClientInfo,
    DecisionIn,
    DecisionOut,
    DraftIn,
    Metrics,
    NewRequestIn,
    OnboardIn,
    RequestDetail,
    RequestSummary,
)
from app.api.views import (
    analysis_out,
    decision_out,
    decisions,
    latest_analyses,
    summarize,
    warranty_status,
)
from app.container import Container
from app.data_loader import (
    load_onboarding_sample,
    load_policies,
    load_policy_text,
    load_shops,
    load_vehicles,
)
from app.db import (
    AnalysisRow,
    DecisionRow,
    OnboardedClientRow,
    RequestRow,
    UsageRow,
    request_to_row,
    reset_demo,
)
from app.guardrails.limits import LimitExceededError, check_spend_cap, record_usage, today
from app.logging_setup import log
from app.models.domain import ClientPolicy, Decision, RepairRequest, Shop, Vehicle
from app.onboarding.checks import Issue, check_policy, has_errors
from app.onboarding.drafter import DraftOut, OnboardingError, draft_policy, parse_policy_document
from app.onboarding.fleet import SAMPLE_CSV, parse_vehicles
from app.retrieval.chunker import PolicyChunk, chunk_policy

logger = logging.getLogger(__name__)
router = APIRouter()

DB = Annotated[Session, Depends(get_db)]
C = Annotated[Container, Depends(get_container)]
Status = Literal["pending", "analyzed", "decided"]


def _limits(container: Container, sid: str) -> JSONResponse | None:
    """Spend cap + per-session rate limit for anything that calls the LLM."""
    try:
        check_spend_cap(container.engine, container.settings.daily_spend_cap_usd)
        container.rate_limiter.check(sid)
    except LimitExceededError as e:
        headers = {"Retry-After": str(e.retry_after_s)} if e.retry_after_s else None
        return JSONResponse({"code": e.code, "message": e.message}, status_code=429,
                            headers=headers)
    return None


def _get_row(session: Session, request_id: str) -> RequestRow:
    row = session.get(RequestRow, request_id)
    if row is None:
        raise HTTPException(404, f"Request {request_id} not found")
    return row


# --- Queue and detail -------------------------------------------------------------------


@router.get("/requests", response_model=list[RequestSummary])
def list_requests(
    session: DB,
    status: Annotated[list[Status] | None, Query()] = None,
    client_id: Annotated[str | None, Query(max_length=10)] = None,
    q: Annotated[str | None, Query(max_length=100)] = None,
) -> list[RequestSummary]:
    stmt = select(RequestRow).order_by(col(RequestRow.submitted_at).desc())
    if status:
        stmt = stmt.where(col(RequestRow.status).in_(status))
    if client_id:
        stmt = stmt.where(RequestRow.client_id == client_id)
    rows = session.exec(stmt).all()
    ids = [r.request_id for r in rows]
    analyses, decided = latest_analyses(session, ids), decisions(session, ids)
    out = [summarize(r, analyses.get(r.request_id), decided.get(r.request_id)) for r in rows]
    if q:
        needle = q.lower()
        out = [s for s in out if needle in " ".join(
            [s.request_id, s.client_name, s.shop_name, s.vehicle_label, s.unit_number or "",
             s.headline]).lower()]
    return out


@router.get("/requests/{request_id}", response_model=RequestDetail)
def get_request(request_id: str, session: DB) -> RequestDetail:
    row = _get_row(session, request_id)
    req = RepairRequest.model_validate(row.payload)
    analysis = latest_analyses(session, [request_id]).get(request_id)
    decision = decisions(session, [request_id]).get(request_id)
    policy = load_policies()[row.client_id]
    shops = load_shops()
    vehicle = load_vehicles().get(row.vehicle_id)
    return RequestDetail(
        summary=summarize(row, analysis, decision),
        request=req,
        vehicle=vehicle,
        warranty=warranty_status(vehicle, req),
        client=ClientInfo.from_policy(policy, shops),
        shop=shops.get(row.shop_id),
        shop_is_approved=row.shop_id in policy.approved_vendors,
        injection_signals=detect_injection(req.shop_notes),
        analysis=analysis_out(analysis),
        decision=decision_out(decision),
    )


@router.post("/requests", response_model=RequestSummary, status_code=201)
def create_request(body: NewRequestIn, session: DB) -> RequestSummary:
    if body.client_id not in load_policies():
        raise HTTPException(422, f"Unknown client {body.client_id}")
    vehicle = load_vehicles().get(body.vehicle_id)
    if vehicle is None or vehicle.client_id != body.client_id:
        raise HTTPException(422, f"Vehicle {body.vehicle_id} does not belong to {body.client_id}")
    if body.shop_id not in load_shops():
        raise HTTPException(422, f"Unknown shop {body.shop_id}")
    custom_count = session.exec(
        select(func.count()).select_from(RequestRow).where(col(RequestRow.is_custom))
    ).one()
    request_id = f"R-{2001 + custom_count}"
    while session.get(RequestRow, request_id) is not None:
        custom_count += 1
        request_id = f"R-{2001 + custom_count}"
    req = RepairRequest(request_id=request_id, submitted_at=datetime.now(UTC),
                        **body.model_dump())
    row = request_to_row(req.model_dump(mode="json"), req.total, custom=True)
    session.add(row)
    session.commit()
    session.refresh(row)
    log(logger, logging.INFO, "request_created", request_id=request_id)
    return summarize(row, None, None)


# --- Analysis (SSE) ---------------------------------------------------------------------


def _sse(event: str, data: Any) -> str:
    return f"event: {event}\ndata: {json.dumps(data, default=str)}\n\n"


def _persist(container: Container, result: AnalysisResult, sid: str) -> None:
    rec, trace = result.recommendation, result.trace
    with Session(container.engine) as s:
        s.add(AnalysisRow(
            request_id=result.request_id, decision=rec.decision, llm_decision=rec.llm_decision,
            confidence=rec.confidence, overridden_by_rules=rec.overridden_by_rules,
            injection_detected=rec.injection_detected, model=trace.model,
            latency_ms=trace.latency_ms, tokens_in=trace.tokens_in, tokens_out=trace.tokens_out,
            cost_usd=trace.cost_usd, session_id=sid, result=result.model_dump(mode="json"),
        ))
        row = s.get(RequestRow, result.request_id)
        if row is not None and row.status == "pending":
            row.status = "analyzed"
            s.add(row)
        s.commit()
    record_usage(container.engine, trace.cost_usd)


@router.post("/requests/{request_id}/analyze", response_model=None)
async def analyze(
    request_id: str, request: Request, session: DB, container: C,
    stream: bool = True,
) -> StreamingResponse | JSONResponse:
    row = _get_row(session, request_id)
    payload = dict(row.payload)
    sid = session_id(request)
    if (limited := _limits(container, sid)) is not None:
        return limited
    try:
        deps = container.agent_deps()
    except LLMUnavailableError as e:
        return JSONResponse({"code": "llm_unavailable",
                             "message": f"AI analysis is unavailable: {e}."}, status_code=503)

    if not stream:
        result: AnalysisResult | None = None
        async for ev in stream_analysis(deps, payload):
            if ev["event"] == "result":
                result = ev["result"]
        assert result is not None
        _persist(container, result, sid)
        return JSONResponse(result.model_dump(mode="json"))

    async def events() -> AsyncIterator[str]:
        yield _sse("start", {"request_id": request_id,
                             "steps": [{"node": n, "label": NODE_LABELS[n]} for n in NODE_ORDER]})
        try:
            async for ev in stream_analysis(deps, payload):
                if ev["event"] == "result":
                    res: AnalysisResult = ev["result"]
                    _persist(container, res, sid)
                    yield _sse("result", res.model_dump(mode="json"))
                else:
                    yield _sse("step", ev)
        except Exception:
            logger.exception("analysis_failed")
            yield _sse("error", {"message": "Analysis failed. Please try again."})

    return StreamingResponse(events(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


# --- Human decision ---------------------------------------------------------------------


@router.post("/requests/{request_id}/decision", response_model=DecisionOut)
def decide(request_id: str, body: DecisionIn, session: DB) -> DecisionOut:
    row = _get_row(session, request_id)
    analysis = latest_analyses(session, [request_id]).get(request_id)
    if analysis is None:
        raise HTTPException(409, "Run the analysis before recording a decision.")
    if decisions(session, [request_id]).get(request_id):
        raise HTTPException(409, "A decision has already been recorded for this request.")
    is_override = body.action.value != analysis.decision
    if is_override and (body.override_reason is None or len(body.override_reason) < 5):
        raise HTTPException(422, "Overriding the AI recommendation requires a short reason "
                                 "(at least 5 characters).")
    assert analysis.id is not None
    d = DecisionRow(request_id=request_id, analysis_id=analysis.id,
                    ai_decision=analysis.decision, human_action=body.action.value,
                    is_override=is_override,
                    override_reason=body.override_reason)
    row.status = "decided"
    session.add(d)
    session.add(row)
    session.commit()
    session.refresh(d)
    log(logger, logging.INFO, "decision_recorded", request_id=request_id,
        ai=analysis.decision, human=body.action.value, override=is_override)
    out = decision_out(d)
    assert out is not None
    return out


# --- Audit and metrics ------------------------------------------------------------------


@router.get("/audit", response_model=list[AuditEntry])
def audit(session: DB, limit: Annotated[int, Query(ge=1, le=500)] = 200) -> list[AuditEntry]:
    rows = session.exec(
        select(DecisionRow).order_by(col(DecisionRow.decided_at).desc()).limit(limit)
    ).all()
    policies = load_policies()
    out = []
    for d in rows:
        a = session.get(AnalysisRow, d.analysis_id)
        r = session.get(RequestRow, d.request_id)
        if a is None or r is None:
            continue
        out.append(AuditEntry(
            request_id=d.request_id, client_name=policies[r.client_id].name, total=r.total,
            ai_decision=Decision(d.ai_decision), ai_confidence=a.confidence,
            human_action=Decision(d.human_action), is_override=d.is_override,
            override_reason=d.override_reason, decided_at=d.decided_at, model=a.model,
            cost_usd=a.cost_usd, injection_detected=a.injection_detected,
        ))
    return out


def _pct(values: list[float], q: float) -> float | None:
    if not values:
        return None
    if len(values) == 1:
        return values[0]
    return round(statistics.quantiles(values, n=100, method="inclusive")[int(q) - 1], 1)


@router.get("/metrics", response_model=Metrics)
def metrics(session: DB, container: C) -> Metrics:
    all_runs = session.exec(select(AnalysisRow)).all()
    latest = latest_analyses(session)
    decided = list(decisions(session).values())
    total_requests = session.exec(select(func.count()).select_from(RequestRow)).one()
    latencies = [a.latency_ms for a in all_runs]
    usage_today = session.get(UsageRow, today())
    ai_mix = Counter(a.decision for a in latest.values())
    overrides = [d for d in decided if d.is_override]
    usage = {
        "total_requests": total_requests,
        "analyzed_requests": len(latest),
        "analysis_runs": len(all_runs),
        "decided_requests": len(decided),
        "agreement_rate": (round(1 - len(overrides) / len(decided), 3) if decided else None),
        "override_count": len(overrides),
        "override_pairs": dict(Counter(f"{d.ai_decision}->{d.human_action}" for d in overrides)),
        "escalation_rate": (round(ai_mix.get("ESCALATE", 0) / len(latest), 3) if latest
                            else None),
        "ai_decision_mix": dict(ai_mix),
        "human_decision_mix": dict(Counter(d.human_action for d in decided)),
        "avg_latency_ms": round(statistics.fmean(latencies), 1) if latencies else None,
        "p50_latency_ms": _pct(latencies, 50),
        "p95_latency_ms": _pct(latencies, 95),
        "avg_cost_usd": (round(statistics.fmean(a.cost_usd for a in all_runs), 6)
                         if all_runs else None),
        "total_cost_usd": round(sum(a.cost_usd for a in all_runs), 6),
        "spend_today_usd": round(usage_today.spend_usd, 6) if usage_today else 0.0,
        "daily_spend_cap_usd": container.settings.daily_spend_cap_usd,
        "injections_flagged": sum(1 for a in latest.values() if a.injection_detected),
        "rule_overrides_of_ai": sum(1 for a in latest.values() if a.overridden_by_rules),
    }
    evals = None
    path = container.settings.evals_results_path
    if path.exists():
        evals = json.loads(path.read_text(encoding="utf-8"))
    return Metrics(usage=usage, evals=evals)


# --- Reference data (used by the UI) ----------------------------------------------------


@router.get("/clients", response_model=list[ClientInfo])
def clients() -> list[ClientInfo]:
    shops = load_shops()
    return [ClientInfo.from_policy(p, shops) for p in load_policies().values()]


@router.get("/policies/{client_id}")
def policy(client_id: str) -> dict[str, Any]:
    if client_id not in load_policies():
        raise HTTPException(404, f"Unknown client {client_id}")
    text = load_policy_text(client_id)
    return {
        "client_id": client_id,
        "name": load_policies()[client_id].name,
        "markdown": text,
        "sections": [c.model_dump() for c in chunk_policy(client_id, text)],
    }


@router.get("/vehicles", response_model=list[Vehicle])
def vehicles(client_id: Annotated[str | None, Query(max_length=10)] = None) -> list[Vehicle]:
    return [v for v in load_vehicles().values() if client_id is None or v.client_id == client_id]


@router.get("/shops", response_model=list[Shop])
def shops() -> list[Shop]:
    return list(load_shops().values())


@router.get("/health")
def health(container: C) -> dict[str, Any]:
    s = container.settings
    return {"status": "ok", "llm_configured": s.has_openai_key, "model": s.llm_model,
            "fallback_model": s.llm_fallback_model, "embedding_model": s.embedding_model,
            "tracing": s.langsmith_tracing}


@router.post("/demo/reset")
def demo_reset(container: C) -> dict[str, str]:
    container.unindex_clients(reset_demo(container.engine))
    return {"status": "reset"}


# --- Client onboarding ------------------------------------------------------------------


def _error(status: int, code: str, message: str, **extra: Any) -> JSONResponse:
    return JSONResponse({"code": code, "message": message, **extra}, status_code=status)


@router.get("/onboarding/sample")
def onboarding_sample() -> dict[str, str]:
    """A fictional policy and vehicle list to try onboarding with."""
    return {"policy_markdown": load_onboarding_sample(), "vehicles_csv": SAMPLE_CSV}


@router.post("/onboarding/parse", response_model=None)
def onboarding_parse(body: DraftIn) -> JSONResponse | dict[str, Any]:
    """Read the client ID and sections without the AI (for filling the form by hand)."""
    try:
        client_id, chunks = parse_policy_document(body.policy_markdown)
    except OnboardingError as e:
        return _error(422, "invalid_policy", str(e))
    if client_id in load_policies():
        return _error(422, "invalid_policy", f"A client with ID {client_id} already exists.")
    return {"client_id": client_id, "sections": [c.model_dump() for c in chunks]}


@router.post("/onboarding/draft", response_model=DraftOut)
async def onboarding_draft(body: DraftIn, request: Request,
                           container: C) -> DraftOut | JSONResponse:
    """Have the AI propose structured settings from a policy document (nothing is saved)."""
    try:
        parse_policy_document(body.policy_markdown)
    except OnboardingError as e:
        return _error(422, "invalid_policy", str(e))
    if (limited := _limits(container, session_id(request))) is not None:
        return limited
    try:
        out = await draft_policy(container.drafter(), body.policy_markdown, load_shops(),
                                 set(load_policies()))
    except OnboardingError as e:
        return _error(422, "invalid_policy", str(e))
    except LLMUnavailableError as e:
        return _error(503, "llm_unavailable",
                      f"AI drafting is unavailable ({e}). You can still fill in the form.")
    record_usage(container.engine, out.cost_usd)
    log(logger, logging.INFO, "onboarding_drafted", client_id=out.client_id, model=out.model,
        issues=len(out.issues), cost_usd=out.cost_usd)
    return out


def _check(body: OnboardIn) -> tuple[list[Issue], list[PolicyChunk], list[Vehicle]]:
    try:
        client_id, chunks = parse_policy_document(body.policy_markdown)
    except OnboardingError as e:
        return [Issue(field="policy_markdown", level="error", message=str(e))], [], []
    issues = check_policy(body.policy, chunks, load_shops(), set(load_policies()))
    if body.policy.client_id != client_id:
        issues.insert(0, Issue(field="client_id", level="error",
                               message=f"The policy's sections use {client_id}, not "
                                       f"{body.policy.client_id}."))
    vehicles: list[Vehicle] = []
    try:
        vehicles = parse_vehicles(client_id, body.vehicles_csv)
    except OnboardingError as e:
        issues.append(Issue(field="vehicles", level="error", message=str(e)))
    return issues, chunks, vehicles


@router.post("/onboarding/check", response_model=CheckOut)
def onboarding_check(body: OnboardIn) -> CheckOut:
    """Re-run the deterministic checks while the reviewer edits the draft."""
    issues, chunks, vehicles = _check(body)
    return CheckOut(client_id=chunks[0].client_id if chunks else None, issues=issues,
                    vehicle_count=len(vehicles))


@router.post("/clients", response_model=ClientInfo, status_code=201)
def create_client(body: OnboardIn, session: DB, container: C) -> ClientInfo | JSONResponse:
    """Save a reviewed client: settings, policy text (indexed for search) and vehicles."""
    issues, chunks, vehicles = _check(body)
    if has_errors(issues):
        return _error(422, "invalid_client", "Fix the highlighted problems before saving.",
                      issues=[i.model_dump() for i in issues])
    policy = ClientPolicy.model_validate(
        body.policy.model_dump() | {"policy_file": f"onboarded:{body.policy.client_id}"})
    try:
        container.index_client(policy.client_id, chunks)
    except LLMUnavailableError as e:
        return _error(503, "llm_unavailable", f"Couldn't index the policy for search ({e}).")
    row = OnboardedClientRow(client_id=policy.client_id, policy_markdown=body.policy_markdown,
                             policy=policy.model_dump(mode="json"),
                             vehicles=[v.model_dump(mode="json") for v in vehicles])
    session.add(row)
    session.commit()
    row.register()
    log(logger, logging.INFO, "client_onboarded", client_id=policy.client_id,
        sections=len(chunks), vehicles=len(vehicles))
    return ClientInfo.from_policy(policy, load_shops())
