from __future__ import annotations

from app.agent.validator import INSUFFICIENT_EVIDENCE, quote_in_chunk, validate
from app.models.domain import Decision, RuleCode, RuleFlag, RuleResult, Severity
from app.retrieval.index import RetrievedChunk
from tests.conftest import hash_index, rec, section_sentence


def chunks(*ids: str) -> list[RetrievedChunk]:
    out = []
    for i in ids:
        c = hash_index().get_section(i)
        assert c is not None
        out.append(RetrievedChunk(chunk=c, score=1.0))
    return out


def rules(floor: Decision, flags: list[RuleFlag] | None = None) -> RuleResult:
    return RuleResult(flags=flags or [], decision_floor=floor, computed_total=100.0,
                      warranty_opportunity=False, estimated_savings=0.0)


Q21 = section_sentence("NW-2.1")


def test_quote_matching_is_whitespace_and_case_tolerant() -> None:
    chunk = hash_index().get_section("NW-2.1")
    assert chunk is not None
    assert quote_in_chunk("  " + Q21.upper().replace(" ", "   ") + " ", chunk.text)
    assert not quote_in_chunk("Repairs under $5,000 are approved.", chunk.text)
    assert not quote_in_chunk("may", chunk.text)  # too short to count as evidence


def test_valid_citation_keeps_approve() -> None:
    out = validate(rec(Decision.APPROVE, [("NW-2.1", Q21)]), rules(Decision.APPROVE),
                   chunks("NW-2.1"), [])
    assert out.decision is Decision.APPROVE
    assert out.reasons[0].verified and not out.validation_notes


def test_citation_to_unretrieved_section_is_dropped_and_escalates() -> None:
    out = validate(rec(Decision.APPROVE, [("NW-2.1", Q21)]), rules(Decision.APPROVE),
                   chunks("NW-5.1"), [])
    assert out.decision is Decision.ESCALATE
    assert INSUFFICIENT_EVIDENCE in out.summary
    assert out.confidence <= 0.4


def test_fabricated_quote_is_dropped() -> None:
    out = validate(rec(Decision.DECLINE, [("NW-2.1", "All repairs are declined.")]),
                   rules(Decision.APPROVE), chunks("NW-2.1"), [])
    assert out.decision is Decision.ESCALATE
    assert out.reasons == []


def test_invented_section_id_is_dropped() -> None:
    out = validate(rec(Decision.APPROVE, [("NW-99.9", Q21)]), rules(Decision.APPROVE),
                   chunks("NW-2.1"), [])
    assert out.decision is Decision.ESCALATE


def test_uncited_approve_becomes_escalate() -> None:
    out = validate(rec(Decision.APPROVE), rules(Decision.APPROVE), chunks("NW-2.1"), [])
    assert out.decision is Decision.ESCALATE


def test_uncited_escalate_is_allowed() -> None:
    out = validate(rec(Decision.ESCALATE), rules(Decision.APPROVE), chunks("NW-2.1"), [])
    assert out.decision is Decision.ESCALATE
    assert INSUFFICIENT_EVIDENCE not in out.summary


def test_block_flag_overrides_llm_approve_and_adds_rule_citation() -> None:
    flag = RuleFlag(rule=RuleCode.VENDOR, severity=Severity.BLOCK, section_id="NW-5.2",
                    message="Shop S11 is not an approved vendor.")
    out = validate(rec(Decision.APPROVE, [("NW-2.1", Q21)]), rules(Decision.DECLINE, [flag]),
                   chunks("NW-2.1", "NW-5.2"), [])
    assert out.decision is Decision.DECLINE
    assert out.overridden_by_rules and out.llm_decision is Decision.APPROVE
    rule_reason = next(r for r in out.reasons if r.source == "rule")
    assert rule_reason.citation_section_id == "NW-5.2"
    assert "must be declined" in rule_reason.quoted_clause


def test_escalate_flag_caps_llm_decline() -> None:
    flag = RuleFlag(rule=RuleCode.SPENDING_LIMIT, severity=Severity.ESCALATE,
                    section_id="NW-2.2", message="Total exceeds the $500.00 approval limit.")
    out = validate(rec(Decision.DECLINE, [("NW-2.1", Q21)]), rules(Decision.ESCALATE, [flag]),
                   chunks("NW-2.1", "NW-2.2"), [])
    assert out.decision is Decision.ESCALATE


def test_llm_unavailable_falls_back_to_rules() -> None:
    flag = RuleFlag(rule=RuleCode.EXCLUSION, severity=Severity.BLOCK, section_id="NW-8.1",
                    message="Line 1 is excluded work (cosmetic).")
    out = validate(None, rules(Decision.DECLINE, [flag]), chunks("NW-8.1"), [])
    assert out.decision is Decision.DECLINE and out.reasons
    clean = validate(None, rules(Decision.APPROVE), chunks("NW-2.1"), [])
    assert clean.decision is Decision.ESCALATE  # never approve without the AI's evidence


def test_injection_flag_is_surfaced() -> None:
    out = validate(rec(Decision.ESCALATE), rules(Decision.ESCALATE), chunks("NW-2.1"),
                   ["ignore instructions"])
    assert out.injection_detected and out.injection_signals == ["ignore instructions"]
