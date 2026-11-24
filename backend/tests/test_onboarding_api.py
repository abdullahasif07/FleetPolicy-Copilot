"""Client onboarding over HTTP: draft -> review/check -> save -> use -> reset."""

from __future__ import annotations

from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.agent.llm import LLMUnavailableError, failing_llm
from app.data_loader import registered_client_ids, unregister_client
from app.db import UsageRow
from app.guardrails.limits import today
from app.models.domain import Decision
from app.onboarding.fleet import SAMPLE_CSV
from app.retrieval.index import current_index
from tests.conftest import citing_llm
from tests.test_api import SESSION, analyze, build
from tests.test_onboarding_draft import sample_draft, sample_markdown


@pytest.fixture(autouse=True)
def _clean_registry() -> Iterator[None]:
    yield
    index = current_index()
    for cid in registered_client_ids():
        unregister_client(cid)
        if index is not None:
            index.remove_client(cid)


def drafting_client(tmp_path: Path) -> TestClient:
    llm = citing_llm(Decision.APPROVE)
    llm.structured_script = lambda _: sample_draft()
    c, _ = build(tmp_path, llm=llm)
    return c


@pytest.fixture
def client(tmp_path: Path) -> Iterator[TestClient]:
    with drafting_client(tmp_path) as c:
        yield c


def onboard_body(client: TestClient) -> dict[str, Any]:
    r = client.post("/onboarding/draft", json={"policy_markdown": sample_markdown()},
                    headers=SESSION)
    assert r.status_code == 200, r.text
    return {"policy_markdown": sample_markdown(), "policy": r.json()["policy"],
            "vehicles_csv": SAMPLE_CSV}


def test_sample_endpoint(client: TestClient) -> None:
    body = client.get("/onboarding/sample").json()
    assert "### LL-2.1" in body["policy_markdown"]
    assert body["vehicles_csv"].startswith("unit_number,")


def test_parse_reads_sections_without_the_llm(client: TestClient) -> None:
    out = client.post("/onboarding/parse", json={"policy_markdown": sample_markdown()}).json()
    assert out["client_id"] == "LL" and len(out["sections"]) == 16
    nw = client.post("/onboarding/parse", json={"policy_markdown": "### NW-1.1 A\nx\n"
                                                "### NW-1.2 B\ny\n### NW-1.3 C\nz"})
    assert nw.status_code == 422 and "already exists" in nw.json()["message"]


def test_draft_returns_reviewable_settings_without_saving(client: TestClient) -> None:
    r = client.post("/onboarding/draft", json={"policy_markdown": sample_markdown()},
                    headers=SESSION)
    assert r.status_code == 200
    out = r.json()
    assert out["client_id"] == "LL" and out["issues"] == []
    assert out["policy"]["category_limits"] == {"tires": 1200.0, "brakes": 1200.0}
    assert out["sections"][0]["section_id"] == "LL-1.1"
    assert [c["client_id"] for c in client.get("/clients").json()] == ["NW", "CV", "HF", "SH"]


def test_draft_rejects_unstructured_documents_before_calling_the_llm(tmp_path: Path) -> None:
    llm = citing_llm()
    c, _ = build(tmp_path, llm=llm)
    with c:
        r = c.post("/onboarding/draft", json={"policy_markdown": "Just some prose."},
                   headers=SESSION)
    assert r.status_code == 422 and r.json()["code"] == "invalid_policy"
    assert llm.calls == []


def test_draft_is_rate_limited_and_counts_towards_spend(tmp_path: Path) -> None:
    llm = citing_llm()
    llm.structured_script = lambda _: sample_draft()
    c, container = build(tmp_path, llm=llm, rate=1)
    with c:
        body = {"policy_markdown": sample_markdown()}
        assert c.post("/onboarding/draft", json=body, headers=SESSION).status_code == 200
        assert c.post("/onboarding/draft", json=body, headers=SESSION).status_code == 429
    from sqlmodel import Session
    with Session(container.engine) as s:
        assert s.get(UsageRow, today()) is not None


def test_draft_degrades_gracefully_without_an_llm(tmp_path: Path) -> None:
    c, _ = build(tmp_path, llm=failing_llm(LLMUnavailableError("no key")))
    with c:
        r = c.post("/onboarding/draft", json={"policy_markdown": sample_markdown()},
                   headers=SESSION)
    assert r.status_code == 503 and "fill in the form" in r.json()["message"]


def test_check_reports_errors_while_editing(client: TestClient) -> None:
    body = onboard_body(client)
    body["policy"]["client_id"] = "ZZ"
    body["policy"]["sections"].pop("labor_cap")
    body["vehicles_csv"] = "unit_number,make\n"
    out = client.post("/onboarding/check", json=body).json()
    fields = {i["field"] for i in out["issues"] if i["level"] == "error"}
    assert {"client_id", "sections.labor_cap", "vehicles"} <= fields
    assert out["vehicle_count"] == 0


def test_onboarded_client_works_end_to_end(client: TestClient) -> None:
    r = client.post("/clients", json=onboard_body(client))
    assert r.status_code == 201, r.text
    assert r.json()["onboarded"] is True

    clients = {c["client_id"]: c for c in client.get("/clients").json()}
    assert clients["LL"]["auto_approve_limit"] == 750.0 and not clients["NW"]["onboarded"]
    doc = client.get("/policies/LL").json()
    assert doc["sections"][0]["section_id"] == "LL-1.1"
    vehicles = client.get("/vehicles", params={"client_id": "LL"}).json()
    assert [v["unit_number"] for v in vehicles] == ["LL-501", "LL-502", "LL-503"]

    # A $1,000 tyre job: over the $750 standard limit, but within the $1,200 tyre limit.
    new = client.post("/requests", json={
        "client_id": "LL", "vehicle_id": "V-LL-01", "shop_id": "S03", "odometer": 61900,
        "quotes_count": 1, "shop_notes": "",
        "line_items": [{"description": "Four drive tyres", "category": "tires",
                        "part_code": None, "quantity": 4, "part_cost": 760,
                        "labor_hours": 2, "labor_rate": 120}],
    })
    assert new.status_code == 201, new.text
    result = analyze(client, new.json()["request_id"])
    rec = result["recommendation"]
    assert rec["decision"] == "APPROVE"
    assert all(r["citation_section_id"].startswith("LL-") for r in rec["reasons"])
    assert {c["chunk"]["client_id"] for c in result["retrieved"]} == {"LL"}
    assert any(f["section_id"] == "LL-2.2" and f["rule"] == "WITHIN_LIMIT"
               for f in rec["rule_flags"])


def test_save_rejects_invalid_or_duplicate_clients(client: TestClient) -> None:
    body = onboard_body(client)
    bad = {**body, "policy": {**body["policy"], "approved_vendors": []}}
    r = client.post("/clients", json=bad)
    assert r.status_code == 422 and r.json()["code"] == "invalid_client"
    assert any(i["field"] == "approved_vendors" for i in r.json()["issues"])

    assert client.post("/clients", json=body).status_code == 201
    again = client.post("/clients", json=body)
    assert again.status_code == 422
    assert any("already exists" in i["message"] for i in again.json()["issues"])


def test_onboarded_clients_survive_a_restart_and_reset_removes_them(tmp_path: Path) -> None:
    with drafting_client(tmp_path) as c:
        assert c.post("/clients", json=onboard_body(c)).status_code == 201
    unregister_client("LL")  # simulate a fresh process

    with drafting_client(tmp_path) as c:
        assert "LL" in [x["client_id"] for x in c.get("/clients").json()]
        analyze(c, "R-1001")  # builds the index, which now includes LL
        index = current_index()
        assert index is not None and index.sections_for("LL")

        assert c.post("/demo/reset").status_code == 200
        assert "LL" not in [x["client_id"] for x in c.get("/clients").json()]
        assert index.sections_for("LL") == []
        assert c.get("/policies/LL").status_code == 404
