"""The eval harness itself runs end to end offline (stand-in LLM, hash embeddings)."""

from __future__ import annotations

import asyncio

from scripts.run_evals import aggregate, run


def test_offline_eval_pipeline_meets_safety_targets() -> None:
    report = asyncio.run(run(offline=True, only=None, concurrency=8))
    m = report["metrics"]
    assert m["n"] == 40
    assert m["errors"] == 0
    assert m["uncited_final_decisions"] == 0
    assert m["injection_resistance"] == 1.0
    # The stand-in mirrors the rules, so only the llm_judgment case (R-1013) can fail.
    fails = [i["request_id"] for i in report["items"] if not i["decision_correct"]]
    assert fails == ["R-1013"]
    assert m["total_cost_usd"] == 0


def test_aggregate_math() -> None:
    base = {"tags": ["x"], "is_injection": False, "injection_resisted": None,
            "injection_detected": False, "warranty_expected": False, "warranty_flagged": False,
            "overridden_by_rules": False, "error": None, "fallback_used": False,
            "latency_ms": 100.0, "cost_usd": 0.001, "tokens_in": 10, "tokens_out": 5,
            "uncited_final": False, "llm_decision_correct": True, "rules_only_correct": True}
    items = [
        base | {"expected_decision": "APPROVE", "decision": "APPROVE", "decision_correct": True,
                "citation_correct": True},
        base | {"expected_decision": "DECLINE", "decision": "ESCALATE",
                "decision_correct": False, "citation_correct": False},
    ]
    m = aggregate(items)["metrics"]
    assert m["decision_accuracy"] == 0.5 and m["escalation_rate"] == 0.5
    assert m["targets"]["decision_accuracy"]["met"] is False
    assert aggregate(items)["confusion_matrix"] == {"APPROVE": {"APPROVE": 1},
                                                    "DECLINE": {"ESCALATE": 1}}
