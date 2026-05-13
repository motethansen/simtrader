-- Migration 0013: AI evaluations linked to signals (M9a)
-- verdict: buy/sell/hold/watch
-- confidence: 0.0 (none) .. 1.0 (certain)

CREATE TABLE research_evaluations (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    signal_id      UUID REFERENCES research_signals(id) ON DELETE SET NULL,
    instrument_key TEXT NOT NULL,
    verdict        TEXT NOT NULL CHECK (verdict IN ('buy', 'sell', 'hold', 'watch')),
    confidence     NUMERIC(4, 3) NOT NULL CHECK (confidence BETWEEN 0 AND 1),
    rationale      TEXT,
    model          TEXT,                    -- e.g. 'claude-opus-4-7'
    api_key_id     UUID REFERENCES engine_api_keys(id) ON DELETE SET NULL,
    bridge_sub     TEXT,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_research_evaluations_instrument ON research_evaluations (instrument_key, created_at DESC);
CREATE INDEX idx_research_evaluations_signal     ON research_evaluations (signal_id);
CREATE INDEX idx_research_evaluations_created    ON research_evaluations (created_at DESC);
