"""Loads the fictional reference data from /data (read-only, cached).

Clients onboarded at runtime (see ``app/onboarding``) are kept in a small in-process
registry and merged into ``load_policies`` / ``load_vehicles`` / ``load_policy_text``, so
the rule engine, agent and API treat them exactly like the built-in clients.
"""

from __future__ import annotations

import csv
import json
import os
from functools import cache
from pathlib import Path
from typing import Any

from app.models.domain import ClientPolicy, PartPrice, RepairRequest, Shop, Vehicle

_DEFAULT_DATA_DIR = Path(__file__).resolve().parents[2] / "data"


def data_dir() -> Path:
    return Path(os.environ.get("DATA_DIR", _DEFAULT_DATA_DIR))


def _blank_to_none(row: dict[str, str]) -> dict[str, Any]:
    return {k: (v if v != "" else None) for k, v in row.items()}


@cache
def _clients_file() -> dict[str, Any]:
    with open(data_dir() / "clients.json", encoding="utf-8") as f:
        data: dict[str, Any] = json.load(f)
    return data


@cache
def _file_policies() -> dict[str, ClientPolicy]:
    return {
        c["client_id"]: ClientPolicy.model_validate(c) for c in _clients_file()["clients"]
    }


class _Registered:
    def __init__(self) -> None:
        self.policies: dict[str, ClientPolicy] = {}
        self.texts: dict[str, str] = {}
        self.vehicles: dict[str, list[Vehicle]] = {}


_registered = _Registered()


def register_client(policy: ClientPolicy, policy_text: str, vehicles: list[Vehicle]) -> None:
    if policy.client_id in _file_policies():
        raise ValueError(f"{policy.client_id} is a built-in client")
    _registered.policies[policy.client_id] = policy
    _registered.texts[policy.client_id] = policy_text
    _registered.vehicles[policy.client_id] = vehicles


def unregister_client(client_id: str) -> None:
    for store in (_registered.policies, _registered.texts, _registered.vehicles):
        store.pop(client_id, None)


def registered_client_ids() -> list[str]:
    return list(_registered.policies)


def is_builtin_client(client_id: str) -> bool:
    return client_id in _file_policies()


def load_policies() -> dict[str, ClientPolicy]:
    return {**_file_policies(), **_registered.policies}


@cache
def load_shops() -> dict[str, Shop]:
    return {s["shop_id"]: Shop.model_validate(s) for s in _clients_file()["shops"]}


@cache
def _file_vehicles() -> dict[str, Vehicle]:
    with open(data_dir() / "vehicles.csv", encoding="utf-8", newline="") as f:
        rows = [Vehicle.model_validate(_blank_to_none(r)) for r in csv.DictReader(f)]
    return {v.vehicle_id: v for v in rows}


def load_vehicles() -> dict[str, Vehicle]:
    extra = {v.vehicle_id: v for vs in _registered.vehicles.values() for v in vs}
    return {**_file_vehicles(), **extra}


@cache
def load_parts() -> dict[str, PartPrice]:
    with open(data_dir() / "rates.csv", encoding="utf-8", newline="") as f:
        rows = [r for r in csv.DictReader(f) if r["item_type"] == "part"]
    return {r["code"]: PartPrice.model_validate(r) for r in rows}


@cache
def load_labor_rates() -> list[dict[str, Any]]:
    with open(data_dir() / "rates.csv", encoding="utf-8", newline="") as f:
        return [r for r in csv.DictReader(f) if r["item_type"] == "labor"]


def load_sample_requests() -> list[RepairRequest]:
    with open(data_dir() / "requests.json", encoding="utf-8") as f:
        return [RepairRequest.model_validate(r) for r in json.load(f)]


def load_policy_text(client_id: str) -> str:
    if client_id in _registered.texts:
        return _registered.texts[client_id]
    policy = load_policies()[client_id]
    return (data_dir() / policy.policy_file).read_text(encoding="utf-8")


def load_onboarding_sample() -> str:
    return (data_dir() / "onboarding" / "sample_policy.md").read_text(encoding="utf-8")


def load_eval_labels() -> list[dict[str, Any]]:
    with open(data_dir() / "evals.json", encoding="utf-8") as f:
        items: list[dict[str, Any]] = json.load(f)["items"]
    return items
