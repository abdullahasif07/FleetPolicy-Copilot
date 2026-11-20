"""Loads the fictional reference data from /data (read-only, cached)."""

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
def load_policies() -> dict[str, ClientPolicy]:
    return {
        c["client_id"]: ClientPolicy.model_validate(c) for c in _clients_file()["clients"]
    }


@cache
def load_shops() -> dict[str, Shop]:
    return {s["shop_id"]: Shop.model_validate(s) for s in _clients_file()["shops"]}


@cache
def load_vehicles() -> dict[str, Vehicle]:
    with open(data_dir() / "vehicles.csv", encoding="utf-8", newline="") as f:
        rows = [Vehicle.model_validate(_blank_to_none(r)) for r in csv.DictReader(f)]
    return {v.vehicle_id: v for v in rows}


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
    policy = load_policies()[client_id]
    return (data_dir() / policy.policy_file).read_text(encoding="utf-8")


def load_eval_labels() -> list[dict[str, Any]]:
    with open(data_dir() / "evals.json", encoding="utf-8") as f:
        items: list[dict[str, Any]] = json.load(f)["items"]
    return items
