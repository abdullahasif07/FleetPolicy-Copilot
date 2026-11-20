"""LangGraph workflow:

parse_request -> load_context -> retrieve_policy -> rule_check -> reason -> validate
"""

from __future__ import annotations

import asyncio
import itertools
import logging
import operator
import time
import uuid
from collections.abc import AsyncIterator, Awaitable, Callable
from dataclasses import dataclass
from typing import Annotated, Any, TypedDict

from langgraph.graph import END, START, StateGraph

from app.agent import tools
from app.agent.injection import detect_injection
from app.agent.llm import LLMClient, LLMResponse, LLMUnavailableError
from app.agent.prompts import build_messages
from app.agent.schemas import AnalysisResult, Recommendation, TraceMeta
from app.agent.validator import validate
from app.config import estimate_cost
from app.logging_setup import log
from app.models.domain import ClientPolicy, RepairRequest, RuleResult, Shop, Vehicle
from app.retrieval.index import PolicyIndex, RetrievedChunk
from app.rules.engine import evaluate

logger = logging.getLogger(__name__)

NODE_ORDER = ["parse_request", "load_context", "retrieve_policy", "rule_check", "reason",
              "validate"]
NODE_LABELS = {
    "parse_request": "Reading request",
    "load_context": "Loading vehicle and client records",
    "retrieve_policy": "Retrieving policy",
    "rule_check": "Checking rules",
    "reason": "Reasoning",
    "validate": "Validating citations",
}


def _merge(a: dict[str, float], b: dict[str, float]) -> dict[str, float]:
    return {**a, **b}


class GraphState(TypedDict, total=False):
    raw: dict[str, Any]
    request: RepairRequest
    injection_signals: list[str]
    vehicle: Vehicle | None
    policy: ClientPolicy
    shop: Shop | None
    retrieved: list[RetrievedChunk]
    rule_result: RuleResult
    llm: LLMResponse | None
    llm_error: str | None
    recommendation: Recommendation
    embedding_tokens: Annotated[int, operator.add]
    step_ms: Annotated[dict[str, float], _merge]


@dataclass
class AgentDeps:
    index: PolicyIndex
    llm: LLMClient
    top_k: int = 6


Node = Callable[[GraphState], Awaitable[dict[str, Any]]]


def _timed(name: str, fn: Node) -> Node:
    async def wrapper(state: GraphState) -> dict[str, Any]:
        t0 = time.perf_counter()
        update = await fn(state)
        update["step_ms"] = {name: round((time.perf_counter() - t0) * 1000, 1)}
        return update

    return wrapper


def build_graph(deps: AgentDeps) -> Any:
    async def parse_request(state: GraphState) -> dict[str, Any]:
        req = RepairRequest.model_validate(state["raw"])
        return {"request": req, "injection_signals": detect_injection(req.shop_notes)}

    async def load_context(state: GraphState) -> dict[str, Any]:
        req = state["request"]
        policy = tools.get_client_policy(req.client_id)
        if policy is None:
            raise ValueError(f"unknown client {req.client_id}")
        return {"vehicle": tools.get_vehicle(req.vehicle_id), "policy": policy,
                "shop": tools.get_shop(req.shop_id)}

    async def retrieve_policy(state: GraphState) -> dict[str, Any]:
        req = state["request"]
        # Built from structured fields only: untrusted shop notes never steer retrieval.
        terms = [f"{li.description} {li.category or ''}" for li in req.line_items]
        query = " ".join(terms) + " approval limit warranty vendor"
        hits, tokens = await asyncio.to_thread(deps.index.search, req.client_id, query,
                                             deps.top_k)
        return {"retrieved": hits, "embedding_tokens": tokens}

    async def rule_check(state: GraphState) -> dict[str, Any]:
        req, policy = state["request"], state["policy"]
        result = evaluate(req, state["vehicle"], policy, tools.get_parts_reference())
        retrieved = list(state["retrieved"])
        have = {c.chunk.section_id for c in retrieved}
        pin = [f.section_id for f in result.flags]
        if state["injection_signals"]:
            pin.append(f"{policy.client_id}-10.1")
        for section_id in pin:
            chunk = deps.index.get_section(section_id)
            if chunk and section_id not in have:
                retrieved.append(RetrievedChunk(chunk=chunk, score=0.0, source="rule"))
                have.add(section_id)
        return {"rule_result": result, "retrieved": retrieved}

    async def reason(state: GraphState) -> dict[str, Any]:
        messages = build_messages(state["request"], state["vehicle"], state["policy"],
                                  state["shop"], state["rule_result"], state["retrieved"])
        try:
            return {"llm": await deps.llm.recommend(messages), "llm_error": None}
        except LLMUnavailableError as e:
            log(logger, logging.ERROR, "llm_unavailable", error=str(e))
            return {"llm": None, "llm_error": str(e)}

    async def validate_node(state: GraphState) -> dict[str, Any]:
        llm = state.get("llm")
        rec = validate(llm.parsed if llm else None, state["rule_result"], state["retrieved"],
                       state["injection_signals"])
        return {"recommendation": rec}

    nodes: dict[str, Node] = {
        "parse_request": parse_request, "load_context": load_context,
        "retrieve_policy": retrieve_policy, "rule_check": rule_check, "reason": reason,
        "validate": validate_node,
    }
    g = StateGraph(GraphState)
    for name, fn in nodes.items():
        g.add_node(name, _timed(name, fn))  # type: ignore[call-overload]
    g.add_edge(START, NODE_ORDER[0])
    for a, b in itertools.pairwise(NODE_ORDER):
        g.add_edge(a, b)
    g.add_edge(NODE_ORDER[-1], END)
    return g.compile()


def _result(state: GraphState, run_id: str, started: float) -> AnalysisResult:
    llm = state.get("llm")
    tokens_in = llm.tokens_in if llm else 0
    tokens_out = llm.tokens_out if llm else 0
    emb = state.get("embedding_tokens", 0)
    cost = (estimate_cost(llm.model, tokens_in, tokens_out) if llm else 0.0) + estimate_cost(
        "text-embedding-3-small", emb, 0)
    trace = TraceMeta(
        run_id=run_id,
        model=llm.model if llm else None,
        fallback_used=llm.fallback_used if llm else False,
        latency_ms=round((time.perf_counter() - started) * 1000, 1),
        step_latency_ms=state.get("step_ms", {}),
        tokens_in=tokens_in, tokens_out=tokens_out, embedding_tokens=emb,
        cost_usd=round(cost, 6),
        retrieved_sections=[c.chunk.section_id for c in state["retrieved"]],
        error=state.get("llm_error"),
    )
    return AnalysisResult(request_id=state["request"].request_id,
                          recommendation=state["recommendation"], trace=trace,
                          retrieved=state["retrieved"])


async def stream_analysis(
    deps: AgentDeps, raw_request: dict[str, Any]
) -> AsyncIterator[dict[str, Any]]:
    """Yield progress events, then a final ``result`` event with the AnalysisResult."""
    graph = build_graph(deps)
    run_id = str(uuid.uuid4())
    started = time.perf_counter()
    state: dict[str, Any] = {}
    yield {"event": "step", "node": NODE_ORDER[0], "label": NODE_LABELS[NODE_ORDER[0]],
           "status": "running"}
    config = {"run_name": "fleetpolicy-analysis", "metadata": {"run_id": run_id},
              "tags": ["fleetpolicy"]}
    async for update in graph.astream({"raw": raw_request, "embedding_tokens": 0,
                                       "step_ms": {}}, config=config, stream_mode="updates"):
        for node, delta in update.items():
            for key, value in delta.items():
                if key == "step_ms":
                    state["step_ms"] = {**state.get("step_ms", {}), **value}
                elif key == "embedding_tokens":
                    state["embedding_tokens"] = state.get("embedding_tokens", 0) + value
                else:
                    state[key] = value
            yield {"event": "step", "node": node, "label": NODE_LABELS[node], "status": "done",
                   "ms": state["step_ms"].get(node)}
            idx = NODE_ORDER.index(node)
            if idx + 1 < len(NODE_ORDER):
                nxt = NODE_ORDER[idx + 1]
                yield {"event": "step", "node": nxt, "label": NODE_LABELS[nxt],
                       "status": "running"}
    result = _result(state, run_id, started)  # type: ignore[arg-type]
    log(logger, logging.INFO, "analysis_complete", request_id=result.request_id,
        decision=result.recommendation.decision, latency_ms=result.trace.latency_ms,
        cost_usd=result.trace.cost_usd, model=result.trace.model)
    yield {"event": "result", "result": result}


async def run_analysis(deps: AgentDeps, raw_request: dict[str, Any]) -> AnalysisResult:
    result: AnalysisResult | None = None
    async for event in stream_analysis(deps, raw_request):
        if event["event"] == "result":
            result = event["result"]
    assert result is not None
    return result
