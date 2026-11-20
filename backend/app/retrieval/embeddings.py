"""Embedding providers: OpenAI for real runs, a deterministic hash embedder for tests."""

from __future__ import annotations

import hashlib
import math
import re
from typing import Protocol

from openai import OpenAI

from app.config import Settings


class Embedder(Protocol):
    model: str

    def embed(self, texts: list[str]) -> tuple[list[list[float]], int]:
        """Return (vectors, tokens_used)."""
        ...


class OpenAIEmbedder:
    def __init__(self, settings: Settings) -> None:
        assert settings.openai_api_key is not None
        self.model = settings.embedding_model
        self._client = OpenAI(api_key=settings.openai_api_key.get_secret_value(),
                              timeout=settings.llm_timeout_seconds,
                              max_retries=settings.llm_max_retries)

    def embed(self, texts: list[str]) -> tuple[list[list[float]], int]:
        resp = self._client.embeddings.create(model=self.model, input=texts)
        return [d.embedding for d in resp.data], resp.usage.total_tokens


class HashEmbedder:
    """Bag-of-words hashing embedder. No network; good enough for tests and offline runs."""

    model = "hash-embedder"

    def __init__(self, dim: int = 256) -> None:
        self.dim = dim

    def embed(self, texts: list[str]) -> tuple[list[list[float]], int]:
        out = []
        for text in texts:
            vec = [0.0] * self.dim
            for tok in re.findall(r"[a-z0-9]+", text.lower()):
                h = int(hashlib.md5(tok.encode()).hexdigest(), 16)
                vec[h % self.dim] += 1.0
            norm = math.sqrt(sum(v * v for v in vec)) or 1.0
            out.append([v / norm for v in vec])
        return out, 0
