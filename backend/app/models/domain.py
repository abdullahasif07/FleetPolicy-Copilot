"""Core domain models shared by the rule engine, the agent graph and the API."""

from __future__ import annotations

from datetime import date, datetime
from enum import StrEnum

from pydantic import BaseModel, ConfigDict, Field


class Category(StrEnum):
    BRAKES = "brakes"
    TIRES = "tires"
    STEERING = "steering"
    SUSPENSION = "suspension"
    ENGINE = "engine"
    TRANSMISSION = "transmission"
    ELECTRICAL = "electrical"
    HVAC = "hvac"
    BATTERY_12V = "battery_12v"
    BATTERY_HV = "battery_hv"
    ELECTRIC_DRIVE = "electric_drive"
    PREVENTIVE_MAINTENANCE = "preventive_maintenance"
    BODY = "body"
    GLASS = "glass"
    REEFER = "reefer"
    AERIAL_HYDRAULICS = "aerial_hydraulics"
    ACCESSORIES = "accessories"
    COSMETIC = "cosmetic"
    DIAGNOSTIC = "diagnostic"
    OTHER = "other"


class Decision(StrEnum):
    APPROVE = "APPROVE"
    ESCALATE = "ESCALATE"
    DECLINE = "DECLINE"


class Severity(StrEnum):
    BLOCK = "block"  # forces DECLINE
    ESCALATE = "escalate"  # caps the decision at ESCALATE
    INFO = "info"  # context only


class RuleCode(StrEnum):
    MISSING_INFO = "MISSING_INFO"
    VENDOR = "VENDOR"
    SPENDING_LIMIT = "SPENDING_LIMIT"
    WITHIN_LIMIT = "WITHIN_LIMIT"
    QUOTES = "QUOTES"
    LABOR_CAP = "LABOR_CAP"
    PARTS_MARKUP = "PARTS_MARKUP"
    PRE_APPROVAL = "PRE_APPROVAL"
    ALWAYS_ESCALATE = "ALWAYS_ESCALATE"
    EXCLUSION = "EXCLUSION"
    WARRANTY = "WARRANTY"
    PM_EARLY = "PM_EARLY"


# --- Requests -----------------------------------------------------------------


class LineItem(BaseModel):
    model_config = ConfigDict(extra="forbid")

    description: str = Field(default="", max_length=500)
    category: Category | None = None
    part_code: str | None = Field(default=None, max_length=40)
    quantity: int = Field(default=1, ge=1, le=100)
    part_cost: float | None = Field(default=None, ge=0, le=1_000_000)
    labor_hours: float | None = Field(default=None, ge=0, le=500)
    labor_rate: float | None = Field(default=None, ge=0, le=10_000)

    @property
    def is_complete(self) -> bool:
        return (
            bool(self.description.strip())
            and self.category is not None
            and self.part_cost is not None
            and self.labor_hours is not None
            and self.labor_rate is not None
        )

    @property
    def total(self) -> float | None:
        if self.part_cost is None or self.labor_hours is None or self.labor_rate is None:
            return None
        return round(self.part_cost + self.labor_hours * self.labor_rate, 2)


class RepairRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    request_id: str = Field(max_length=40)
    client_id: str = Field(max_length=10)
    vehicle_id: str = Field(max_length=40)
    shop_id: str = Field(max_length=10)
    submitted_at: datetime
    odometer: int | None = Field(default=None, ge=0, le=2_000_000)
    quotes_count: int | None = Field(default=None, ge=0, le=20)
    line_items: list[LineItem] = Field(default_factory=list, max_length=50)
    shop_notes: str = Field(default="", max_length=4000)  # UNTRUSTED input

    @property
    def total(self) -> float | None:
        totals = [li.total for li in self.line_items]
        if not totals or any(t is None for t in totals):
            return None
        return round(sum(t for t in totals if t is not None), 2)


# --- Reference data -----------------------------------------------------------


class Vehicle(BaseModel):
    vehicle_id: str
    client_id: str
    unit_number: str
    make: str
    model: str
    year: int
    powertrain: str  # "ICE" | "EV"
    mileage: int
    in_service_date: date
    last_pm_mileage: int | None = None
    basic_months: int | None = None
    basic_miles: int | None = None
    powertrain_months: int | None = None
    powertrain_miles: int | None = None
    battery_months: int | None = None
    battery_miles: int | None = None


class Shop(BaseModel):
    shop_id: str
    name: str
    city: str


class ClientPolicy(BaseModel):
    """Structured, machine-checkable part of a client's policy."""

    client_id: str
    name: str
    policy_file: str
    summary: str
    auto_approve_limit: float
    category_limits: dict[Category, float] = Field(default_factory=dict)
    quote_threshold: float | None = None
    quotes_required: int = 0
    limit_with_quotes: float | None = None
    approved_vendors: list[str]
    non_approved_vendor_action: Severity
    labor_rate_cap: float
    labor_cap_action: Severity
    pre_approval_categories: list[Category] = Field(default_factory=list)
    always_escalate_categories: list[Category] = Field(default_factory=list)
    excluded_categories: list[Category] = Field(default_factory=list)
    pm_interval_miles: int | None = None
    pm_min_miles: int | None = None
    parts_markup_review_pct: float | None = None
    sections: dict[str, str]

    def section(self, key: str) -> str:
        return self.sections[key]


class PartPrice(BaseModel):
    code: str
    description: str
    category: str
    ref_low: float
    ref_high: float


# --- Rule engine output -------------------------------------------------------


class RuleFlag(BaseModel):
    rule: RuleCode
    severity: Severity
    message: str
    section_id: str
    line_index: int | None = None


class RuleResult(BaseModel):
    flags: list[RuleFlag]
    decision_floor: Decision
    computed_total: float | None
    warranty_opportunity: bool
    estimated_savings: float

    @property
    def blocking(self) -> list[RuleFlag]:
        return [f for f in self.flags if f.severity is Severity.BLOCK]

    @property
    def escalating(self) -> list[RuleFlag]:
        return [f for f in self.flags if f.severity is Severity.ESCALATE]
