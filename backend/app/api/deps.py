from __future__ import annotations

import re
from collections.abc import Iterator

from fastapi import Request
from sqlmodel import Session

from app.container import Container

_SESSION_RE = re.compile(r"^[A-Za-z0-9_-]{8,64}$")


def get_container(request: Request) -> Container:
    container: Container = request.app.state.container
    return container


def get_db(request: Request) -> Iterator[Session]:
    with Session(get_container(request).engine) as session:
        yield session


def session_id(request: Request) -> str:
    """Per-browser session from the X-Session-ID header, falling back to client IP."""
    sid = request.headers.get("x-session-id", "")
    if _SESSION_RE.match(sid):
        return sid
    return f"ip:{request.client.host if request.client else 'unknown'}"
