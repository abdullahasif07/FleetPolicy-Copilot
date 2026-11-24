"""Parse a new client's vehicle list (pasted CSV, as exported from a fleet system)."""

from __future__ import annotations

import csv
import io

from pydantic import ValidationError

from app.models.domain import Vehicle
from app.onboarding.drafter import OnboardingError

REQUIRED_COLUMNS = ("unit_number", "make", "model", "year", "powertrain", "mileage",
                    "in_service_date", "last_pm_mileage")
WARRANTY_COLUMNS = ("basic_months", "basic_miles", "powertrain_months", "powertrain_miles",
                    "battery_months", "battery_miles")
# Typical manufacturer terms, used when the CSV has no warranty columns.
DEFAULT_WARRANTY = {
    "ICE": {"basic_months": 36, "basic_miles": 36_000,
            "powertrain_months": 60, "powertrain_miles": 100_000},
    "EV": {"basic_months": 36, "basic_miles": 36_000,
           "battery_months": 96, "battery_miles": 100_000},
}
MAX_VEHICLES = 50

SAMPLE_CSV = """\
unit_number,make,model,year,powertrain,mileage,in_service_date,last_pm_mileage
LL-501,Ford,F-59 Step Van,2022,ICE,61200,2022-04-11,55800
LL-502,Isuzu,NPR-HD Box Truck,2025,ICE,14300,2025-01-20,9100
LL-503,Ford,E-Transit,2024,EV,22800,2024-05-06,18000
"""


def parse_vehicles(client_id: str, text: str) -> list[Vehicle]:
    reader = csv.DictReader(io.StringIO(text.strip()))
    columns = [c.strip() for c in reader.fieldnames or []]
    missing = [c for c in REQUIRED_COLUMNS if c not in columns]
    if missing:
        raise OnboardingError(f"Vehicle list is missing columns: {', '.join(missing)}.")
    vehicles: list[Vehicle] = []
    units: set[str] = set()
    for n, raw in enumerate(reader, start=2):
        row = {k.strip(): (v or "").strip() for k, v in raw.items() if k}
        if not any(row.values()):
            continue
        powertrain = row["powertrain"].upper()
        if powertrain not in DEFAULT_WARRANTY:
            raise OnboardingError(f"Vehicle row {n}: powertrain must be ICE or EV.")
        values: dict[str, object] = {c: row[c] for c in REQUIRED_COLUMNS}
        values["powertrain"] = powertrain
        if not row["last_pm_mileage"]:
            values["last_pm_mileage"] = None
        if any(row.get(c) for c in WARRANTY_COLUMNS):
            values |= {c: row.get(c) or None for c in WARRANTY_COLUMNS}
        else:
            values |= DEFAULT_WARRANTY[powertrain]
        try:
            v = Vehicle(vehicle_id=f"V-{client_id}-{len(vehicles) + 1:02d}",
                        client_id=client_id, **values)
        except ValidationError as e:
            field = e.errors()[0]["loc"][0]
            raise OnboardingError(f"Vehicle row {n}: invalid {field}.") from None
        if v.unit_number in units:
            raise OnboardingError(f"Vehicle row {n}: duplicate unit number {v.unit_number}.")
        units.add(v.unit_number)
        vehicles.append(v)
        if len(vehicles) > MAX_VEHICLES:
            raise OnboardingError(f"At most {MAX_VEHICLES} vehicles per client in this demo.")
    if not vehicles:
        raise OnboardingError("Add at least one vehicle so requests can be created.")
    return vehicles
