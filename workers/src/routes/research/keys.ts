// A1: Engine API key management — admin-only (M9a)
// POST   /research/engine-keys       — create key (returns raw_key once)
// GET    /research/engine-keys       — list keys
// DELETE /research/engine-keys/:id   — revoke key

import { Hono } from 'hono'
import type { Env, HonoVars } from '../../lib/types'
import { getDb } from '../../lib/db'
import { writeAudit } from '../../lib/audit'

const keys = new Hono<{ Bindings: Env; Variables: HonoVars }>()

function generateEngineKey(): string {
  const raw = crypto.getRandomValues(new Uint8Array(32))
  const hex = Array.from(raw).map(b => b.toString(16).padStart(2, '0')).join('')
  return `sk_${hex}`
}

async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input))
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('')
}

// POST /research/engine-keys
keys.post('/', async (c) => {
  const body = await c.req.json<{ name?: unknown; scopes?: unknown; expires_at?: unknown }>()
    .catch(() => ({} as Record<string, unknown>))

  const name = typeof body.name === 'string' && body.name.trim() ? body.name.trim() : null
  if (!name) return c.json({ error: 'name is required' }, 400)

  const scopes: string[] = Array.isArray(body.scopes)
    ? body.scopes.filter((s): s is string => typeof s === 'string')
    : ['signals:read', 'signals:write', 'evaluations:read', 'evaluations:write', 'instruments:read']

  const expiresAt = typeof body.expires_at === 'string' ? body.expires_at : null

  const rawKey = generateEngineKey()
  const keyHash = await sha256Hex(rawKey)
  const keyPrefix = rawKey.slice(0, 11) // "sk_" + 8 chars

  const sql = getDb(c.env.DATABASE_URL)
  try {
    const rows = await sql<{ id: string; createdAt: string }[]>`
      INSERT INTO engine_api_keys (name, key_hash, key_prefix, scopes, expires_at)
      VALUES (${name}, ${keyHash}, ${keyPrefix}, ${scopes}, ${expiresAt})
      RETURNING id, created_at
    `
    const row = rows[0]!
    await writeAudit({
      sql,
      actorId: c.var.userId,
      action: 'engine_key.create',
      detail: { keyId: row.id, name, scopes },
      ipAddress: c.req.header('CF-Connecting-IP') ?? null,
    })

    // raw_key returned exactly once — not stored
    return c.json({ id: row.id, raw_key: rawKey, name, scopes, created_at: row.createdAt }, 201)
  } finally {
    await sql.end()
  }
})

// GET /research/engine-keys
keys.get('/', async (c) => {
  const sql = getDb(c.env.DATABASE_URL)
  try {
    const rows = await sql`
      SELECT id, name, key_prefix, scopes, last_used_at, expires_at, revoked_at, created_at
      FROM engine_api_keys
      ORDER BY created_at DESC
    `
    return c.json(rows)
  } finally {
    await sql.end()
  }
})

// DELETE /research/engine-keys/:id
keys.delete('/:id', async (c) => {
  const id = c.req.param('id')
  const sql = getDb(c.env.DATABASE_URL)
  try {
    const rows = await sql<{ id: string; name: string }[]>`
      UPDATE engine_api_keys SET revoked_at = NOW()
      WHERE id = ${id} AND revoked_at IS NULL
      RETURNING id, name
    `
    if (!rows[0]) return c.json({ error: 'Key not found or already revoked' }, 404)
    await writeAudit({
      sql,
      actorId: c.var.userId,
      action: 'engine_key.revoke',
      detail: { keyId: id, name: rows[0].name },
      ipAddress: c.req.header('CF-Connecting-IP') ?? null,
    })
    return c.json({ id, revoked: true })
  } finally {
    await sql.end()
  }
})

export default keys
