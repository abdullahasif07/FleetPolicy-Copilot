from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

import pytest

from app.data_loader import load_parts, load_policies, load_vehicles
from app.models.domain import RepairRequest, RuleResult
from app.rules.engine import evaluate


def make_request(**overrides: Any) -> RepairRequest:
    base: dict[str, Any] = {
        "request_id": "T-1",
        "client_id": "NW",
        "vehicle_id": "V-NW-01",
        "shop_id": "S01",
        "submitted_at": datetime(2026, 11, 15, 9, 0, tzinfo=UTC),
        "odometer": 98400,
        "quotes_count": None,
        "line_items": [
            {"description": "Replace front brake pads", "category": "brakes",
             "part_code": "P-BRK-PAD-LD", "quantity": 1, "part_cost": 85,
             "labor_hours": 1.5, "labor_rate": 125}
        ],
        "shop_notes": "",
    }
    base.update(overrides)
    return RepairRequest.model_validate(base)


def run_rules(req: RepairRequest) -> RuleResult:
    return evaluate(req, load_vehicles().get(req.vehicle_id), load_policies()[req.client_id],
                    load_parts())


@pytest.fixture
def item() -> Any:
    def _item(**kw: Any) -> dict[str, Any]:
        d: dict[str, Any] = {"description": "Work", "category": "brakes", "part_code": None,
                             "quantity": 1, "part_cost": 100, "labor_hours": 1, "labor_rate": 100}
        d.update(kw)
        return d
    return _item


# --- Agent / API fixtures (no network, no API key) -------------------------------------

import chromadb  # noqa: E402
from chromadb.config import Settings as ChromaSettings  # noqa: E402

from app.agent.graph import AgentDeps  # noqa: E402
from app.agent.llm import LLMClient, Messages, ScriptedLLM  # noqa: E402
from app.agent.schemas import LLMReason, LLMRecommendation  # noqa: E402
from app.models.domain import Decision  # noqa: E402
from app.retrieval.embeddings import HashEmbedder  # noqa: E402
from app.retrieval.index import PolicyIndex, load_all_chunks  # noqa: E402

_INDEX: PolicyIndex | None = None


def hash_index() -> PolicyIndex:
    global _INDEX
    if _INDEX is None:
        client = chromadb.EphemeralClient(settings=ChromaSettings(anonymized_telemetry=False))
        _INDEX = PolicyIndex(HashEmbedder(), client, load_all_chunks())
    return _INDEX


def rec(decision: Decision, reasons: list[tuple[str, str]] | None = None,
        confidence: float = 0.8, injection: bool = False) -> LLMRecommendation:
    return LLMRecommendation(
        decision=decision, confidence=confidence, summary=f"Scripted {decision}.",
        reasons=[LLMReason(text="because", citation_section_id=s, quoted_clause=q)
                 for s, q in (reasons or [])],
        warranty_opportunity=False, estimated_savings=0.0, injection_suspected=injection,
    )


def section_sentence(section_id: str, index: int = 0) -> str:
    from app.retrieval.chunker import split_sentences
    from app.retrieval.index import current_index
    chunk = hash_index().get_section(section_id)
    if chunk is None and (live := current_index()) is not None:  # e.g. onboarded clients
        chunk = live.get_section(section_id)
    assert chunk is not None
    return split_sentences(chunk.text)[index]


def citing_llm(decision: Decision = Decision.APPROVE) -> ScriptedLLM:
    """Fake LLM that cites the first sentence of the first clause it was shown."""
    import re

    def script(messages: Messages) -> LLMRecommendation:
        user = messages[1]["content"]
        m = re.search(r'<clause section_id="([A-Z]{2}-\d+\.\d+)"', user)
        assert m
        return rec(decision, [(m.group(1), section_sentence(m.group(1)))])

    return ScriptedLLM(script)


def agent_deps(llm: LLMClient) -> AgentDeps:
    return AgentDeps(index=hash_index(), llm=llm, top_k=6)
