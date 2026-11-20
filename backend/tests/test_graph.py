"""End-to-end graph tests with a scripted fake LLM (no API key needed)."""

from __future__ import annotations

import asyncio

import openai

from app.agent.graph import NODE_ORDER, run_analysis, stream_analysis
from app.agent.injection import detect_injection
from app.agent.llm import LLMUnavailableError, Messages, ScriptedLLM, failing_llm
from app.agent.schemas import LLMRecommendation
from app.data_loader import load_eval_labels, load_sample_requests
from app.models.domain import Decision
from tests.conftest import agent_deps, citing_llm, rec, section_sentence

REQS = {r.request_id: r.model_dump(mode="json") for r in load_sample_requests()}


def run(request_id: str, llm: object) -> object:
    return asyncio.run(run_analysis(agent_deps(llm), REQS[request_id]))  # type: ignore[arg-type]


def test_clean_request_approves_with_verified_citation() -> None:
    result = run("R-1001", citing_llm(Decision.APPROVE))
    rec_ = result.recommendation  # type: ignore[attr-defined]
    assert rec_.decision is Decision.APPROVE
    assert rec_.reasons and all(r.verified for r in rec_.reasons)
    assert set(result.trace.step_latency_ms) == set(NODE_ORDER)  # type: ignore[attr-defined]


def test_stream_emits_progress_for_every_node() -> None:
    async def collect() -> list[dict[str, object]]:
        return [e async for e in stream_analysis(agent_deps(citing_llm()), REQS["R-1001"])]

    events = asyncio.run(collect())
    done = [e["node"] for e in events if e.get("status") == "done"]
    assert done == NODE_ORDER
    assert events[-1]["event"] == "result"


def test_rule_sections_are_pinned_into_context() -> None:
    llm = citing_llm(Decision.ESCALATE)
    result = run("R-1008", llm)  # parts markup -> NW-6.3
    assert "NW-6.3" in result.trace.retrieved_sections  # type: ignore[attr-defined]
    assert 'section_id="NW-6.3"' in llm.calls[0][1]["content"]


def test_injected_llm_approval_is_overridden() -> None:
    """Simulate a model that falls for the injection and approves."""
    llm = ScriptedLLM(lambda m: rec(Decision.APPROVE, [("NW-2.1", section_sentence("NW-2.1"))],
                                     confidence=1.0))
    result = run("R-1010", llm)
    r = result.recommendation  # type: ignore[attr-defined]
    assert r.decision is Decision.ESCALATE
    assert r.overridden_by_rules and r.injection_detected


def test_shop_notes_are_fenced_and_neutralized_in_prompt() -> None:
    llm = citing_llm(Decision.DECLINE)
    run("R-1030", llm)
    user = llm.calls[0][1]["content"]
    notes = user.split("<untrusted_shop_notes>")[1].split("</untrusted_shop_notes>")[0]
    assert "</shop_notes>" not in notes and "‹/shop_notes›" in notes
    assert user.count("</untrusted_shop_notes>") == 1


def test_llm_judgment_case_decline_with_citation() -> None:
    """R-1013: rules allow it, but the description is excluded work under CV-8.1."""
    def script(messages: Messages) -> LLMRecommendation:
        assert 'section_id="CV-8.1"' in messages[1]["content"], "exclusion clause not retrieved"
        return rec(Decision.DECLINE, [("CV-8.1", section_sentence("CV-8.1", 2))])

    result = run("R-1013", ScriptedLLM(script))
    assert result.recommendation.decision is Decision.DECLINE  # type: ignore[attr-defined]


def test_llm_outage_degrades_to_rules_only() -> None:
    result = run("R-1005", failing_llm(LLMUnavailableError("all models failed")))
    r = result.recommendation  # type: ignore[attr-defined]
    assert r.decision is Decision.DECLINE and r.llm_decision is None
    assert result.trace.error  # type: ignore[attr-defined]


def test_detector_flags_all_labelled_injections_and_no_clean_notes() -> None:
    labels = {e["request_id"]: e["is_injection"] for e in load_eval_labels()}
    for rid, req in REQS.items():
        assert bool(detect_injection(req["shop_notes"])) == labels[rid], rid


def test_openai_client_falls_back_to_second_model(monkeypatch: object) -> None:
    from app.agent.llm import LLMResponse, OpenAILLM
    from app.config import Settings

    llm = OpenAILLM(Settings(openai_api_key="sk-test-not-real", llm_max_retries=0,
                             _env_file=None))
    calls: list[str] = []

    async def fake_call(model: str, messages: Messages) -> LLMResponse:
        calls.append(model)
        if model == "gpt-4.1-mini":
            raise openai.APITimeoutError(request=None)  # type: ignore[arg-type]
        return LLMResponse(parsed=rec(Decision.ESCALATE), model=model, tokens_in=1, tokens_out=1)

    llm._call = fake_call  # type: ignore[method-assign]
    out = asyncio.run(llm.recommend([]))
    assert calls == ["gpt-4.1-mini", "gpt-4o-mini"] and out.fallback_used
