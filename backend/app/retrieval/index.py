"""Hybrid policy retrieval: BM25 + Chroma vector search, fused with reciprocal-rank fusion.

All searches are filtered by ``client_id`` so one client's policy can never be cited for
another client's request.
"""

from __future__ import annotations

import hashlib
import re
import threading
from pathlib import Path

import chromadb
from chromadb.api import ClientAPI
from chromadb.config import Settings as ChromaSettings
from pydantic import BaseModel
from rank_bm25 import BM25Okapi

from app.data_loader import load_policies, load_policy_text
from app.retrieval.chunker import PolicyChunk, chunk_policy
from app.retrieval.embeddings import Embedder

_RRF_K = 60
_STOPWORDS = frozenset(
    "a an and are as at be by for from has in is it its of on or that the this to was were "
    "will with any all must may not no".split()
)


def tokenize(text: str) -> list[str]:
    return [t for t in re.findall(r"[a-z0-9]+", text.lower()) if t not in _STOPWORDS]


class RetrievedChunk(BaseModel):
    chunk: PolicyChunk
    score: float
    bm25_rank: int | None = None
    vector_rank: int | None = None
    source: str = "search"  # "search" | "rule" (pinned because a rule cited it)


def load_all_chunks() -> list[PolicyChunk]:
    return [c for cid in load_policies() for c in chunk_policy(cid, load_policy_text(cid))]


class PolicyIndex:
    def __init__(self, embedder: Embedder, client: ClientAPI, chunks: list[PolicyChunk]) -> None:
        self.embedder = embedder
        self.embedding_tokens = 0
        self._chunks = {c.chunk_id: c for c in chunks}
        self._by_section = {c.section_id: c for c in chunks}
        self._bm25: dict[str, tuple[BM25Okapi, list[PolicyChunk]]] = {}
        for cid in {c.client_id for c in chunks}:
            self._build_bm25(cid)

        digest = hashlib.sha256(
            ("|".join(c.embed_text for c in chunks) + embedder.model).encode()
        ).hexdigest()[:12]
        safe_model = re.sub(r"[^a-zA-Z0-9]", "-", embedder.model)
        self._collection = client.get_or_create_collection(
            f"policies-{safe_model}-{digest}", embedding_function=None,
            metadata={"hnsw:space": "cosine"},
        )
        if self._collection.count() != len(chunks):
            self._upsert(chunks)

    def _build_bm25(self, client_id: str) -> None:
        client_chunks = [c for c in self._chunks.values() if c.client_id == client_id]
        self._bm25[client_id] = (BM25Okapi([tokenize(c.embed_text) for c in client_chunks]),
                                 client_chunks)

    def _upsert(self, chunks: list[PolicyChunk]) -> None:
        vectors, tokens = self.embedder.embed([c.embed_text for c in chunks])
        self.embedding_tokens += tokens
        self._collection.upsert(
            ids=[c.chunk_id for c in chunks],
            embeddings=vectors,  # type: ignore[arg-type]
            documents=[c.text for c in chunks],
            metadatas=[{"client_id": c.client_id, "section_id": c.section_id}
                       for c in chunks],
        )

    def add_client(self, client_id: str, chunks: list[PolicyChunk]) -> None:
        """Index a newly onboarded client's policy (replacing any previous version)."""
        self.remove_client(client_id)
        self._upsert(chunks)
        for c in chunks:
            self._chunks[c.chunk_id] = c
            self._by_section[c.section_id] = c
        self._build_bm25(client_id)

    def remove_client(self, client_id: str) -> None:
        old = [c for c in self._chunks.values() if c.client_id == client_id]
        if old:
            self._collection.delete(ids=[c.chunk_id for c in old])
        for c in old:
            del self._chunks[c.chunk_id]
            self._by_section.pop(c.section_id, None)
        self._bm25.pop(client_id, None)

    def get_section(self, section_id: str) -> PolicyChunk | None:
        return self._by_section.get(section_id)

    def sections_for(self, client_id: str) -> list[PolicyChunk]:
        return [c for c in self._chunks.values() if c.client_id == client_id]

    def search(self, client_id: str, query: str, k: int = 6) -> tuple[list[RetrievedChunk], int]:
        """Return the top-k fused results and the embedding tokens spent on the query."""
        if client_id not in self._bm25:
            return [], 0
        bm25, client_chunks = self._bm25[client_id]
        scores = bm25.get_scores(tokenize(query))
        bm25_order = sorted(range(len(client_chunks)), key=lambda i: scores[i], reverse=True)
        bm25_ranks = {client_chunks[i].chunk_id: r for r, i in enumerate(bm25_order, 1)
                      if scores[i] > 0}

        qvec, tokens = self.embedder.embed([query])
        res = self._collection.query(
            query_embeddings=qvec,  # type: ignore[arg-type]
            n_results=min(len(client_chunks), max(k * 2, 10)),
            where={"client_id": client_id},
        )
        vector_ranks = {cid: r for r, cid in enumerate(res["ids"][0], 1)}

        fused: dict[str, float] = {}
        for ranks in (bm25_ranks, vector_ranks):
            for cid, rank in ranks.items():
                fused[cid] = fused.get(cid, 0.0) + 1.0 / (_RRF_K + rank)
        top = sorted(fused, key=lambda cid: fused[cid], reverse=True)[:k]
        return [
            RetrievedChunk(chunk=self._chunks[cid], score=round(fused[cid], 5),
                           bm25_rank=bm25_ranks.get(cid), vector_rank=vector_ranks.get(cid))
            for cid in top
        ], tokens


_lock = threading.Lock()
_index: PolicyIndex | None = None


def get_policy_index(embedder: Embedder, chroma_dir: Path | None) -> PolicyIndex:
    """Process-wide index. Persists to ``chroma_dir`` (or memory when None)."""
    global _index
    with _lock:
        if _index is None or _index.embedder.model != embedder.model:
            settings = ChromaSettings(anonymized_telemetry=False)
            client = (chromadb.PersistentClient(path=str(chroma_dir), settings=settings)
                      if chroma_dir else chromadb.EphemeralClient(settings=settings))
            _index = PolicyIndex(embedder, client, load_all_chunks())
        return _index


def current_index() -> PolicyIndex | None:
    """The process-wide index if it has been built (used to add onboarded clients)."""
    return _index
