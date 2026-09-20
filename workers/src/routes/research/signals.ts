// A4-A7: Research signal push/pull (M9a)
// POST /research/signals             — push a signal (engine key or JWT)
// GET  /research/signals             — list signals (paginated)
// GET  /research/signals/:id         — signal detail
// POST /research/signals/:id/actions — user action on a signal (session auth)

import { Hono } from 'hono'
import type { Env, HonoVars, SignalHorizon } from '../../lib/types'
import { getDb } from '../../lib/db'
import { requireResearchAuth, requireResearchOrSession } from '../../middleware/research-auth'

const VALID_HORIZONS: SignalHorizon[] = ['1d', '1w', '1m', '3m']
const VALID_ACTIONS = ['acknowledged', 'dismissed', 'queued', 'executed'] as const

const signals = new Hono<{ Bindings: Env; Variables: HonoVars }>()

// POST /research/signals
signals.post('/', requireResearchAuth, async (c) => {
  const body = await c.req.json().catch(() => ({})) as Record<string, unknown>

  const instrumentKey = typeof body['instrument_key'] === 'string' ? body['instrument_key'].trim() : null
  const score = typeof body['score'] === 'number' ? body['score'] : null
  const horizon = typeof body['horizon'] === 'string' ? body['horizon'] : null
  const source = typeof body['source'] === 'string' && (body['source'] as string).trim() ? (body['source'] as string).trim() : null
  const payload = body['payload'] && typeof body['payload'] === 'object' ? body['payload'] : null
  const expiresAt = typeof body['expires_at'] === 'string' ? body['expires_at'] : null

  if (!instrumentKey) return c.json({ error: 'instrument_key is required' }, 400)
  if (score === null || score < -1 || score > 1) return c.json({ error: 'score must be between -1 and 1' }, 400)
  if (!horizon || !VALID_HORIZONS.includes(horizon as SignalHorizon)) {
    return c.json({ error: `horizon must be one of: ${VALID_HORIZONS.join(', ')}` }, 400)
  }
  if (!source) return c.json({ error: 'source is required' }, 400)

  const parts = instrumentKey.split(':')
  if (parts.length !== 2) return c.json({ error: 'instrument_key must be symbol:mic' }, 400)
  const [symbol, mic] = parts as [string, string]

  const sql = getDb(c.env)
  try {
    const rows = await sql<{ id: string; createdAt: string }[]>`
      INSERT INTO research_signals
        (instrument_key, symbol, mic, score, horizon, source, payload, api_key_id, bridge_sub, expires_at)
      VALUES
        (${instrumentKey}, ${symbol}, ${mic}, ${score}, ${horizon}, ${source},
         ${payload ? JSON.stringify(payload) : null}::jsonb,
         ${c.var.apiKeyId ?? null}, ${c.var.bridgeSub ?? null}, ${expiresAt})
      RETURNING id, created_at
    `
    return c.json({ id: rows[0]!.id, created_at: rows[0]!.createdAt }, 201)
  } finally {
    await sql.end()
  }
})

// GET /research/signals
signals.get('/', requireResearchOrSession, async (c) => {
  const instrumentKey = c.req.query('instrument_key') ?? null
  const source = c.req.query('source') ?? null
  const horizon = c.req.query('horizon') ?? null
  const limit = Math.min(parseInt(c.req.query('limit') ?? '50', 10), 200)
  const before = c.req.query('before') ?? null

  const sql = getDb(c.env)
  try {
    const rows = await sql`
      SELECT id, instrument_key, symbol, mic, score, horizon, source,
             api_key_id, bridge_sub, expires_at, created_at
      FROM research_signals
      WHERE
        (${instrumentKey}::text IS NULL OR instrument_key = ${instrumentKey})
        AND (${source}::text IS NULL OR source = ${source})
        AND (${horizon}::text IS NULL OR horizon = ${horizon})
        AND (${before}::uuid IS NULL OR id < ${before}::uuid)
      ORDER BY created_at DESC
      LIMIT ${limit}
    `
    return c.json(rows)
  } finally {
    await sql.end()
  }
})

// GET /research/signals/:id
signals.get('/:id', requireResearchOrSession, async (c) => {
  const id = c.req.param('id')
  const sql = getDb(c.env)
  try {
    const rows = await sql`
      SELECT id, instrument_key, symbol, mic, score, horizon, source,
             payload, api_key_id, bridge_sub, expires_at, created_at
      FROM research_signals
      WHERE id = ${id}
      LIMIT 1
    `
    if (!rows[0]) return c.json({ error: 'Signal not found' }, 404)
    return c.json(rows[0])
  } finally {
    await sql.end()
  }
})

// POST /research/signals/:id/actions — session auth only (user action on signal)
signals.post('/:id/actions', requireResearchOrSession, async (c) => {
  // This endpoint only makes sense for authenticated simtrader users, not engine keys
  if (c.var.authMethod !== 'session') {
    return c.json({ error: 'Signal actions require a user session' }, 403)
  }

  const signalId = c.req.param('id')
  const body = await c.req.json().catch(() => ({})) as Record<string, unknown>
  const action = typeof body['action'] === 'string' ? body['action'] : null
  const detail = body['detail'] && typeof body['detail'] === 'object' ? body['detail'] : null

  if (!action || !VALID_ACTIONS.includes(action as typeof VALID_ACTIONS[number])) {
    return c.json({ error: `action must be one of: ${VALID_ACTIONS.join(', ')}` }, 400)
  }

  const sql = getDb(c.env)
  try {
    const signalRows = await sql`SELECT id FROM research_signals WHERE id = ${signalId} LIMIT 1`
    if (!signalRows[0]) return c.json({ error: 'Signal not found' }, 404)

    const rows = await sql<{ id: string; createdAt: string }[]>`
      INSERT INTO signal_actions (signal_id, user_id, action, detail)
      VALUES (${signalId}, ${c.var.userId}, ${action}, ${detail ? JSON.stringify(detail) : null}::jsonb)
      RETURNING id, created_at
    `
    return c.json({ id: rows[0]!.id, signal_id: signalId, action, created_at: rows[0]!.createdAt }, 201)
  } finally {
    await sql.end()
  }
})

export default signals
