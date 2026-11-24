"""SQLite persistence (SQLModel): requests, analyses, human decisions, daily usage and
clients onboarded through the UI."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from sqlalchemy import JSON, Column
from sqlalchemy.engine import Engine
from sqlmodel import Field, Session, SQLModel, create_engine, select

from app.data_loader import (
    load_sample_requests,
    register_client,
    registered_client_ids,
    unregister_client,
)
from app.models.domain import ClientPolicy, Vehicle


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


class OnboardedClientRow(SQLModel, table=True):
    __tablename__ = "onboarded_clients"

    client_id: str = Field(primary_key=True)
    created_at: datetime = Field(default_factory=utcnow)
    policy_markdown: str
    policy: dict[str, Any] = Field(sa_column=Column(JSON, nullable=False))
    vehicles: list[dict[str, Any]] = Field(sa_column=Column(JSON, nullable=False))

    def register(self) -> tuple[ClientPolicy, list[Vehicle]]:
        policy = ClientPolicy.model_validate(self.policy)
        vehicles = [Vehicle.model_validate(v) for v in self.vehicles]
        register_client(policy, self.policy_markdown, vehicles)
        return policy, vehicles


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
        for row in session.exec(select(OnboardedClientRow)).all():
            row.register()


def reset_demo(engine: Engine) -> list[str]:
    """Back to the original demo: drop requests, analyses, decisions and onboarded clients,
    then re-seed. Usage is kept so the spend cap still holds. Returns removed client IDs."""
    with Session(engine) as session:
        for model in (DecisionRow, AnalysisRow, RequestRow, OnboardedClientRow):
            for row in session.exec(select(model)).all():
                session.delete(row)
        session.commit()
    removed = registered_client_ids()
    for client_id in removed:
        unregister_client(client_id)
    init_db(engine)
    return removed
