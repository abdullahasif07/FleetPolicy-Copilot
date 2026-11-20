from __future__ import annotations

from app.data_loader import load_policy_text
from app.retrieval.chunker import chunk_policy, split_sentences
from tests.conftest import hash_index


def test_chunker_one_chunk_per_section() -> None:
    chunks = chunk_policy("NW", load_policy_text("NW"))
    ids = [c.section_id for c in chunks]
    assert ids[0] == "NW-1.1" and "NW-10.1" in ids
    c21 = next(c for c in chunks if c.section_id == "NW-2.1")
    assert c21.part == "2. Spending Authority"
    assert "$500.00 or less" in c21.text
    assert "###" not in c21.text


def test_split_sentences_keeps_amounts() -> None:
    s = split_sentences("Limit is $500.00 per job. Above $500.00 escalate.")
    assert s == ["Limit is $500.00 per job.", "Above $500.00 escalate."]


def test_search_is_filtered_by_client() -> None:
    hits, _ = hash_index().search("CV", "brake tire safety critical limit", k=6)
    assert hits and all(h.chunk.client_id == "CV" for h in hits)
    assert "CV-2.2" in [h.chunk.section_id for h in hits[:3]]


def test_hybrid_ranks_relevant_section_first() -> None:
    hits, _ = hash_index().search("HF", "two written quotes required above 750", k=3)
    assert hits[0].chunk.section_id == "HF-2.2"
    assert hits[0].bm25_rank is not None and hits[0].vector_rank is not None


def test_unknown_client_returns_nothing() -> None:
    assert hash_index().search("ZZ", "anything")[0] == []
