"""FastAPI application entry point.

Run with:  uvicorn app.main:create_app --factory
"""

from __future__ import annotations

import logging
import time
import uuid
from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes import router
from app.config import configure_tracing, get_settings
from app.container import Container
from app.db import init_db, make_engine
from app.guardrails.limits import RateLimiter
from app.logging_setup import log, request_id_var, setup_logging

logger = logging.getLogger("app.http")


def create_app(container: Container | None = None) -> FastAPI:
    if container is None:
        settings = get_settings()
        setup_logging(settings.log_level)
        configure_tracing(settings)
        container = Container(
            settings=settings,
            engine=make_engine(settings.database_url),
            rate_limiter=RateLimiter(settings.rate_limit_per_session_per_hour),
            chroma_dir=settings.chroma_dir,
        )

    @asynccontextmanager
    async def lifespan(_: FastAPI) -> AsyncIterator[None]:
        init_db(container.engine)
        log(logger, logging.INFO, "startup", llm_configured=container.settings.has_openai_key,
            model=container.settings.llm_model)
        yield

    app = FastAPI(title="FleetPolicy Copilot API", version="0.1.0",
                  description="Demo with fictional data.", lifespan=lifespan)
    app.state.container = container

    app.add_middleware(
        CORSMiddleware,
        allow_origins=[container.settings.cors_origin],
        allow_methods=["GET", "POST"],
        allow_headers=["Content-Type", "X-Session-ID", "X-Request-ID"],
        expose_headers=["X-Request-ID"],
    )

    @app.middleware("http")
    async def request_context(
        request: Request, call_next: Callable[[Request], Awaitable[Response]]
    ) -> Response:
        incoming = request.headers.get("x-request-id", "")
        rid = incoming if incoming.isalnum() and len(incoming) <= 64 else uuid.uuid4().hex[:16]
        token = request_id_var.set(rid)
        t0 = time.perf_counter()
        try:
            response = await call_next(request)
        finally:
            request_id_var.reset(token)
        response.headers["X-Request-ID"] = rid
        token = request_id_var.set(rid)
        log(logger, logging.INFO, "http", method=request.method, path=request.url.path,
            status=response.status_code, ms=round((time.perf_counter() - t0) * 1000, 1))
        request_id_var.reset(token)
        return response

    app.include_router(router)
    return app

