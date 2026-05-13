-- Migration 0011: Research signals pushed by AI_stock_advisor (M9a)
-- score: +1.0 = strong long, -1.0 = strong short, 0 = neutral

CREATE TABLE research_signals (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    instrument_key TEXT NOT NULL,           -- symbol:mic composite key
    symbol         TEXT NOT NULL,
    mic            TEXT NOT NULL,
    score          NUMERIC(6, 4) NOT NULL CHECK (score BETWEEN -1 AND 1),
    horizon        TEXT NOT NULL CHECK (horizon IN ('1d', '1w', '1m', '3m')),
    source         TEXT NOT NULL,           -- e.g. 'ai_stock_advisor:v1'
    payload        JSONB,                   -- arbitrary structured metadata
    api_key_id     UUID REFERENCES engine_api_keys(id) ON DELETE SET NULL,
    bridge_sub     TEXT,                    -- urbanlife.works user sub when JWT auth used
    expires_at     TIMESTAMPTZ,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_research_signals_instrument ON research_signals (instrument_key, created_at DESC);
CREATE INDEX idx_research_signals_created    ON research_signals (created_at DESC);
CREATE INDEX idx_research_signals_source     ON research_signals (source, created_at DESC);
