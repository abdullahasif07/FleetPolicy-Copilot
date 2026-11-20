"""Embed the policy documents into the local Chroma index (backend/.chroma).

Usage (from backend/):  uv run python -m scripts.build_index
"""

from __future__ import annotations

from app.config import get_settings
from app.retrieval.embeddings import OpenAIEmbedder
from app.retrieval.index import get_policy_index


def main() -> None:
    settings = get_settings()
    if not settings.has_openai_key:
        raise SystemExit("OPENAI_API_KEY is not set in .env")
    index = get_policy_index(OpenAIEmbedder(settings), settings.chroma_dir)
    n = sum(len(index.sections_for(c)) for c in ("NW", "CV", "HF", "SH"))
    print(f"Indexed {n} policy sections with {settings.embedding_model} "
          f"({index.embedding_tokens} tokens embedded this run) -> {settings.chroma_dir}")


if __name__ == "__main__":
    main()
