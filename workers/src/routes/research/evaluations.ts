// A8-A9: Research evaluations push/pull (M9a)
// POST /research/evaluations  — push an evaluation (engine key or JWT)
// GET  /research/evaluations  — list evaluations (paginated)

import { Hono } from 'hono'
import type { Env, HonoVars, EvaluationVerdict } from '../../lib/types'
import { getDb } from '../../lib/db'
import { requireResearchAuth, requireResearchOrSession } from '../../middleware/research-auth'

const VALID_VERDICTS: EvaluationVerdict[] = ['buy', 'sell', 'hold', 'watch']

const evaluations = new Hono<{ Bindings: Env; Variables: HonoVars }>()

// POST /research/evaluations
evaluations.post('/', requireResearchAuth, async (c) => {
  const body = await c.req.json().catch(() => ({})) as Record<string, unknown>

  const instrumentKey = typeof body['instrument_key'] === 'string' ? (body['instrument_key'] as string).trim() : null
  const verdict = typeof body['verdict'] === 'string' ? body['verdict'] : null
  const confidence = typeof body['confidence'] === 'number' ? body['confidence'] : null
  const rationale = typeof body['rationale'] === 'string' ? (body['rationale'] as string).trim() || null : null
  const model = typeof body['model'] === 'string' ? (body['model'] as string).trim() || null : null
  const signalId = typeof body['signal_id'] === 'string' ? body['signal_id'] : null

  if (!instrumentKey) return c.json({ error: 'instrument_key is required' }, 400)
  if (!verdict || !VALID_VERDICTS.includes(verdict as EvaluationVerdict)) {
    return c.json({ error: `verdict must be one of: ${VALID_VERDICTS.join(', ')}` }, 400)
  }
  if (confidence === null || confidence < 0 || confidence > 1) {
    return c.json({ error: 'confidence must be between 0 and 1' }, 400)
  }

  const sql = getDb(c.env)
  try {
    // Validate signal_id if provided
    if (signalId) {
      const sig = await sql`SELECT id FROM research_signals WHERE id = ${signalId} LIMIT 1`
      if (!sig[0]) return c.json({ error: 'signal_id not found' }, 400)
    }

    const rows = await sql<{ id: string; createdAt: string }[]>`
      INSERT INTO research_evaluations
        (signal_id, instrument_key, verdict, confidence, rationale, model, api_key_id, bridge_sub)
      VALUES
        (${signalId}, ${instrumentKey}, ${verdict}, ${confidence},
         ${rationale}, ${model}, ${c.var.apiKeyId ?? null}, ${c.var.bridgeSub ?? null})
      RETURNING id, created_at
    `
    return c.json({ id: rows[0]!.id, created_at: rows[0]!.createdAt }, 201)
  } finally {
    await sql.end()
  }
})

// GET /research/evaluations
evaluations.get('/', requireResearchOrSession, async (c) => {
  const instrumentKey = c.req.query('instrument_key') ?? null
  const verdict = c.req.query('verdict') ?? null
  const limit = Math.min(parseInt(c.req.query('limit') ?? '50', 10), 200)
  const before = c.req.query('before') ?? null

  const sql = getDb(c.env)
  try {
    const rows = await sql`
      SELECT id, signal_id, instrument_key, verdict, confidence, rationale,
             model, api_key_id, bridge_sub, created_at
      FROM research_evaluations
      WHERE
        (${instrumentKey}::text IS NULL OR instrument_key = ${instrumentKey})
        AND (${verdict}::text IS NULL OR verdict = ${verdict})
        AND (${before}::uuid IS NULL OR id < ${before}::uuid)
      ORDER BY created_at DESC
      LIMIT ${limit}
    `
    return c.json(rows)
  } finally {
    await sql.end()
  }
})

export default evaluations
