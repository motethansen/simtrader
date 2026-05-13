# Sprint 03 — M9a: Research Engine Push/Pull Surface

**Sprint goal**: Expose a secure HTTP surface on the simtrader Worker that lets the AI_stock_advisor engine (and any future research engine) push signals and evaluations, pull portfolio context, and be provisioned as a first-class authenticated peer — either via a long-lived Engine API key or a bridge JWT issued by the urbanlife.works SSO.

**Milestone**: M9a (subset of M9 — Research Agent)
**Status**: In progress
**Period**: Sprint 03 (2026-05-13)

**Prerequisites**:
- Sprint 02 complete (W1 auth tables: `users`, `audit_log` live)
- `DATABASE_URL` secret wrangled
- `SSO_JWKS_URL` + `SSO_AUDIENCE` env vars set (can be placeholder for local dev)
- `ENGINE_KEY_SIGNING_SECRET` env var set (64 hex chars) for generating engine keys

---

## Context

AI_stock_advisor is a sibling project under the urbanlife.works umbrella (deployed separately). It needs a stable API to:

1. **Push** research signals (`score`, `horizon`, `instrument`, `source`) and AI evaluations (`verdict`, `confidence`, `rationale`) into simtrader so users can act on them.
2. **Pull** portfolio snapshots and tracked instrument lists to inform research runs.
3. **Authenticate** without browser sessions — either via a long-lived engine API key (provisioned by an admin) or via a bridge JWT signed by the urbanlife.works SSO (for user-scoped calls).

Part B (UI: signal card in dashboard, evaluation timeline) is deferred to urbanlife_works sprint.

---

## Database schema

All migrations live in `src/tradingplatform/persistence/migrations/`.

### Migration 0010 — engine_api_keys

```sql
CREATE TABLE engine_api_keys (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name         TEXT NOT NULL,
    key_hash     TEXT NOT NULL,        -- SHA-256 hex of raw key; never store raw
    key_prefix   TEXT NOT NULL,        -- first 8 chars of raw key (display only)
    scopes       TEXT[] NOT NULL DEFAULT '{}',
    last_used_at TIMESTAMPTZ,
    expires_at   TIMESTAMPTZ,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    revoked_at   TIMESTAMPTZ
);
CREATE UNIQUE INDEX idx_engine_api_keys_hash   ON engine_api_keys (key_hash);
CREATE INDEX        idx_engine_api_keys_prefix ON engine_api_keys (key_prefix);
```

### Migration 0011 — research_signals

```sql
CREATE TABLE research_signals (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    instrument_key TEXT NOT NULL,
    symbol         TEXT NOT NULL,
    mic            TEXT NOT NULL,
    score          NUMERIC(6, 4) NOT NULL CHECK (score BETWEEN -1 AND 1),
    horizon        TEXT NOT NULL CHECK (horizon IN ('1d', '1w', '1m', '3m')),
    source         TEXT NOT NULL,
    payload        JSONB,
    api_key_id     UUID REFERENCES engine_api_keys(id) ON DELETE SET NULL,
    bridge_sub     TEXT,               -- urbanlife_works user sub (if JWT auth)
    expires_at     TIMESTAMPTZ,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_research_signals_instrument ON research_signals (instrument_key, created_at DESC);
CREATE INDEX idx_research_signals_created    ON research_signals (created_at DESC);
CREATE INDEX idx_research_signals_source     ON research_signals (source, created_at DESC);
```

### Migration 0012 — research_instruments

```sql
CREATE TABLE research_instruments (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    symbol      TEXT NOT NULL,
    mic         TEXT NOT NULL,
    name        TEXT,
    asset_class TEXT NOT NULL DEFAULT 'equity',
    currency    TEXT NOT NULL DEFAULT 'USD',
    tracked     BOOLEAN NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_research_instruments_key UNIQUE (symbol, mic)
);
CREATE INDEX idx_research_instruments_tracked ON research_instruments (tracked, symbol);
```

### Migration 0013 — research_evaluations

```sql
CREATE TABLE research_evaluations (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    signal_id      UUID REFERENCES research_signals(id) ON DELETE SET NULL,
    instrument_key TEXT NOT NULL,
    verdict        TEXT NOT NULL CHECK (verdict IN ('buy', 'sell', 'hold', 'watch')),
    confidence     NUMERIC(4, 3) NOT NULL CHECK (confidence BETWEEN 0 AND 1),
    rationale      TEXT,
    model          TEXT,
    api_key_id     UUID REFERENCES engine_api_keys(id) ON DELETE SET NULL,
    bridge_sub     TEXT,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_research_evaluations_instrument ON research_evaluations (instrument_key, created_at DESC);
CREATE INDEX idx_research_evaluations_signal     ON research_evaluations (signal_id);
CREATE INDEX idx_research_evaluations_created    ON research_evaluations (created_at DESC);
```

### Migration 0014 — signal_actions

```sql
CREATE TABLE signal_actions (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    signal_id  UUID NOT NULL REFERENCES research_signals(id) ON DELETE CASCADE,
    user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    action     TEXT NOT NULL CHECK (action IN ('acknowledged', 'dismissed', 'queued', 'executed')),
    detail     JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_signal_actions_signal ON signal_actions (signal_id);
CREATE INDEX idx_signal_actions_user   ON signal_actions (user_id, created_at DESC);
```

### Migration 0015 — bridge_jwt_identities

```sql
CREATE TABLE bridge_jwt_identities (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    iss          TEXT NOT NULL,
    sub          TEXT NOT NULL,
    email        TEXT,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_bridge_jwt_identities_iss_sub UNIQUE (iss, sub)
);
CREATE INDEX idx_bridge_jwt_identities_user ON bridge_jwt_identities (user_id);
```

---

## Part A — Research API (Worker routes)

All routes are mounted at `/research/*`.

### A1. Admin: engine API key management

- [ ] `POST /research/engine-keys`
  - Admin-only (session cookie with `role='admin'`)
  - Body: `{ name: string, scopes: string[], expires_at?: string }`
  - Generates a random 32-byte key (`sk_` prefix + hex)
  - Stores SHA-256 hash; returns `{ id, raw_key }` **once** — not stored
  - Writes audit log: `action='engine_key.create'`
- [ ] `GET /research/engine-keys`
  - Admin-only
  - Returns `[{ id, name, key_prefix, scopes, last_used_at, expires_at, revoked_at }]`
- [ ] `DELETE /research/engine-keys/:id`
  - Admin-only
  - Sets `revoked_at = NOW()`
  - Writes audit log: `action='engine_key.revoke'`

### A2. Health check

- [ ] `GET /research/health` — no auth required
  - Returns `{ ok: true, ts: <ISO> }`
  - Used by AI_stock_advisor to verify connectivity

### A3. Instruments

- [ ] `GET /research/instruments` — requires research auth (engine key OR bridge JWT)
  - Query: `?tracked=true` (default), `?tracked=false`, `?tracked=all`
  - Returns `[{ id, symbol, mic, name, asset_class, currency, tracked }]`

- [ ] `POST /research/instruments` — requires research auth
  - Body: `{ symbol, mic, name?, asset_class?, currency? }`
  - Upserts (ON CONFLICT (symbol, mic) DO UPDATE)
  - Returns the created/updated row

### A4. Signals — push

- [ ] `POST /research/signals` — requires research auth
  - Body: `{ instrument_key, score, horizon, source, payload?, expires_at? }`
  - Validates `score ∈ [-1, 1]`, `horizon ∈ ['1d','1w','1m','3m']`
  - Records `api_key_id` or `bridge_sub` based on auth method
  - Returns `{ id, created_at }`
  - Engine-key `last_used_at` bumped fire-and-forget (no await)

### A5. Signals — list

- [ ] `GET /research/signals` — requires research auth
  - Query: `?instrument_key=`, `?source=`, `?horizon=`, `?limit=50`, `?before=<uuid>`
  - Returns paginated `[{ id, instrument_key, score, horizon, source, created_at, expires_at }]`

### A6. Signal detail

- [ ] `GET /research/signals/:id` — requires research auth
  - Returns full signal row including `payload`

### A7. Signal action (user-facing via session)

- [ ] `POST /research/signals/:id/actions` — requires session auth (not engine key)
  - Body: `{ action: 'acknowledged' | 'dismissed' | 'queued' | 'executed', detail? }`
  - Inserts into `signal_actions`
  - Returns `{ id, signal_id, action, created_at }`

### A8. Evaluations — push

- [ ] `POST /research/evaluations` — requires research auth
  - Body: `{ instrument_key, verdict, confidence, rationale?, model?, signal_id? }`
  - Validates `verdict ∈ ['buy','sell','hold','watch']`, `confidence ∈ [0,1]`
  - Returns `{ id, created_at }`

### A9. Evaluations — list

- [ ] `GET /research/evaluations` — requires research auth
  - Query: `?instrument_key=`, `?verdict=`, `?limit=50`, `?before=<uuid>`
  - Returns paginated list

### A10. Portfolio context (pull)

- [ ] `GET /research/portfolio-context` — requires research auth
  - Returns summarised portfolio data useful for research (no token exposure):
    - `{ instruments: [{ symbol, mic, units }], total_positions: N }`
  - Pulls from `holdings` table (W3 milestone); returns empty list if W3 not yet deployed

---

## Auth implementation

### Engine API key

- Format: `sk_<64-hex-chars>` (total 67 chars)
- Bearer token: `Authorization: Bearer sk_<key>`
- Middleware: SHA-256 the key, query `engine_api_keys WHERE key_hash = $1 AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > NOW())`
- On match: bump `last_used_at` fire-and-forget, attach `{ authMethod: 'engine_key', apiKeyId, scopes }`

### Bridge JWT

- Bearer token: `Authorization: Bearer <jwt>`
- JWT claims required: `{ sub, email, iss, aud, exp, iat }`
- `aud` must equal env var `SSO_AUDIENCE` (e.g. `'simtrader'`)
- Signature verified against JWKS at `SSO_JWKS_URL` (RS256 or ES256)
- On success: look up `bridge_jwt_identities` by `(iss, sub)`:
  - If found: update `last_seen_at`, attach `user_id`
  - If not found: auto-provision a simtrader user (`password_hash = NULL`, `role = 'user'`, `status = 'active'`) then insert `bridge_jwt_identities`
- Attach `{ authMethod: 'bridge_jwt', userId, bridgeSub: sub }`

### Middleware resolution order

1. Extract `Authorization: Bearer <token>`
2. If token starts with `sk_` → try engine key path
3. Else if token contains `.` (JWT shape) → try bridge JWT path
4. If session cookie present → try session auth (for `signal_actions` endpoint)
5. Else → 401

---

## Environment variables (additions to wrangler.toml)

```toml
# Non-secret (add to [vars])
SSO_AUDIENCE = "simtrader"

# Secrets (wrangler secret put):
#   SSO_JWKS_URL      — JWKS endpoint of urbanlife.works SSO (e.g. https://auth.urbanlife.works/.well-known/jwks.json)
#   ENGINE_KEY_SIGNING_SECRET — not used for signing, kept for future HMAC key derivation
```

---

## Python research engine module

`src/tradingplatform/research/` — Python-side counterpart for the research surface.

- `models.py` — Pydantic v2 models: `Signal`, `Evaluation`, `ResearchInstrument`, `SignalAction`
- `client.py` — `ResearchClient`: async HTTP client that wraps the Worker API (used by AI_stock_advisor and any DO Function that calls the research surface)
- `scoring.py` — Pure scoring utilities: `momentum_score`, `zscore_mean_reversion` (used by the evaluator agent; stateless, testable without DB)

---

## Definition of done

- [ ] Migrations 0010..0015 exist as `.sql` files under `src/tradingplatform/persistence/migrations/`
- [ ] `GET /research/health` returns 200 with `{"ok":true}` in `wrangler dev`
- [ ] Engine API key round-trip: `POST /research/engine-keys` (admin session) → receive `raw_key` → `GET /research/signals` with that key → 200
- [ ] Bridge JWT round-trip: present a valid JWT → user auto-provisioned → `GET /research/instruments` → 200
- [ ] `POST /research/signals` validates score range (rejects `score=2`)
- [ ] `POST /research/signals` records correct `api_key_id` and bumps `last_used_at`
- [ ] `GET /research/portfolio-context` returns empty list when W3 not deployed
- [ ] `pytest tests/research_engine/` — 12+ tests, all green
- [ ] `cd workers && npm run typecheck` — zero errors
- [ ] `.scrum/progress.md` updated
