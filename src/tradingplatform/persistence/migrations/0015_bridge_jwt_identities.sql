-- Migration 0015: Bridge JWT identity mapping (M9a)
-- Maps urbanlife.works SSO identities (iss + sub) to simtrader users.
-- Rows are created automatically on first JWT contact (auto-provision).
-- password_hash on the linked user is NULL (no direct login possible).

CREATE TABLE bridge_jwt_identities (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    iss          TEXT NOT NULL,             -- JWT issuer URL
    sub          TEXT NOT NULL,             -- JWT subject (urbanlife.works user id)
    email        TEXT,                      -- from JWT claims, informational
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_bridge_jwt_identities_iss_sub UNIQUE (iss, sub)
);

CREATE INDEX idx_bridge_jwt_identities_user ON bridge_jwt_identities (user_id);
