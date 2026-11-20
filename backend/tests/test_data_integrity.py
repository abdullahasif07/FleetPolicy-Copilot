from __future__ import annotations

import re

from app.data_loader import (
    load_eval_labels,
    load_parts,
    load_policies,
    load_policy_text,
    load_sample_requests,
    load_shops,
    load_vehicles,
)

SECTION_RE = re.compile(r"^### ([A-Z]{2}-\d+\.\d+) ", re.MULTILINE)


def all_section_ids() -> set[str]:
    return {s for cid in load_policies() for s in SECTION_RE.findall(load_policy_text(cid))}


def test_four_clients_with_unique_sections() -> None:
    policies = load_policies()
    assert set(policies) == {"NW", "CV", "HF", "SH"}
    for cid in policies:
        ids = SECTION_RE.findall(load_policy_text(cid))
        assert len(ids) == len(set(ids)) >= 15
        assert all(i.startswith(cid + "-") for i in ids)


def test_structured_policy_sections_exist_in_documents() -> None:
    ids = all_section_ids()
    for p in load_policies().values():
        missing = set(p.sections.values()) - ids
        assert not missing, (p.client_id, missing)


def test_vendor_lists_reference_real_shops() -> None:
    shops = load_shops()
    for p in load_policies().values():
        assert set(p.approved_vendors) <= set(shops)


def test_thirty_vehicles_across_clients() -> None:
    vehicles = load_vehicles()
    assert len(vehicles) == 30
    assert {v.client_id for v in vehicles.values()} == set(load_policies())


def test_forty_requests_reference_valid_data() -> None:
    reqs = load_sample_requests()
    assert len(reqs) == 40
    assert len({r.request_id for r in reqs}) == 40
    parts, shops, vehicles = load_parts(), load_shops(), load_vehicles()
    for r in reqs:
        assert r.shop_id in shops
        assert r.vehicle_id in vehicles
        assert vehicles[r.vehicle_id].client_id == r.client_id
        for li in r.line_items:
            assert li.part_code is None or li.part_code in parts


def test_eval_labels_cover_every_request() -> None:
    labels = load_eval_labels()
    ids = all_section_ids()
    assert {e["request_id"] for e in labels} == {r.request_id for r in load_sample_requests()}
    assert sum(e["is_injection"] for e in labels) == 3
    for e in labels:
        assert e["expected_decision"] in {"APPROVE", "ESCALATE", "DECLINE"}
        assert set(e["expected_section_ids"]) <= ids, e["request_id"]
