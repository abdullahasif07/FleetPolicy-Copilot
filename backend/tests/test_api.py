from __future__ import annotations

import json
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.agent.llm import LLMClient
from app.config import Settings
from app.container import Container
from app.db import UsageRow, make_engine
from app.guardrails.limits import RateLimiter, today
from app.main import create_app
from app.models.domain import Decision
from app.retrieval.embeddings import HashEmbedder
from tests.conftest import citing_llm, hash_index

SESSION = {"X-Session-ID": "test-session-0001"}


def build(tmp_path: Path, llm: LLMClient | None = None, rate: int = 50,
          cap: float = 5.0) -> tuple[TestClient, Container]:
    settings = Settings(_env_file=None, database_url=f"sqlite:///{tmp_path}/t.db",
                        daily_spend_cap_usd=cap, evals_results_path=tmp_path / "results.json")
    container = Container(settings=settings, engine=make_engine(settings.database_url),
                          rate_limiter=RateLimiter(rate),
                          llm_factory=lambda: llm or citing_llm(Decision.ESCALATE),
                          embedder_factory=HashEmbedder)
    hash_index()  # warm shared test index
    return TestClient(create_app(container)), container


@pytest.fixture
def client(tmp_path: Path) -> Iterator[TestClient]:
    c, _ = build(tmp_path)
    with c:
        yield c


def sse_events(text: str) -> list[tuple[str, Any]]:
    out = []
    for block in text.strip().split("\n\n"):
        lines = dict(line.split(": ", 1) for line in block.splitlines())
        out.append((lines["event"], json.loads(lines["data"])))
    return out


def analyze(client: TestClient, rid: str) -> dict[str, Any]:
    r = client.post(f"/requests/{rid}/analyze", headers=SESSION)
    assert r.status_code == 200, r.text
    events = sse_events(r.text)
    assert events[-1][0] == "result", events[-1]
    result: dict[str, Any] = events[-1][1]
    return result


def test_queue_lists_seeded_requests_with_filters(client: TestClient) -> None:
    rows = client.get("/requests").json()
    assert len(rows) == 40 and {r["status"] for r in rows} == {"pending"}
    assert all(r["client_id"] == "HF" for r in client.get("/requests?client_id=HF").json())
    found = client.get("/requests", params={"q": "lakeshore"}).json()
    assert found and all(r["shop_name"] == "Lakeshore EV Works" for r in found)
    flagged = {r["request_id"] for r in rows if r["injection_flag"]}
    assert flagged == {"R-1010", "R-1030", "R-1040"}


def test_status_filter_validates_input(client: TestClient) -> None:
    assert client.get("/requests?status=bogus").status_code == 422


def test_detail_includes_vehicle_client_and_warranty(client: TestClient) -> None:
    d = client.get("/requests/R-1004").json()
    assert d["vehicle"]["vehicle_id"] == "V-NW-04"
    assert d["client"]["auto_approve_limit"] == 500
    assert {w["name"]: w["active"] for w in d["warranty"]} == {"Basic": False,
                                                              "Powertrain": True}
    assert d["analysis"] is None and d["shop_is_approved"]
    assert client.get("/requests/R-0000").status_code == 404


def test_analyze_streams_steps_and_persists(client: TestClient) -> None:
    r = client.post("/requests/R-1005/analyze", headers=SESSION)
    assert r.headers["content-type"].startswith("text/event-stream")
    events = sse_events(r.text)
    assert events[0][0] == "start"
    assert [e[1]["node"] for e in events if e[0] == "step" and e[1]["status"] == "done"][-1] \
        == "validate"
    result = events[-1][1]
    assert result["recommendation"]["decision"] == "DECLINE"  # exclusion rule overrides
    detail = client.get("/requests/R-1005").json()
    assert detail["summary"]["status"] == "analyzed"
    assert detail["analysis"]["recommendation"]["decision"] == "DECLINE"


def test_analyze_non_streaming_json(client: TestClient) -> None:
    r = client.post("/requests/R-1001/analyze?stream=false", headers=SESSION)
    assert r.status_code == 200 and r.json()["trace"]["run_id"]


def test_decision_requires_analysis_and_override_reason(client: TestClient) -> None:
    assert client.post("/requests/R-1002/decision", json={"action": "APPROVE"}).status_code == 409
    ai = analyze(client, "R-1002")["recommendation"]["decision"]
    assert ai == "ESCALATE"
    r = client.post("/requests/R-1002/decision", json={"action": "APPROVE"})
    assert r.status_code == 422 and "reason" in r.json()["detail"]
    r = client.post("/requests/R-1002/decision",
                    json={"action": "APPROVE", "override_reason": "Manager approved by phone"})
    assert r.status_code == 200 and r.json()["is_override"]
    assert client.post("/requests/R-1002/decision",
                       json={"action": "DECLINE", "override_reason": "changed mind"}
                       ).status_code == 409
    assert client.get("/requests/R-1002").json()["summary"]["status"] == "decided"


def test_accepting_ai_needs_no_reason_and_shows_in_audit_and_metrics(client: TestClient) -> None:
    analyze(client, "R-1006")
    assert client.post("/requests/R-1006/decision", json={"action": "DECLINE"}).status_code == 200
    audit = client.get("/audit").json()
    assert audit[0]["request_id"] == "R-1006" and not audit[0]["is_override"]
    m = client.get("/metrics").json()
    assert m["usage"]["agreement_rate"] == 1.0 and m["usage"]["decided_requests"] == 1
    assert m["evals"] is None


def test_decision_body_is_validated(client: TestClient) -> None:
    analyze(client, "R-1001")
    assert client.post("/requests/R-1001/decision", json={"action": "MAYBE"}).status_code == 422
    assert client.post("/requests/R-1001/decision",
                       json={"action": "APPROVE", "extra": 1}).status_code == 422


def test_create_custom_request(client: TestClient) -> None:
    body = {"client_id": "SH", "vehicle_id": "V-SH-03", "shop_id": "S05", "odometer": 104900,
            "line_items": [{"description": "Replace wiper blades", "category": "glass",
                            "part_cost": 30, "labor_hours": 0.2, "labor_rate": 120}]}
    r = client.post("/requests", json=body)
    assert r.status_code == 201 and r.json()["request_id"] == "R-2001"
    assert r.json()["total"] == 54.0
    assert client.post("/requests", json=body).json()["request_id"] == "R-2002"
    bad = dict(body, vehicle_id="V-NW-01")
    assert client.post("/requests", json=bad).status_code == 422
    assert client.post("/requests", json=dict(body, line_items=[])).status_code == 422


def test_rate_limit_returns_friendly_429(tmp_path: Path) -> None:
    c, _ = build(tmp_path, rate=1)
    with c:
        assert c.post("/requests/R-1001/analyze", headers=SESSION).status_code == 200
        r = c.post("/requests/R-1003/analyze", headers=SESSION)
        assert r.status_code == 429 and r.json()["code"] == "rate_limited"
        assert "Retry-After" in r.headers
        other = {"X-Session-ID": "another-session-02"}
        assert c.post("/requests/R-1003/analyze", headers=other).status_code == 200


def test_daily_spend_cap(tmp_path: Path) -> None:
    from sqlmodel import Session
    c, container = build(tmp_path, cap=0.01)
    with c:
        with Session(container.engine) as s:
            s.add(UsageRow(day=today(), spend_usd=0.02, analyses=5))
            s.commit()
        r = c.post("/requests/R-1001/analyze", headers=SESSION)
        assert r.status_code == 429 and r.json()["code"] == "spend_cap"


def test_missing_api_key_gives_503(tmp_path: Path) -> None:
    settings = Settings(_env_file=None, openai_api_key=None,
                        database_url=f"sqlite:///{tmp_path}/k.db")
    container = Container(settings=settings, engine=make_engine(settings.database_url),
                          rate_limiter=RateLimiter(10))
    with TestClient(create_app(container)) as c:
        r = c.post("/requests/R-1001/analyze", headers=SESSION)
        assert r.status_code == 503 and r.json()["code"] == "llm_unavailable"
        assert c.get("/health").json()["llm_configured"] is False


def test_cors_locked_to_frontend_origin(client: TestClient) -> None:
    ok = client.options("/requests", headers={"Origin": "http://localhost:3000",
                                              "Access-Control-Request-Method": "GET"})
    assert ok.headers.get("access-control-allow-origin") == "http://localhost:3000"
    bad = client.options("/requests", headers={"Origin": "https://evil.example",
                                               "Access-Control-Request-Method": "GET"})
    assert "access-control-allow-origin" not in bad.headers


def test_request_id_header(client: TestClient) -> None:
    assert client.get("/health").headers["X-Request-ID"]
    assert client.get("/health", headers={"X-Request-ID": "abc123"}).headers["X-Request-ID"] \
        == "abc123"


def test_policy_and_reference_endpoints(client: TestClient) -> None:
    p = client.get("/policies/SH").json()
    assert any(s["section_id"] == "SH-3.2" for s in p["sections"])
    assert client.get("/policies/XX").status_code == 404
    assert len(client.get("/clients").json()) == 4
    assert len(client.get("/vehicles?client_id=CV").json()) == 7


def test_demo_reset(client: TestClient) -> None:
    analyze(client, "R-1001")
    client.post("/requests", json={"client_id": "NW", "vehicle_id": "V-NW-01", "shop_id": "S01",
                                   "line_items": [{"description": "x", "category": "brakes",
                                                   "part_cost": 1, "labor_hours": 0,
                                                   "labor_rate": 0}]})
    assert client.post("/demo/reset").status_code == 200
    rows = client.get("/requests").json()
    assert len(rows) == 40 and all(r["status"] == "pending" for r in rows)
