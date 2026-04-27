# Auto-load .env if it exists (exports all vars to subprocesses, including wrangler)
ifneq (,$(wildcard ./.env))
  include .env
  export
endif

.PHONY: install dev test lint format demo up down \
        migrate migrate-status migrate-history seed-admin \
        workers-install workers-dev workers-deploy workers-deploy-staging \
        workers-kv-create workers-secrets-put gen-encryption-key

# --- Python ---
install:
	python3.11 -m pip install -e .

dev:
	python3.11 -m pip install -e ".[dev,api]"

test:
	.venv311/bin/pytest

lint:
	ruff check src tests

format:
	ruff format src tests

demo:
	tradingplatform backtest --demo

# --- Docker ---
up:
	docker compose up -d

down:
	docker compose down

# --- Database ---
migrate:
	alembic upgrade head

migrate-status:
	alembic current

migrate-history:
	alembic history --verbose

# Create the first admin user. Set SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD in .env
seed-admin:
	tradingplatform seed-admin \
		--email "$(SEED_ADMIN_EMAIL)" \
		--password "$(SEED_ADMIN_PASSWORD)"

# --- Workers (Cloudflare) ---
workers-install:
	cd workers && npm install

workers-dev:
	cd workers && npx wrangler dev

workers-deploy:
	cd workers && npx wrangler deploy --env production

workers-deploy-staging:
	cd workers && npx wrangler deploy --env staging

# Create KV namespaces and print IDs to paste into wrangler.toml
# Run once per environment. Requires Workers KV Storage: Edit permission on your API token.
workers-kv-create:
	@echo "=== Creating KV namespaces ==="
	@echo "--- development preview ---"
	cd workers && npx wrangler kv:namespace create KV --preview
	@echo "--- development ---"
	cd workers && npx wrangler kv:namespace create KV
	@echo "--- staging ---"
	cd workers && npx wrangler kv:namespace create KV --env staging
	@echo "--- staging preview ---"
	cd workers && npx wrangler kv:namespace create KV --env staging --preview
	@echo "--- production ---"
	cd workers && npx wrangler kv:namespace create KV --env production
	@echo ""
	@echo "Paste the IDs printed above into workers/wrangler.toml"

# Push secrets to the deployed Worker (production). Run after first deploy.
# These are read from the current environment / .env file.
workers-secrets-put:
	@echo "$(DATABASE_URL)" | cd workers && npx wrangler secret put DATABASE_URL --env production
	@echo "$(TOKEN_ENCRYPTION_KEY)" | cd workers && npx wrangler secret put TOKEN_ENCRYPTION_KEY --env production

# Generate a secure 32-byte encryption key for TOKEN_ENCRYPTION_KEY
gen-encryption-key:
	@openssl rand -hex 32
