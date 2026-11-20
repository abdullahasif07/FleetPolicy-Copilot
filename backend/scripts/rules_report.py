"""Print the deterministic rule-engine result for every sample request.

Usage (from backend/):  uv run python -m scripts.rules_report [REQUEST_ID]
"""

from __future__ import annotations

import sys

from app.data_loader import (
    load_eval_labels,
    load_parts,
    load_policies,
    load_sample_requests,
    load_vehicles,
)
from app.rules.engine import evaluate


def main() -> None:
    only = sys.argv[1] if len(sys.argv) > 1 else None
    labels = {e["request_id"]: e for e in load_eval_labels()}
    policies, vehicles, parts = load_policies(), load_vehicles(), load_parts()
    agree = total = 0
    for req in load_sample_requests():
        if only and req.request_id != only:
            continue
        r = evaluate(req, vehicles.get(req.vehicle_id), policies[req.client_id], parts)
        label = labels[req.request_id]
        ok = r.decision_floor.value == label["expected_decision"]
        total += 1
        agree += ok
        amount = f"${r.computed_total:,.2f}" if r.computed_total is not None else "n/a"
        mark = "ok " if ok else ("LLM" if "llm_judgment" in label["tags"] else "XX ")
        print(f"[{mark}] {req.request_id} {req.client_id} {amount:>11}  rules={r.decision_floor:<8}"
              f" expected={label['expected_decision']:<8} {','.join(label['tags'])}")
        for f in r.flags:
            print(f"        - {f.severity:<8} {f.rule:<16} {f.section_id:<7} {f.message}")
    print(f"\nRule floor matches label on {agree}/{total} "
          "(requests tagged llm_judgment need the LLM step in M2).")


if __name__ == "__main__":
    main()
