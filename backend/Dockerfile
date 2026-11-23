# Backend API image. Build from the repository root (it needs ../data and ../evals):
#   docker build -f backend/Dockerfile -t fleetpolicy-api .
FROM python:3.12-slim

COPY --from=ghcr.io/astral-sh/uv:0.13.9 /uv /usr/local/bin/uv
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1

WORKDIR /app/backend
COPY backend/pyproject.toml backend/uv.lock backend/.python-version ./
RUN uv sync --frozen --no-dev --no-install-project

COPY backend/app ./app
COPY backend/scripts ./scripts
COPY data /app/data
COPY evals /app/evals

# Writable state (SQLite + Chroma index) lives on a volume; run as a non-root user.
RUN useradd --create-home --uid 10001 app && mkdir -p /app/state && chown app /app/state
USER app
ENV DATABASE_URL=sqlite:////app/state/fleetpolicy.db \
    CHROMA_DIR=/app/state/chroma \
    PATH="/app/backend/.venv/bin:$PATH"

EXPOSE 8000
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/health', timeout=2)"
CMD ["uvicorn", "app.main:create_app", "--factory", "--host", "0.0.0.0", "--port", "8000"]
