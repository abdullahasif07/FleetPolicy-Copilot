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
