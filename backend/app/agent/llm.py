"""LLM clients. OpenAI structured outputs with timeouts, retries/backoff and a fallback model."""

from __future__ import annotations

import asyncio
import logging
import random
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any, Protocol

import openai
from openai import AsyncOpenAI
from pydantic import ValidationError

from app.agent.schemas import LLMRecommendation
from app.config import Settings
from app.logging_setup import log

logger = logging.getLogger(__name__)

Messages = list[dict[str, str]]


@dataclass
class LLMResponse:
    parsed: LLMRecommendation
    model: str
    tokens_in: int
    tokens_out: int
    fallback_used: bool = False


class LLMUnavailableError(RuntimeError):
    pass


class LLMClient(Protocol):
    async def recommend(self, messages: Messages) -> LLMResponse: ...


_RETRYABLE = (
    openai.APITimeoutError,
    openai.APIConnectionError,
    openai.RateLimitError,
    openai.InternalServerError,
    asyncio.TimeoutError,
    ValidationError,
)


class OpenAILLM:
    def __init__(self, settings: Settings) -> None:
        if not settings.has_openai_key or settings.openai_api_key is None:
            raise LLMUnavailableError("OPENAI_API_KEY is not configured")
        client = AsyncOpenAI(api_key=settings.openai_api_key.get_secret_value(),
                             max_retries=0, timeout=settings.llm_timeout_seconds)
        if settings.langsmith_tracing:
            from langsmith.wrappers import wrap_openai

            client = wrap_openai(client)
        self._client = client
        self._models = [settings.llm_model]
        if settings.llm_fallback_model and settings.llm_fallback_model != settings.llm_model:
            self._models.append(settings.llm_fallback_model)
        self._timeout = settings.llm_timeout_seconds
        self._retries = settings.llm_max_retries

    async def _call(self, model: str, messages: Messages) -> LLMResponse:
        resp = await asyncio.wait_for(
            self._client.chat.completions.parse(
                model=model,
                messages=messages,  # type: ignore[arg-type]
                response_format=LLMRecommendation,
                temperature=0,
            ),
            timeout=self._timeout,
        )
        msg = resp.choices[0].message
        if msg.parsed is None:
            raise LLMUnavailableError(f"model returned no parsed output (refusal={msg.refusal!r})")
        usage = resp.usage
        return LLMResponse(parsed=msg.parsed, model=model,
                           tokens_in=usage.prompt_tokens if usage else 0,
                           tokens_out=usage.completion_tokens if usage else 0)

    async def recommend(self, messages: Messages) -> LLMResponse:
        last_error: Exception | None = None
        for i, model in enumerate(self._models):
            for attempt in range(self._retries + 1):
                try:
                    result = await self._call(model, messages)
                    result.fallback_used = i > 0
                    return result
                except openai.AuthenticationError as e:
                    raise LLMUnavailableError("OpenAI authentication failed") from e
                except (openai.BadRequestError, openai.NotFoundError) as e:
                    last_error = e
                    break  # not retryable on this model; try the fallback
                except _RETRYABLE as e:
                    last_error = e
                    delay = min(8.0, 0.5 * 2**attempt) + random.uniform(0, 0.25)
                    log(logger, logging.WARNING, "llm_retry", model=model, attempt=attempt + 1,
                        error=type(e).__name__, delay_s=round(delay, 2))
                    await asyncio.sleep(delay)
            log(logger, logging.WARNING, "llm_model_failed", model=model,
                error=type(last_error).__name__ if last_error else None)
        raise LLMUnavailableError(f"all models failed: {type(last_error).__name__}")


@dataclass
class ScriptedLLM:
    """Test double: returns scripted recommendations without any network access."""

    script: Callable[[Messages], LLMRecommendation]
    model: str = "scripted-fake"
    calls: list[Messages] = field(default_factory=list)

    async def recommend(self, messages: Messages) -> LLMResponse:
        self.calls.append(messages)
        return LLMResponse(parsed=self.script(messages), model=self.model,
                           tokens_in=sum(len(m["content"]) // 4 for m in messages),
                           tokens_out=200)


def failing_llm(exc: Exception) -> Any:
    class _Failing:
        async def recommend(self, messages: Messages) -> LLMResponse:
            raise exc

    return _Failing()
