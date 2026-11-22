# FleetPolicy Copilot: common commands.  Run `make` or `make help` to list them.
#
# Ports can be overridden per command, e.g.  make dev API_PORT=8002 WEB_PORT=3001

API_PORT ?= 8001
WEB_PORT ?= 3000
API_URL  := http://localhost:$(API_PORT)

.DEFAULT_GOAL := help
.PHONY: help install dev backend frontend test lint typecheck check evals evals-offline \
        index reset build clean

help: ## Show this help
	@awk 'BEGIN {FS = ":.*## "} /^[a-zA-Z_-]+:.*## / {printf "  \033[36m%-15s\033[0m %s\n", $$1, $$2}' $(MAKEFILE_LIST)

install: ## Install backend (uv) and frontend (pnpm) dependencies
	cd backend && uv sync
	cd frontend && pnpm install

dev: ## Run backend + frontend together (Ctrl-C stops both)
	@echo "API  → $(API_URL)  (docs: $(API_URL)/docs)"
	@echo "Web  → http://localhost:$(WEB_PORT)"
	@trap 'kill 0' INT TERM; \
	( cd backend && CORS_ORIGIN=http://localhost:$(WEB_PORT) \
	    uv run uvicorn app.main:create_app --factory --reload --port $(API_PORT) ) & \
	( cd frontend && NEXT_PUBLIC_API_URL=$(API_URL) pnpm dev --port $(WEB_PORT) ) & \
	wait

backend: ## Run only the API (with auto-reload)
	cd backend && CORS_ORIGIN=http://localhost:$(WEB_PORT) \
	  uv run uvicorn app.main:create_app --factory --reload --port $(API_PORT)

frontend: ## Run only the web app
	cd frontend && NEXT_PUBLIC_API_URL=$(API_URL) pnpm dev --port $(WEB_PORT)

test: ## Run backend tests (no API key needed)
	cd backend && uv run pytest -q

lint: ## Lint backend (ruff) and frontend (eslint)
	cd backend && uv run ruff check .
	cd frontend && pnpm lint

typecheck: ## Type-check backend (mypy) and frontend (tsc)
	cd backend && uv run mypy app tests scripts
	cd frontend && pnpm exec next typegen >/dev/null && pnpm exec tsc --noEmit

check: lint typecheck test ## Lint, type-check and test everything

evals: ## Run the live eval set (uses OpenAI, ~5¢) → evals/results.json
	cd backend && uv run python -m scripts.run_evals

evals-offline: ## Run evals with no API calls → evals/results.offline.json
	cd backend && uv run python -m scripts.run_evals --offline

index: ## (Re)build the policy embedding index
	cd backend && uv run python -m scripts.build_index

reset: ## Reset demo data (clears analyses and decisions; API must be running)
	@curl -sf -X POST $(API_URL)/demo/reset >/dev/null && echo "Demo data reset." \
	  || echo "Could not reach $(API_URL). Is the backend running?"

build: ## Production build of the frontend
	cd frontend && NEXT_PUBLIC_API_URL=$(API_URL) pnpm build

clean: ## Remove caches and build output (keeps .env, data and the database)
	rm -rf frontend/.next backend/.pytest_cache backend/.mypy_cache backend/.ruff_cache
	find backend -name __pycache__ -not -path "backend/.venv/*" -prune -exec rm -rf {} +
