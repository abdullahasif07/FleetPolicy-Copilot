"""Per-session rate limiting and a daily LLM spend cap."""

from __future__ import annotations

import threading
import time
from collections import defaultdict, deque
from datetime import UTC, datetime

from sqlalchemy.engine import Engine
from sqlmodel import Session

from app.db import UsageRow


class LimitExceededError(Exception):
    def __init__(self, code: str, message: str, retry_after_s: int | None = None) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.retry_after_s = retry_after_s


class RateLimiter:
    """Sliding one-hour window per session, in memory (single-process demo)."""

    def __init__(self, max_per_hour: int, window_s: float = 3600.0) -> None:
        self.max = max_per_hour
        self.window = window_s
        self._hits: dict[str, deque[float]] = defaultdict(deque)
        self._lock = threading.Lock()

    def check(self, session_id: str) -> None:
        now = time.monotonic()
        with self._lock:
            hits = self._hits[session_id]
            while hits and now - hits[0] > self.window:
                hits.popleft()
            if len(hits) >= self.max:
                retry = int(self.window - (now - hits[0])) + 1
                raise LimitExceededError(
                    "rate_limited",
                    f"You've run {self.max} analyses in the last hour. "
                    f"Please try again in about {max(1, retry // 60)} minutes.",
                    retry,
                )
            hits.append(now)


def today() -> str:
    return datetime.now(UTC).date().isoformat()


def check_spend_cap(engine: Engine, cap_usd: float) -> None:
    with Session(engine) as s:
        usage = s.get(UsageRow, today())
        if usage and usage.spend_usd >= cap_usd:
            raise LimitExceededError(
                "spend_cap",
                f"The demo's daily AI budget (${cap_usd:.2f}) has been reached. "
                "Analyses resume tomorrow (UTC); browsing and past results still work.",
            )


def record_usage(engine: Engine, cost_usd: float) -> None:
    with Session(engine) as s:
        usage = s.get(UsageRow, today()) or UsageRow(day=today())
        usage.spend_usd += cost_usd
        usage.analyses += 1
        s.add(usage)
        s.commit()
