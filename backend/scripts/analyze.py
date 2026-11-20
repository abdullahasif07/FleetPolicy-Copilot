"""Run the full agent on one or more sample requests and print the recommendation.

Usage (from backend/):  uv run python -m scripts.analyze R-1001 R-1010
"""

from __future__ import annotations

import asyncio
import sys

from app.agent.graph import AgentDeps, run_analysis
from app.agent.llm import OpenAILLM
from app.config import configure_tracing, get_settings
from app.data_loader import load_sample_requests
from app.retrieval.embeddings import OpenAIEmbedder
from app.retrieval.index import get_policy_index


async def main(ids: list[str]) -> None:
    settings = get_settings()
    if not settings.has_openai_key:
        raise SystemExit("OPENAI_API_KEY is not set in .env")
    configure_tracing(settings)
    deps = AgentDeps(index=get_policy_index(OpenAIEmbedder(settings), settings.chroma_dir),
                     llm=OpenAILLM(settings), top_k=settings.retrieval_top_k)
    reqs = {r.request_id: r for r in load_sample_requests()}
    for rid in ids:
        res = await run_analysis(deps, reqs[rid].model_dump(mode="json"))
        r, t = res.recommendation, res.trace
        print(f"\n=== {rid}: {r.decision} (confidence {r.confidence:.2f}) "
              f"[AI said {r.llm_decision}, rules floor {r.decision_floor}]")
        print(f"    {r.summary}")
        for reason in r.reasons:
            print(f"    - [{reason.citation_section_id}|{reason.source}] {reason.text}")
            print(f"      \"{reason.quoted_clause}\"")
        if r.injection_detected:
            print(f"    ! injection signals: {', '.join(r.injection_signals)}")
        for note in r.validation_notes:
            print(f"    * {note}")
        print(f"    model={t.model} latency={t.latency_ms:.0f}ms tokens={t.tokens_in}/"
              f"{t.tokens_out} cost=${t.cost_usd:.5f}")


if __name__ == "__main__":
    asyncio.run(main(sys.argv[1:] or ["R-1001"]))
