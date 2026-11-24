"""Wires settings, database, guardrails and the (lazily created) agent dependencies."""

from __future__ import annotations

import threading
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path
from typing import cast

from sqlalchemy.engine import Engine

from app.agent.graph import AgentDeps
from app.agent.llm import LLMClient, LLMUnavailableError, OpenAILLM, StructuredLLM
from app.config import Settings
from app.guardrails.limits import RateLimiter
from app.retrieval.chunker import PolicyChunk
from app.retrieval.embeddings import Embedder, OpenAIEmbedder
from app.retrieval.index import PolicyIndex, current_index, get_policy_index


@dataclass
class Container:
    settings: Settings
    engine: Engine
    rate_limiter: RateLimiter
    llm_factory: Callable[[], LLMClient] | None = None
    embedder_factory: Callable[[], Embedder] | None = None
    chroma_dir: Path | None = None
    _deps: AgentDeps | None = field(default=None, init=False)
    _drafter: StructuredLLM | None = field(default=None, init=False)
    _lock: threading.Lock = field(default_factory=threading.Lock, init=False)

    def _llm(self) -> LLMClient:
        return self.llm_factory() if self.llm_factory else OpenAILLM(self.settings)

    def _embedder(self) -> Embedder:
        if self.embedder_factory:
            return self.embedder_factory()
        if not self.settings.has_openai_key:
            raise LLMUnavailableError("OPENAI_API_KEY is not configured")
        return OpenAIEmbedder(self.settings)

    def index(self) -> PolicyIndex:
        return self.agent_deps().index

    def agent_deps(self) -> AgentDeps:
        with self._lock:
            if self._deps is None:
                index = get_policy_index(self._embedder(), self.chroma_dir)
                self._deps = AgentDeps(index=index, llm=self._llm(),
                                       top_k=self.settings.retrieval_top_k)
            return self._deps

    def drafter(self) -> StructuredLLM:
        """LLM used to draft a new client's settings (no index needed)."""
        with self._lock:
            if self._drafter is None:
                llm = self._llm()
                if not hasattr(llm, "structured"):
                    raise LLMUnavailableError("this LLM client can't draft policies")
                self._drafter = cast(StructuredLLM, llm)
            return self._drafter

    def index_client(self, client_id: str, chunks: list[PolicyChunk]) -> None:
        """Add a client's policy to the search index if it is already built; otherwise it
        is picked up (from the client registry) when the index is first built."""
        with self._lock:
            index = current_index()
            if index is not None:
                index.add_client(client_id, chunks)

    def unindex_clients(self, client_ids: list[str]) -> None:
        with self._lock:
            index = current_index()
            if index is not None:
                for client_id in client_ids:
                    index.remove_client(client_id)
