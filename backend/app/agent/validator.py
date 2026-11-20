"""Citation validation and deterministic override of the LLM's recommendation.

Guarantees:
* every kept reason cites a retrieved section and quotes text that appears in it;
* rule ``block`` flags force DECLINE, ``escalate`` flags cap the decision at ESCALATE;
* APPROVE or DECLINE without at least one verified citation becomes ESCALATE
  ("insufficient evidence").
"""

from __future__ import annotations

import re

from app.agent.schemas import LLMRecommendation, Reason, Recommendation
from app.models.domain import Decision, RuleFlag, RuleResult
from app.retrieval.chunker import split_sentences
from app.retrieval.index import RetrievedChunk, tokenize

INSUFFICIENT_EVIDENCE = "insufficient evidence"
_MIN_QUOTE_CHARS = 12


def _norm(text: str) -> str:
    text = text.lower().replace("’", "'").replace("“", '"').replace("”", '"')
    text = re.sub(r"[\s–—-]+", " ", text)
    return text.strip(" .\"'")


def quote_in_chunk(quote: str, chunk_text: str) -> bool:
    q = _norm(quote)
    return len(q) >= _MIN_QUOTE_CHARS and q in _norm(chunk_text)


def best_sentence(chunk_text: str, hint: str) -> str:
    hint_tokens = set(tokenize(hint))
    sentences = split_sentences(chunk_text) or [chunk_text]
    return max(sentences, key=lambda s: len(hint_tokens & set(tokenize(s))))


def _rule_reason(flag: RuleFlag, chunks: dict[str, RetrievedChunk]) -> Reason | None:
    chunk = chunks.get(flag.section_id)
    if chunk is None:
        return None
    return Reason(text=flag.message, citation_section_id=flag.section_id,
                  quoted_clause=best_sentence(chunk.chunk.text, flag.message + " " + flag.rule),
                  verified=True, source="rule")


def validate(
    llm: LLMRecommendation | None,
    rules: RuleResult,
    retrieved: list[RetrievedChunk],
    injection_signals: list[str],
) -> Recommendation:
    by_section = {c.chunk.section_id: c for c in retrieved}
    notes: list[str] = []

    # 1. Verify each LLM citation against the retrieved chunks.
    verified: list[Reason] = []
    for r in llm.reasons if llm else []:
        chunk = by_section.get(r.citation_section_id)
        if chunk is None:
            notes.append(f"Dropped reason citing {r.citation_section_id}: section not retrieved.")
        elif not quote_in_chunk(r.quoted_clause, chunk.chunk.text):
            notes.append(f"Dropped reason citing {r.citation_section_id}: quote not found in it.")
        else:
            verified.append(Reason(**r.model_dump()))

    llm_decision = llm.decision if llm else None
    proposed = llm_decision or Decision.ESCALATE
    if llm is None:
        notes.append("AI reasoning unavailable; recommendation is based on rule checks only.")

    # 2. Deterministic rules override the LLM.
    floor = rules.decision_floor
    decision = proposed
    if floor is Decision.DECLINE:
        decision = Decision.DECLINE
    elif floor is Decision.ESCALATE:
        decision = Decision.ESCALATE
    overridden = llm is not None and decision is not proposed
    if overridden:
        notes.append(f"Rule check overrode AI suggestion {proposed} -> {decision}.")

    # 3. Make sure rule-driven outcomes carry citations of the triggering rules.
    driving = (rules.blocking if decision is Decision.DECLINE and floor is Decision.DECLINE
               else rules.escalating if floor is Decision.ESCALATE else [])
    cited = {r.citation_section_id for r in verified}
    for flag in driving:
        if flag.section_id not in cited and (reason := _rule_reason(flag, by_section)):
            verified.append(reason)
            cited.add(flag.section_id)

    # 4. No uncited approvals or declines.
    if decision in (Decision.APPROVE, Decision.DECLINE) and not verified:
        notes.append(f"{decision} had no verified citation; escalating ({INSUFFICIENT_EVIDENCE}).")
        decision = Decision.ESCALATE

    confidence = max(0.0, min(1.0, llm.confidence if llm else 0.5))
    if INSUFFICIENT_EVIDENCE in " ".join(notes):
        confidence = min(confidence, 0.4)
    elif overridden or (llm is None and floor is not Decision.APPROVE):
        confidence = max(confidence, 0.9)

    if llm is not None:
        summary = llm.summary
        if overridden:
            summary = (f"Rule check changed the AI suggestion from {proposed} to {decision}. "
                       + summary)
    else:
        top = (rules.blocking or rules.escalating or rules.flags)[:2]
        summary = " ".join(f.message for f in top) or "No rule findings."
    if decision is Decision.ESCALATE and INSUFFICIENT_EVIDENCE in " ".join(notes):
        summary = f"Escalated: {INSUFFICIENT_EVIDENCE}. " + summary

    injection = bool(injection_signals) or bool(llm and llm.injection_suspected)
    return Recommendation(
        decision=decision,
        confidence=round(confidence, 2),
        summary=summary,
        reasons=verified,
        rule_flags=rules.flags,
        warranty_opportunity=rules.warranty_opportunity or bool(llm and llm.warranty_opportunity),
        estimated_savings=rules.estimated_savings
        or (llm.estimated_savings if llm and decision is Decision.DECLINE else 0.0),
        injection_detected=injection,
        injection_signals=injection_signals
        or (["flagged by AI"] if llm and llm.injection_suspected else []),
        llm_decision=llm_decision,
        decision_floor=floor,
        overridden_by_rules=overridden,
        validation_notes=notes,
    )

