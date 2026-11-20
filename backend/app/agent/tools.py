"""Context-lookup tools used by the load_context node (deterministic, read-only)."""

from __future__ import annotations

from app.data_loader import load_parts, load_policies, load_shops, load_vehicles
from app.models.domain import ClientPolicy, PartPrice, Shop, Vehicle


def get_vehicle(vehicle_id: str) -> Vehicle | None:
    return load_vehicles().get(vehicle_id)


def get_client_policy(client_id: str) -> ClientPolicy | None:
    return load_policies().get(client_id)


def get_shop(shop_id: str) -> Shop | None:
    return load_shops().get(shop_id)


def get_parts_reference() -> dict[str, PartPrice]:
    return load_parts()
