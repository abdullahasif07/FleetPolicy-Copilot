"""SQLite persistence (SQLModel): requests, analyses, human decisions and daily usage."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from sqlalchemy import JSON, Column
from sqlalchemy.engine import Engine
from sqlmodel import Field, Session, SQLModel, create_engine, select

from app.data_loader import load_sample_requests


def utcnow() -> datetime:
    return datetime.now(UTC)


class RequestRow(SQLModel, table=True):
    __tablename__ = "requests"

    request_id: str = Field(primary_key=True)
    client_id: str = Field(index=True)
    vehicle_id: str
    shop_id: str
    submitted_at: datetime
    total: float | None = None
    status: str = Field(default="pending", index=True)  # pending | analyzed | decided
    is_custom: bool = False
    payload: dict[str, Any] = Field(sa_column=Column(JSON, nullable=False))


class AnalysisRow(SQLModel, table=True):
    __tablename__ = "analyses"

    id: int | None = Field(default=None, primary_key=True)
    request_id: str = Field(index=True, foreign_key="requests.request_id")
    created_at: datetime = Field(default_factory=utcnow)
    decision: str
    llm_decision: str | None = None
    confidence: float
    overridden_by_rules: bool = False
    injection_detected: bool = False
    model: str | None = None
    latency_ms: float
    tokens_in: int = 0
    tokens_out: int = 0
    cost_usd: float = 0.0
    session_id: str | None = None
    result: dict[str, Any] = Field(sa_column=Column(JSON, nullable=False))


class DecisionRow(SQLModel, table=True):
    __tablename__ = "decisions"

    id: int | None = Field(default=None, primary_key=True)
    request_id: str = Field(index=True, unique=True, foreign_key="requests.request_id")
    analysis_id: int = Field(foreign_key="analyses.id")
    ai_decision: str
    human_action: str
    is_override: bool
    override_reason: str | None = None
    decided_at: datetime = Field(default_factory=utcnow)


class UsageRow(SQLModel, table=True):
    __tablename__ = "usage"

    day: str = Field(primary_key=True)  # YYYY-MM-DD (UTC)
    spend_usd: float = 0.0
    analyses: int = 0


def make_engine(url: str) -> Engine:
    connect_args = {"check_same_thread": False} if url.startswith("sqlite") else {}
    return create_engine(url, connect_args=connect_args)


def seed_requests(session: Session) -> int:
    added = 0
    for req in load_sample_requests():
        if session.get(RequestRow, req.request_id) is None:
            session.add(request_to_row(req.model_dump(mode="json"), req.total))
            added += 1
    session.commit()
    return added


def request_to_row(
    payload: dict[str, Any], total: float | None, custom: bool = False
) -> RequestRow:
    return RequestRow(
        request_id=payload["request_id"],
        client_id=payload["client_id"],
        vehicle_id=payload["vehicle_id"],
        shop_id=payload["shop_id"],
        submitted_at=datetime.fromisoformat(payload["submitted_at"]),
        total=total,
        payload=payload,
        is_custom=custom,
    )


def init_db(engine: Engine) -> None:
    SQLModel.metadata.create_all(engine)
    with Session(engine) as session:
        if session.exec(select(RequestRow).limit(1)).first() is None:
            seed_requests(session)


def reset_demo(engine: Engine) -> None:
    """Drop requests, analyses and decisions, then re-seed. Usage is kept for the spend cap."""
    with Session(engine) as session:
        for model in (DecisionRow, AnalysisRow, RequestRow):  # usage kept: spend cap holds
            for row in session.exec(select(model)).all():
                session.delete(row)
        session.commit()
    init_db(engine)
