-- Migration 0010: Engine API keys for machine-to-machine auth (M9a)
-- Keys are used by AI_stock_advisor and other research engines to call the
-- Worker research API without browser sessions.

CREATE TABLE engine_api_keys (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name         TEXT NOT NULL,
    key_hash     TEXT NOT NULL,         -- SHA-256 hex of raw key; raw key never stored
    key_prefix   TEXT NOT NULL,         -- first 8 chars of raw key (display/lookup only)
    scopes       TEXT[] NOT NULL DEFAULT '{}',
    last_used_at TIMESTAMPTZ,
    expires_at   TIMESTAMPTZ,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    revoked_at   TIMESTAMPTZ
);

CREATE UNIQUE INDEX idx_engine_api_keys_hash   ON engine_api_keys (key_hash);
CREATE INDEX        idx_engine_api_keys_prefix ON engine_api_keys (key_prefix);
