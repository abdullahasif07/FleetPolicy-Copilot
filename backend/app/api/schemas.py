"""Request/response models for the HTTP API."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.agent.schemas import AnalysisResult
from app.data_loader import is_builtin_client
from app.models.domain import ClientPolicy, Decision, LineItem, RepairRequest, Shop, Vehicle
from app.onboarding.checks import Issue
from app.onboarding.drafter import MAX_POLICY_CHARS


class RequestSummary(BaseModel):
    request_id: str
    client_id: str
    client_name: str
    vehicle_id: str
    vehicle_label: str
    unit_number: str | None
    shop_id: str
    shop_name: str
    total: float | None
    submitted_at: datetime
    status: str
    ai_decision: Decision | None
    human_action: Decision | None
    injection_flag: bool
    line_item_count: int
    headline: str
    is_custom: bool


class WarrantyStatus(BaseModel):
    name: str
    active: bool
    months_limit: int
    miles_limit: int
    months_elapsed: int
    odometer: int | None
    covers: list[str]


class ClientInfo(BaseModel):
    client_id: str
    name: str
    summary: str
    auto_approve_limit: float
    category_limits: dict[str, float]
    quote_threshold: float | None
    quotes_required: int
    labor_rate_cap: float
    approved_vendors: list[Shop]
    pre_approval_categories: list[str]
    always_escalate_categories: list[str]
    excluded_categories: list[str]
    pm_interval_miles: int | None
    onboarded: bool = False

    @classmethod
    def from_policy(cls, p: ClientPolicy, shops: dict[str, Shop]) -> ClientInfo:
        return cls(
            client_id=p.client_id, name=p.name, summary=p.summary,
            auto_approve_limit=p.auto_approve_limit,
            category_limits={str(k): v for k, v in p.category_limits.items()},
            quote_threshold=p.quote_threshold, quotes_required=p.quotes_required,
            labor_rate_cap=p.labor_rate_cap,
            approved_vendors=[shops[s] for s in p.approved_vendors if s in shops],
            pre_approval_categories=[str(c) for c in p.pre_approval_categories],
            always_escalate_categories=[str(c) for c in p.always_escalate_categories],
            excluded_categories=[str(c) for c in p.excluded_categories],
            pm_interval_miles=p.pm_interval_miles,
            onboarded=not is_builtin_client(p.client_id),
        )


class DraftIn(BaseModel):
    policy_markdown: str = Field(min_length=1, max_length=MAX_POLICY_CHARS)


class OnboardIn(BaseModel):
    policy_markdown: str = Field(min_length=1, max_length=MAX_POLICY_CHARS)
    policy: ClientPolicy
    vehicles_csv: str = Field(max_length=20_000)


class CheckOut(BaseModel):
    client_id: str | None
    issues: list[Issue]
    vehicle_count: int


class DecisionOut(BaseModel):
    ai_decision: Decision
    human_action: Decision
    is_override: bool
    override_reason: str | None
    decided_at: datetime


class RequestDetail(BaseModel):
    summary: RequestSummary
    request: RepairRequest
    vehicle: Vehicle | None
    warranty: list[WarrantyStatus]
    client: ClientInfo
    shop: Shop | None
    shop_is_approved: bool
    injection_signals: list[str]
    analysis: AnalysisResult | None
    decision: DecisionOut | None


class DecisionIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    action: Decision
    override_reason: str | None = Field(default=None, max_length=500)

    @model_validator(mode="after")
    def _strip(self) -> DecisionIn:
        if self.override_reason is not None:
            self.override_reason = self.override_reason.strip() or None
        return self


class NewRequestIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    client_id: str = Field(max_length=10)
    vehicle_id: str = Field(max_length=40)
    shop_id: str = Field(max_length=10)
    odometer: int | None = Field(default=None, ge=0, le=2_000_000)
    quotes_count: int | None = Field(default=None, ge=0, le=20)
    line_items: list[LineItem] = Field(min_length=1, max_length=20)
    shop_notes: str = Field(default="", max_length=4000)


class AuditEntry(BaseModel):
    request_id: str
    client_name: str
    total: float | None
    ai_decision: Decision
    ai_confidence: float
    human_action: Decision
    is_override: bool
    override_reason: str | None
    decided_at: datetime
    model: str | None
    cost_usd: float
    injection_detected: bool


class Metrics(BaseModel):
    usage: dict[str, Any]
    evals: dict[str, Any] | None
