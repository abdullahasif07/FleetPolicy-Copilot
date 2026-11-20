"""Application settings, read from environment variables and the project-root .env file."""

from __future__ import annotations

import os
from functools import cache
from pathlib import Path

from pydantic import Field, SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parents[1]
ROOT_DIR = BACKEND_DIR.parent

# Approximate public list prices, USD per 1M tokens (input, output). Used for cost
# reporting and the daily spend cap; override by editing this table.
MODEL_PRICING: dict[str, tuple[float, float]] = {
    "gpt-4.1-mini": (0.40, 1.60),
    "gpt-4.1-nano": (0.10, 0.40),
    "gpt-4.1": (2.00, 8.00),
    "gpt-4o-mini": (0.15, 0.60),
    "gpt-4o": (2.50, 10.00),
    "text-embedding-3-small": (0.02, 0.0),
    "text-embedding-3-large": (0.13, 0.0),
}


def estimate_cost(model: str, tokens_in: int, tokens_out: int) -> float:
    """USD estimate. Dated variants (e.g. gpt-4.1-mini-2025-04-14) match their base name;
    unknown models (fakes, stand-ins) cost 0."""
    matches = [k for k in MODEL_PRICING if model == k or model.startswith(k + "-")]
    if not matches:
        return 0.0
    price_in, price_out = MODEL_PRICING[max(matches, key=len)]
    return (tokens_in * price_in + tokens_out * price_out) / 1_000_000


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(ROOT_DIR / ".env", BACKEND_DIR / ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    openai_api_key: SecretStr | None = None
    llm_model: str = "gpt-4.1-mini"
    llm_fallback_model: str = "gpt-4o-mini"
    embedding_model: str = "text-embedding-3-small"
    llm_timeout_seconds: float = 30.0
    llm_max_retries: int = Field(default=3, ge=0, le=6)

    rate_limit_per_session_per_hour: int = Field(default=20, ge=1)
    daily_spend_cap_usd: float = Field(default=2.0, ge=0)

    database_url: str = f"sqlite:///{BACKEND_DIR / 'fleetpolicy.db'}"
    cors_origin: str = "http://localhost:3000"
    log_level: str = "INFO"
    chroma_dir: Path = BACKEND_DIR / ".chroma"
    retrieval_top_k: int = Field(default=6, ge=1, le=20)
    evals_results_path: Path = ROOT_DIR / "evals" / "results.json"

    langsmith_tracing: bool = False
    langsmith_api_key: SecretStr | None = None
    langsmith_project: str = "fleetpolicy-copilot"

    @property
    def has_openai_key(self) -> bool:
        key = self.openai_api_key.get_secret_value() if self.openai_api_key else ""
        return bool(key) and not key.startswith("sk-your")


def configure_tracing(settings: Settings) -> None:
    """LangSmith/LangGraph read tracing config from os.environ, so export it there."""
    if settings.langsmith_tracing and settings.langsmith_api_key:
        os.environ["LANGSMITH_TRACING"] = "true"
        os.environ["LANGSMITH_API_KEY"] = settings.langsmith_api_key.get_secret_value()
        os.environ["LANGSMITH_PROJECT"] = settings.langsmith_project
    else:
        os.environ["LANGSMITH_TRACING"] = "false"


@cache
def get_settings() -> Settings:
    return Settings()
