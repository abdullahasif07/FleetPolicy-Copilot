"""Helpers that turn database rows into API views."""

from __future__ import annotations

from sqlmodel import Session, col, select

from app.agent.injection import detect_injection
from app.agent.schemas import AnalysisResult
from app.api.schemas import DecisionOut, RequestSummary, WarrantyStatus
from app.data_loader import load_policies, load_shops, load_vehicles
from app.db import AnalysisRow, DecisionRow, RequestRow
from app.models.domain import Decision, RepairRequest, Vehicle
from app.rules.engine import (
    BASIC_COVERAGE,
    BATTERY_COVERAGE,
    POWERTRAIN_COVERAGE,
    months_between,
)


def latest_analyses(
    session: Session, request_ids: list[str] | None = None
) -> dict[str, AnalysisRow]:
    stmt = select(AnalysisRow).order_by(col(AnalysisRow.id))
    if request_ids is not None:
        stmt = stmt.where(col(AnalysisRow.request_id).in_(request_ids))
    return {a.request_id: a for a in session.exec(stmt).all()}  # later rows win


def decisions(session: Session, request_ids: list[str] | None = None) -> dict[str, DecisionRow]:
    stmt = select(DecisionRow)
    if request_ids is not None:
        stmt = stmt.where(col(DecisionRow.request_id).in_(request_ids))
    return {d.request_id: d for d in session.exec(stmt).all()}


def summarize(row: RequestRow, analysis: AnalysisRow | None,
              decision: DecisionRow | None) -> RequestSummary:
    req = RepairRequest.model_validate(row.payload)
    policy = load_policies()[row.client_id]
    vehicle = load_vehicles().get(row.vehicle_id)
    shop = load_shops().get(row.shop_id)
    items = req.line_items
    headline = items[0].description if items else "(no line items)"
    if len(items) > 1:
        headline += f" +{len(items) - 1} more"
    return RequestSummary(
        request_id=row.request_id, client_id=row.client_id, client_name=policy.name,
        vehicle_id=row.vehicle_id,
        vehicle_label=(f"{vehicle.year} {vehicle.make} {vehicle.model}" if vehicle
                       else "Unknown vehicle"),
        unit_number=vehicle.unit_number if vehicle else None,
        shop_id=row.shop_id, shop_name=shop.name if shop else row.shop_id,
        total=row.total, submitted_at=row.submitted_at, status=row.status,
        ai_decision=Decision(analysis.decision) if analysis else None,
        human_action=Decision(decision.human_action) if decision else None,
        injection_flag=bool(detect_injection(req.shop_notes)),
        line_item_count=len(items), headline=headline, is_custom=row.is_custom,
    )


def decision_out(d: DecisionRow | None) -> DecisionOut | None:
    if d is None:
        return None
    return DecisionOut(ai_decision=Decision(d.ai_decision), human_action=Decision(d.human_action),
                       is_override=d.is_override, override_reason=d.override_reason,
                       decided_at=d.decided_at)


def analysis_out(a: AnalysisRow | None) -> AnalysisResult | None:
    return AnalysisResult.model_validate(a.result) if a else None


def warranty_status(vehicle: Vehicle | None, req: RepairRequest) -> list[WarrantyStatus]:
    if vehicle is None:
        return []
    odometer = req.odometer if req.odometer is not None else vehicle.mileage
    elapsed = months_between(vehicle.in_service_date, req.submitted_at.date())
    out = []
    for name, months, miles, covers in (
        ("Basic", vehicle.basic_months, vehicle.basic_miles, BASIC_COVERAGE),
        ("Powertrain", vehicle.powertrain_months, vehicle.powertrain_miles, POWERTRAIN_COVERAGE),
        ("Battery & drive unit", vehicle.battery_months, vehicle.battery_miles, BATTERY_COVERAGE),
    ):
        if months is None or miles is None:
            continue
        out.append(WarrantyStatus(
            name=name, active=elapsed < months and odometer < miles, months_limit=months,
            miles_limit=miles, months_elapsed=elapsed, odometer=req.odometer,
            covers=sorted(str(c) for c in covers),
        ))
    return out
