-- Migration 0014: User actions taken on signals (M9a)
-- Tracks what a simtrader user decided to do with a research signal.

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
