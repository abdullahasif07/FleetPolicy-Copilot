"""'What would change the decision' checks re-run the rule engine on changed requests."""

from __future__ import annotations

import pytest

from app.data_loader import (
    load_parts,
    load_policies,
    load_sample_requests,
    load_shops,
    load_vehicles,
)
from app.models.domain import Decision, RuleCode
from app.rules.counterfactual import WhatIfResult, what_would_change
from tests.conftest import make_request

REQS = {r.request_id: r for r in load_sample_requests()}
NAMES = {k: v.name for k, v in load_shops().items()}


def what_if(rid: str) -> WhatIfResult:
    r = REQS[rid]
    return what_would_change(r, load_vehicles().get(r.vehicle_id), load_policies()[r.client_id],
                             load_parts(), NAMES)


def test_clean_approval_has_nothing_to_change() -> None:
    w = what_if("R-1001")
    assert w.current_floor is Decision.APPROVE and w.items == [] and w.all_changes_floor is None


@pytest.mark.parametrize("rid, rule, text", [
    ("R-1002", RuleCode.SPENDING_LIMIT, "Total at or under $500.00 (now $960.00)"),
    ("R-1003", RuleCode.VENDOR, "Use an approved vendor"),
    ("R-1006", RuleCode.PM_EARLY, "Wait until 234,500 miles"),
    ("R-1008", RuleCode.PARTS_MARKUP, "parts at or under $237.50"),
    ("R-1009", RuleCode.MISSING_INFO, "Add the odometer reading"),
    ("R-1022", RuleCode.QUOTES, "At least 2 written quotes (now 1)"),
    ("R-1028", RuleCode.LABOR_CAP, "labour at $125.00/hr or less"),
    # Total lands exactly on the limit after scaling, so rounding must not push it over.
    ("R-1012", RuleCode.SPENDING_LIMIT, "Total at or under $1,500.00"),
])
def test_single_fix_turns_the_request_into_an_approval(rid: str, rule: RuleCode,
                                                       text: str) -> None:
    w = what_if(rid)
    assert w.current_floor is not Decision.APPROVE
    [item] = w.items
    assert item.rule is rule and text in item.change
    assert item.fixable and item.decision_after is Decision.APPROVE


def test_each_change_alone_is_not_enough_but_together_they_approve() -> None:
    w = what_if("R-1007")  # labour over the cap (decline) and total over the limit
    assert w.current_floor is Decision.DECLINE
    assert [i.decision_after for i in w.items] == [Decision.ESCALATE, Decision.DECLINE]
    assert w.all_changes_floor is Decision.APPROVE


def test_pre_approval_cannot_be_changed_away() -> None:
    w = what_if("R-1018")
    [item] = w.items
    assert item.rule is RuleCode.PRE_APPROVAL and not item.fixable and item.decision_after is None


def test_removing_the_only_line_says_nothing_is_left() -> None:
    w = what_if("R-1005")  # a single excluded accessory line
    [item] = w.items
    assert item.fixable and item.decision_after is None and item.note
    assert w.all_changes_floor is None


def test_removing_one_of_several_lines_is_re_evaluated(item: object) -> None:
    req = make_request(line_items=[
        item(description="Brake pads", category="brakes", part_cost=80, labor_hours=1,  # type: ignore[operator]
             labor_rate=100),
        item(description="Light bar", category="accessories", part_cost=150, labor_hours=1,  # type: ignore[operator]
             labor_rate=100),
    ])
    w = what_would_change(req, load_vehicles()[req.vehicle_id], load_policies()["NW"],
                          load_parts(), NAMES)
    excl = next(i for i in w.items if i.rule is RuleCode.EXCLUSION)
    assert excl.change.startswith("Remove line 2") and excl.decision_after is Decision.APPROVE


def test_request_detail_includes_what_if(tmp_path: object) -> None:
    from tests.test_api import build
    c, _ = build(tmp_path)  # type: ignore[arg-type]
    with c:
        body = c.get("/requests/R-1002").json()
    assert body["what_if"]["current_floor"] == "ESCALATE"
    assert body["what_if"]["items"][0]["decision_after"] == "APPROVE"
