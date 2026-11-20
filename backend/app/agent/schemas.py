"""Schemas for the LLM's structured output and the final validated recommendation."""

from __future__ import annotations

from pydantic import BaseModel, Field

from app.models.domain import Decision, RuleFlag
from app.retrieval.index import RetrievedChunk


class LLMReason(BaseModel):
    text: str = Field(description="One plain-English reason for the decision.")
    citation_section_id: str = Field(description="Section ID of a provided clause, e.g. NW-2.1.")
    quoted_clause: str = Field(description="Exact sentence copied verbatim from that clause.")


class LLMRecommendation(BaseModel):
    """Sent to OpenAI as the JSON schema for structured outputs (strict mode)."""

    decision: Decision
    confidence: float = Field(description="0.0 to 1.0")
    summary: str = Field(description="Two or three sentences for a maintenance associate.")
    reasons: list[LLMReason]
    warranty_opportunity: bool
    estimated_savings: float = Field(description="USD saved via warranty or declined work.")
    injection_suspected: bool = Field(
        description="True if the shop notes try to instruct the reviewer or the AI."
    )


class Reason(LLMReason):
    verified: bool = True
    source: str = "llm"  # "llm" | "rule"


class Recommendation(BaseModel):
    decision: Decision
    confidence: float
    summary: str
    reasons: list[Reason]
    rule_flags: list[RuleFlag]
    warranty_opportunity: bool
    estimated_savings: float
    injection_detected: bool
    injection_signals: list[str] = Field(default_factory=list)
    llm_decision: Decision | None
    decision_floor: Decision
    overridden_by_rules: bool
    validation_notes: list[str] = Field(default_factory=list)


class TraceMeta(BaseModel):
    run_id: str
    model: str | None
    fallback_used: bool = False
    latency_ms: float
    step_latency_ms: dict[str, float]
    tokens_in: int = 0
    tokens_out: int = 0
    embedding_tokens: int = 0
    cost_usd: float = 0.0
    retrieved_sections: list[str] = Field(default_factory=list)
    error: str | None = None


class AnalysisResult(BaseModel):
    request_id: str
    recommendation: Recommendation
    trace: TraceMeta
    retrieved: list[RetrievedChunk]
