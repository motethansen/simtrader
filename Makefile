# Auto-load .env if it exists (exports all vars to subprocesses, including wrangler)
ifneq (,$(wildcard ./.env))
  include .env
  export
endif

.PHONY: install dev test lint format demo up down \
        migrate migrate-status migrate-history seed-admin \
        workers-config workers-install workers-dev workers-deploy workers-deploy-staging \
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

# Promote an existing user to admin by BudgetApp id. They must have signed in once first —
# simtrader has no passwords and no sign-up of its own (ST-008).
seed-admin:
	tradingplatform seed-admin --budgetapp-id "$(SEED_ADMIN_BUDGETAPP_ID)"

# --- Workers (Cloudflare) ---
# wrangler.toml is gitignored (public repo). Copy the template before the first run.
workers-config:
	@test -f workers/wrangler.toml || cp workers/wrangler.toml.example workers/wrangler.toml
	@echo "workers/wrangler.toml ready — fill in account, KV, Hyperdrive and issuer values"

workers-install:
	cd workers && npm install

workers-dev:
	cd workers && npx wrangler dev

workers-deploy:
	cd workers && npx wrangler deploy --env production

workers-deploy-staging:
	cd workers && npx wrangler deploy --env staging

# Create KV namespaces and print IDs to paste into wrangler.toml.
# The dev and staging namespaces already exist and are filled in; this is for production, or
# for recreating them. Note the wrangler 4 syntax: `kv namespace`, not `kv:namespace`, and one
# namespace per invocation — a "preview" namespace is just a second namespace.
workers-kv-create:
	cd workers && npx wrangler kv namespace create simtrader-KV-production
	@echo ""
	@echo "Paste the id printed above into workers/wrangler.toml under [[env.production.kv_namespaces]]"

# Push secrets to the deployed Worker (production). Run after first deploy.
# These are read from the current environment / .env file.
workers-secrets-put:
	@echo "$(TOKEN_ENCRYPTION_KEY)" | cd workers && npx wrangler secret put TOKEN_ENCRYPTION_KEY --env production
	@echo "$(SIMTRADER_SSO_CLIENT_SECRET)" | cd workers && npx wrangler secret put SIMTRADER_SSO_CLIENT_SECRET --env production

# Generate a secure 32-byte encryption key for TOKEN_ENCRYPTION_KEY
gen-encryption-key:
	@openssl rand -hex 32
