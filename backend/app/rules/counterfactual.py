"""What would change the decision? Deterministic "what if" checks on the rule engine.

For each rule finding that blocks approval, we change the request so that finding no
longer applies (lower the total, use an approved shop, add a quote, ...), re-run the rule
engine and report the resulting decision floor. Findings that no change to the request
can fix (pre-approval, specialist review) are reported as such. This is plain code: the
model's judgement is not re-run, so the answer is about the rule checks only.
"""

from __future__ import annotations

import math
from collections.abc import Callable, Mapping

from pydantic import BaseModel

from app.models.domain import (
    ClientPolicy,
    Decision,
    LineItem,
    PartPrice,
    RepairRequest,
    RuleCode,
    RuleFlag,
    RuleResult,
    Severity,
    Vehicle,
)
from app.rules.engine import evaluate

Fix = Callable[[RepairRequest], RepairRequest | None]


class WhatIf(BaseModel):
    rule: RuleCode
    section_id: str
    change: str  # plain-English description of the change
    fixable: bool  # False when no change to the request can clear this finding
    decision_after: Decision | None  # rule floor with only this change applied
    note: str | None = None  # e.g. when the change leaves nothing to bill


class WhatIfResult(BaseModel):
    current_floor: Decision
    items: list[WhatIf]
    all_changes_floor: Decision | None  # floor with every fixable change applied together


def _money(x: float) -> str:
    return f"${x:,.2f}"


def _with_lines(req: RepairRequest, lines: list[LineItem]) -> RepairRequest:
    return req.model_copy(update={"line_items": lines})


def _scale_total(req: RepairRequest, target: float) -> RepairRequest | None:
    total = req.total
    if total is None or total <= 0:
        return None
    if total <= target:
        return req
    factor = target / total
    lines = [li.model_copy(update={  # round down so the new total never exceeds the target
        "part_cost": math.floor((li.part_cost or 0) * factor * 100) / 100,
        "labor_hours": math.floor((li.labor_hours or 0) * factor * 10_000) / 10_000,
    }) for li in req.line_items]
    return _with_lines(req, lines)


def _update_line(req: RepairRequest, i: int, **changes: float) -> RepairRequest:
    lines = list(req.line_items)
    lines[i] = lines[i].model_copy(update=changes)
    return _with_lines(req, lines)


def _drop_line(req: RepairRequest, i: int) -> RepairRequest | None:
    if len(req.line_items) <= 1:
        return None
    return _with_lines(req, [li for j, li in enumerate(req.line_items) if j != i])


def _spending_limit(req: RepairRequest, policy: ClientPolicy) -> float:
    """The limit the engine applied (mirrors engine step 5)."""
    total = req.total or 0
    if (policy.quote_threshold is not None and total > policy.quote_threshold
            and policy.limit_with_quotes is not None):
        return policy.limit_with_quotes
    cats = {li.category for li in req.line_items}
    if cats and all(c in policy.category_limits for c in cats):
        return min(policy.category_limits[c] for c in cats if c is not None)
    return policy.auto_approve_limit


def _plan(flag: RuleFlag, req: RepairRequest, vehicle: Vehicle | None, policy: ClientPolicy,
          parts: Mapping[str, PartPrice], shop_names: Mapping[str, str]) -> tuple[str, Fix | None]:
    """Describe the change that clears ``flag`` and how to apply it (None = can't)."""
    i = flag.line_index
    li = req.line_items[i] if i is not None and i < len(req.line_items) else None
    n = (i or 0) + 1

    match flag.rule:
        case RuleCode.VENDOR:
            shop = policy.approved_vendors[0]
            return (f"Use an approved vendor, e.g. {shop_names.get(shop, shop)}",
                    lambda r: r.model_copy(update={"shop_id": shop}))
        case RuleCode.SPENDING_LIMIT:
            limit = _spending_limit(req, policy)
            return (f"Total at or under {_money(limit)} (now {_money(req.total or 0)})",
                    lambda r: _scale_total(r, limit))
        case RuleCode.QUOTES:
            need = policy.quotes_required
            return (f"At least {need} written quotes (now {req.quotes_count or 0})",
                    lambda r: r.model_copy(update={"quotes_count": need}))
        case RuleCode.LABOR_CAP if li is not None and i is not None:
            cap = policy.labor_rate_cap
            return (f"Line {n} labour at {_money(cap)}/hr or less "
                    f"(now {_money(li.labor_rate or 0)}/hr)",
                    lambda r: _update_line(r, i, labor_rate=cap))
        case RuleCode.PARTS_MARKUP if li is not None and i is not None and li.part_code:
            pct = policy.parts_markup_review_pct or 0
            limit = round(parts[li.part_code].ref_high * li.quantity * (1 + pct / 100), 2)
            return (f"Line {n} parts at or under {_money(limit)} "
                    f"(now {_money(li.part_cost or 0)})",
                    lambda r: _update_line(r, i, part_cost=limit))
        case RuleCode.EXCLUSION if i is not None:
            return (f"Remove line {n} (excluded {li.category if li else 'work'})",
                    lambda r: _drop_line(r, i))
        case RuleCode.WARRANTY if i is not None:
            return (f"Claim line {n} under warranty instead of billing the client",
                    lambda r: _drop_line(r, i))
        case RuleCode.PM_EARLY if vehicle is not None and vehicle.last_pm_mileage is not None:
            due = vehicle.last_pm_mileage + (policy.pm_min_miles or 0)
            return (f"Wait until {due:,} miles ({policy.pm_min_miles:,} since the last service; "
                    f"now {req.odometer or 0:,})",
                    lambda r: r.model_copy(update={"odometer": due}))
        case RuleCode.MISSING_INFO:
            if req.odometer is None and "Odometer" in flag.message and vehicle is not None:
                return ("Add the odometer reading",
                        lambda r: r.model_copy(update={"odometer": vehicle.mileage}))
            if "quotes" in flag.message:
                need = (policy.quotes_required if policy.quote_threshold is not None
                        and (req.total or 0) > policy.quote_threshold else 0)
                return ("State how many written quotes were obtained",
                        lambda r: r.model_copy(update={"quotes_count": need}))
            return ("Complete the missing details: " + flag.message.rstrip("."), None)
        case RuleCode.PRE_APPROVAL:
            return ("Needs pre-approval from the client: no change to the request avoids this",
                    None)
        case RuleCode.ALWAYS_ESCALATE:
            return ("Always handled by a specialist: no change to the request avoids this", None)
    return (flag.message, None)


def what_would_change(
    req: RepairRequest,
    vehicle: Vehicle | None,
    policy: ClientPolicy,
    parts: Mapping[str, PartPrice],
    shop_names: Mapping[str, str],
    result: RuleResult | None = None,
) -> WhatIfResult:
    result = result or evaluate(req, vehicle, policy, parts)
    blocking = [f for f in result.flags if f.severity in (Severity.BLOCK, Severity.ESCALATE)]
    items: list[WhatIf] = []
    combined: RepairRequest | None = req
    seen: set[tuple[RuleCode, int | None]] = set()
    for flag in blocking:
        key = (flag.rule, flag.line_index)
        if key in seen:
            continue
        seen.add(key)
        change, fix = _plan(flag, req, vehicle, policy, parts, shop_names)
        if fix is None:
            items.append(WhatIf(rule=flag.rule, section_id=flag.section_id, change=change,
                                fixable=False, decision_after=None))
            continue
        changed = fix(req)
        if changed is None:  # the change removes the only line: nothing left to decide
            items.append(WhatIf(rule=flag.rule, section_id=flag.section_id, change=change,
                                fixable=True, decision_after=None,
                                note="Nothing would be left on this request to bill."))
            fix = None
        else:
            items.append(WhatIf(
                rule=flag.rule, section_id=flag.section_id, change=change, fixable=True,
                decision_after=evaluate(changed, vehicle, policy, parts).decision_floor))
        if fix and combined is not None:
            combined = fix(combined)
    all_floor = None
    applied = [i for i in items if i.decision_after is not None]
    nothing_left = any(i.note for i in items)
    if len(items) > 1 and combined is not None and applied and not nothing_left:
        all_floor = evaluate(combined, vehicle, policy, parts).decision_floor
    return WhatIfResult(current_floor=result.decision_floor, items=items,
                        all_changes_floor=all_floor)
