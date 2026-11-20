"""Deterministic policy rule engine.

These checks are plain Python, not LLM judgement. Their output sets a *decision floor*
that the LLM's recommendation can never relax:

* any ``block`` flag    -> DECLINE
* any ``escalate`` flag -> at most ESCALATE
* otherwise             -> APPROVE is allowed
"""

from __future__ import annotations

from collections.abc import Mapping
from datetime import date

from app.models.domain import (
    Category,
    ClientPolicy,
    Decision,
    PartPrice,
    RepairRequest,
    RuleCode,
    RuleFlag,
    RuleResult,
    Severity,
    Vehicle,
)

# Which repair categories each warranty type covers. Wear items (brakes, tires, PM,
# glass, 12V batteries) and cosmetic/accessory work are never covered.
BASIC_COVERAGE = frozenset(
    {
        Category.ENGINE,
        Category.TRANSMISSION,
        Category.ELECTRICAL,
        Category.HVAC,
        Category.STEERING,
        Category.SUSPENSION,
    }
)
POWERTRAIN_COVERAGE = frozenset({Category.ENGINE, Category.TRANSMISSION})
BATTERY_COVERAGE = frozenset({Category.BATTERY_HV, Category.ELECTRIC_DRIVE})


def months_between(start: date, end: date) -> int:
    """Whole months elapsed from ``start`` to ``end``."""
    months = (end.year - start.year) * 12 + (end.month - start.month)
    if end.day < start.day:
        months -= 1
    return months


def _active(
    months_limit: int | None,
    miles_limit: int | None,
    months_elapsed: int,
    odometer: int,
) -> bool:
    if months_limit is None or miles_limit is None:
        return False
    return months_elapsed < months_limit and odometer < miles_limit


def warranty_coverage(vehicle: Vehicle, odometer: int, on: date) -> dict[str, frozenset[Category]]:
    """Return active warranty types and the categories each one covers."""
    elapsed = months_between(vehicle.in_service_date, on)
    active: dict[str, frozenset[Category]] = {}
    if _active(vehicle.basic_months, vehicle.basic_miles, elapsed, odometer):
        active["basic"] = BASIC_COVERAGE
    if _active(vehicle.powertrain_months, vehicle.powertrain_miles, elapsed, odometer):
        active["powertrain"] = POWERTRAIN_COVERAGE
    if _active(vehicle.battery_months, vehicle.battery_miles, elapsed, odometer):
        active["battery"] = BATTERY_COVERAGE
    return active


def _floor(flags: list[RuleFlag]) -> Decision:
    if any(f.severity is Severity.BLOCK for f in flags):
        return Decision.DECLINE
    if any(f.severity is Severity.ESCALATE for f in flags):
        return Decision.ESCALATE
    return Decision.APPROVE


def _money(x: float) -> str:
    return f"${x:,.2f}"


def evaluate(
    request: RepairRequest,
    vehicle: Vehicle | None,
    policy: ClientPolicy,
    parts: Mapping[str, PartPrice],
) -> RuleResult:
    flags: list[RuleFlag] = []
    sec = policy.section

    def flag(
        rule: RuleCode, severity: Severity, message: str, section_key: str, line: int | None = None
    ) -> None:
        flags.append(
            RuleFlag(
                rule=rule,
                severity=severity,
                message=message,
                section_id=sec(section_key),
                line_index=line,
            )
        )

    # 1. Missing / inconsistent information -------------------------------------------
    if request.client_id != policy.client_id:
        raise ValueError("policy does not belong to the request's client")
    if vehicle is None:
        flag(RuleCode.MISSING_INFO, Severity.ESCALATE,
             f"Vehicle {request.vehicle_id} not found in the fleet records.", "missing_info")
    elif vehicle.client_id != request.client_id:
        flag(RuleCode.MISSING_INFO, Severity.ESCALATE,
             f"Vehicle {vehicle.vehicle_id} does not belong to client {request.client_id}.",
             "missing_info")
        vehicle = None
    if request.odometer is None:
        flag(RuleCode.MISSING_INFO, Severity.ESCALATE,
             "Odometer reading is missing.", "missing_info")
    if not request.line_items:
        flag(RuleCode.MISSING_INFO, Severity.ESCALATE,
             "Request has no line items.", "missing_info")
    for i, li in enumerate(request.line_items):
        if not li.is_complete:
            flag(RuleCode.MISSING_INFO, Severity.ESCALATE,
                 f"Line {i + 1} is missing a description, category, parts cost or labour.",
                 "missing_info", i)
    if policy.quote_threshold is not None and request.quotes_count is None:
        flag(RuleCode.MISSING_INFO, Severity.ESCALATE,
             "Number of written quotes is missing.", "missing_info")

    # 2. Vendor -------------------------------------------------------------------------
    if request.shop_id not in policy.approved_vendors:
        flag(RuleCode.VENDOR, policy.non_approved_vendor_action,
             f"Shop {request.shop_id} is not an approved vendor for {policy.name}.", "vendor")

    # 3. Per-line checks ----------------------------------------------------------------
    for i, li in enumerate(request.line_items):
        cat = li.category
        if cat in policy.excluded_categories:
            flag(RuleCode.EXCLUSION, Severity.BLOCK,
                 f"Line {i + 1} is excluded work ({cat}).", "exclusion", i)
        if li.labor_rate is not None and li.labor_rate > policy.labor_rate_cap:
            flag(RuleCode.LABOR_CAP, policy.labor_cap_action,
                 f"Line {i + 1} labour rate {_money(li.labor_rate)}/hr exceeds the "
                 f"{_money(policy.labor_rate_cap)}/hr cap.", "labor_cap", i)
        if (
            policy.parts_markup_review_pct is not None
            and li.part_code is not None
            and li.part_code in parts
            and li.part_cost is not None
        ):
            ref = parts[li.part_code].ref_high * li.quantity
            limit = ref * (1 + policy.parts_markup_review_pct / 100)
            if li.part_cost > limit:
                pct = (li.part_cost / ref - 1) * 100
                flag(RuleCode.PARTS_MARKUP, Severity.ESCALATE,
                     f"Line {i + 1} parts {_money(li.part_cost)} are {pct:.0f}% above the "
                     f"reference price {_money(ref)} (review threshold "
                     f"{policy.parts_markup_review_pct:.0f}%).", "parts_markup", i)
        if cat in policy.always_escalate_categories:
            flag(RuleCode.ALWAYS_ESCALATE, Severity.ESCALATE,
                 f"Line {i + 1} ({cat}) must always be escalated.", "always_escalate", i)
        elif cat in policy.pre_approval_categories:
            flag(RuleCode.PRE_APPROVAL, Severity.ESCALATE,
                 f"Line {i + 1} ({cat}) requires pre-approval.", "pre_approval", i)

    # 4. Warranty and preventive-maintenance interval (need vehicle + odometer) ---------
    warranty_opportunity = False
    savings = 0.0
    if vehicle is not None and request.odometer is not None:
        on = request.submitted_at.date()
        coverage = warranty_coverage(vehicle, request.odometer, on)
        for i, li in enumerate(request.line_items):
            if li.category is None:
                continue
            covering = [name for name, cats in coverage.items() if li.category in cats]
            if not covering:
                continue
            warranty_opportunity = True
            savings += li.total or 0.0
            key = (
                "warranty_battery"
                if "battery" in covering and "warranty_battery" in policy.sections
                else "warranty"
            )
            if li.category in policy.always_escalate_categories:
                # Specialist handles the claim; escalation (above) still applies.
                flag(RuleCode.WARRANTY, Severity.INFO,
                     f"Line {i + 1} appears covered by the {covering[0]} warranty; the "
                     f"specialist should coordinate the claim.", key, i)
            else:
                flag(RuleCode.WARRANTY, Severity.BLOCK,
                     f"Line {i + 1} ({li.category}) is covered by the active {covering[0]} "
                     f"warranty; submit as a warranty claim.", key, i)

        if policy.pm_min_miles is not None and vehicle.last_pm_mileage is not None:
            since = request.odometer - vehicle.last_pm_mileage
            for i, li in enumerate(request.line_items):
                if li.category is Category.PREVENTIVE_MAINTENANCE and since < policy.pm_min_miles:
                    flag(RuleCode.PM_EARLY, Severity.BLOCK,
                         f"Only {since:,} miles since last PM; minimum is "
                         f"{policy.pm_min_miles:,}.", "pm_early", i)

    # 5. Spending authority (needs a computable total) ----------------------------------
    total = request.total
    if total is not None:
        if policy.quote_threshold is not None and total > policy.quote_threshold:
            if request.quotes_count is None:
                pass  # already flagged as missing information
            elif request.quotes_count < policy.quotes_required:
                flag(RuleCode.QUOTES, Severity.BLOCK,
                     f"Total {_money(total)} is above {_money(policy.quote_threshold)} and "
                     f"{policy.quotes_required} quotes are required "
                     f"({request.quotes_count} provided).", "quotes")
            elif policy.limit_with_quotes is not None and total > policy.limit_with_quotes:
                flag(RuleCode.SPENDING_LIMIT, Severity.ESCALATE,
                     f"Total {_money(total)} exceeds the {_money(policy.limit_with_quotes)} "
                     f"limit even with quotes.", "over_limit")
            else:
                flag(RuleCode.WITHIN_LIMIT, Severity.INFO,
                     f"Total {_money(total)} is within the limit with "
                     f"{request.quotes_count} quotes.", "quotes")
        else:
            cats = {li.category for li in request.line_items}
            use_category = bool(cats) and all(c in policy.category_limits for c in cats)
            if use_category:
                limit = min(policy.category_limits[c] for c in cats if c is not None)
                within_key = over_key = "category_limit"
            else:
                limit = policy.auto_approve_limit
                within_key, over_key = "auto_approve", "over_limit"
            if total > limit:
                flag(RuleCode.SPENDING_LIMIT, Severity.ESCALATE,
                     f"Total {_money(total)} exceeds the {_money(limit)} approval limit.",
                     over_key)
            else:
                flag(RuleCode.WITHIN_LIMIT, Severity.INFO,
                     f"Total {_money(total)} is within the {_money(limit)} approval limit.",
                     within_key)

    return RuleResult(
        flags=flags,
        decision_floor=_floor(flags),
        computed_total=total,
        warranty_opportunity=warranty_opportunity,
        estimated_savings=round(savings, 2),
    )
