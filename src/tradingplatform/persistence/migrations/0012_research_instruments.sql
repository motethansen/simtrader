-- Migration 0012: Instruments tracked by the research engine (M9a)

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
