// A3: Research instruments — tracked instrument registry (M9a)
// GET  /research/instruments  — list (filter by tracked status)
// POST /research/instruments  — upsert an instrument

import { Hono } from 'hono'
import type { Env, HonoVars } from '../../lib/types'
import { getDb } from '../../lib/db'
import { requireResearchAuth } from '../../middleware/research-auth'

const instruments = new Hono<{ Bindings: Env; Variables: HonoVars }>()

// GET /research/instruments
instruments.get('/', requireResearchAuth, async (c) => {
  const trackedParam = c.req.query('tracked') ?? 'true'
  const sql = getDb(c.env)
  try {
    let rows
    if (trackedParam === 'all') {
      rows = await sql`
        SELECT id, symbol, mic, name, asset_class, currency, tracked, created_at, updated_at
        FROM research_instruments
        ORDER BY symbol
      `
    } else {
      const tracked = trackedParam !== 'false'
      rows = await sql`
        SELECT id, symbol, mic, name, asset_class, currency, tracked, created_at, updated_at
        FROM research_instruments
        WHERE tracked = ${tracked}
        ORDER BY symbol
      `
    }
    return c.json(rows)
  } finally {
    await sql.end()
  }
})

// POST /research/instruments
instruments.post('/', requireResearchAuth, async (c) => {
  const body = await c.req.json().catch(() => ({})) as Record<string, unknown>

  const symbol = typeof body['symbol'] === 'string' ? (body['symbol'] as string).trim().toUpperCase() : null
  const mic = typeof body['mic'] === 'string' ? (body['mic'] as string).trim().toUpperCase() : null
  const name = typeof body['name'] === 'string' ? (body['name'] as string).trim() || null : null
  const assetClass = typeof body['asset_class'] === 'string' ? (body['asset_class'] as string).trim() : 'equity'
  const currency = typeof body['currency'] === 'string' ? (body['currency'] as string).trim().toUpperCase() : 'USD'

  if (!symbol) return c.json({ error: 'symbol is required' }, 400)
  if (!mic) return c.json({ error: 'mic is required' }, 400)

  const sql = getDb(c.env)
  try {
    const rows = await sql`
      INSERT INTO research_instruments (symbol, mic, name, asset_class, currency)
      VALUES (${symbol}, ${mic}, ${name}, ${assetClass}, ${currency})
      ON CONFLICT ON CONSTRAINT uq_research_instruments_key
      DO UPDATE SET
        name = COALESCE(EXCLUDED.name, research_instruments.name),
        asset_class = EXCLUDED.asset_class,
        currency = EXCLUDED.currency,
        tracked = TRUE,
        updated_at = NOW()
      RETURNING id, symbol, mic, name, asset_class, currency, tracked, created_at, updated_at
    `
    return c.json(rows[0], 201)
  } finally {
    await sql.end()
  }
})

export default instruments
