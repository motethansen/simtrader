// POST /internal/identity-events — ST-f. The logic, and why it is shaped this way, is in
// ../lib/identity-events.ts. This file only wires it to Postgres and KV.
//
// Unauthenticated by session on purpose: the caller is BudgetApp's server, and the ES256
// signature on the body is the authentication. There is no shared secret to leak, because
// simtrader only ever holds BudgetApp's public key.

import { Hono } from 'hono'
import type { Env, HonoVars } from '../lib/types'
import { getDb } from '../lib/db'
import { destroyAllUserSessions } from '../lib/session'
import { writeAudit } from '../lib/audit'
import { budgetAppIssuer } from '../lib/issuers'
import { receiveIdentityEvent, type IdentityEventStore } from '../lib/identity-events'

const identityEvents = new Hono<{ Bindings: Env; Variables: HonoVars }>()

// A JWT is well under 2 KB. Anything much larger is not an event.
const MAX_BODY_BYTES = 8 * 1024

identityEvents.post('/identity-events', async (c) => {
  const issuer = budgetAppIssuer(c.env)
  if (!issuer) return c.json({ error: 'not_configured' }, 503)

  const contentType = c.req.header('Content-Type') ?? ''
  if (!contentType.toLowerCase().startsWith('application/jwt')) {
    return c.json({ error: 'unsupported_media_type' }, 415)
  }

  const token = (await c.req.text()).trim()
  if (!token || token.length > MAX_BODY_BYTES) return c.json({ error: 'malformed' }, 400)

  const sql = getDb(c.env)
  try {
    const store: IdentityEventStore = {
      async findUserId(iss, sub) {
        const rows = await sql<{ userId: string }[]>`
          SELECT user_id FROM external_identities WHERE iss = ${iss} AND sub = ${sub} LIMIT 1
        `
        return rows[0]?.userId ?? null
      },
      async eraseUser(userId) {
        await sql.begin(async (tx) => {
          // audit_log keeps its rows (actor_id/target_user_id are ON DELETE SET NULL), but the
          // IP address recorded against this member is personal data and goes with them.
          await tx`
            UPDATE audit_log SET ip_address = NULL
            WHERE actor_id = ${userId} OR target_user_id = ${userId}
          `
          // Cascades to external_identities, saxo_tokens and signal_actions.
          await tx`DELETE FROM users WHERE id = ${userId}`
        })
      },
      async endSessions(userId) {
        await destroyAllUserSessions(c.env.KV, userId)
      },
      async audit(action, detail) {
        await writeAudit({ sql, actorId: null, action, detail })
      },
    }

    const result = await receiveIdentityEvent(token, issuer, store)
    if (!result.ok) return c.json({ error: result.reason }, result.status)
    return c.json({ ok: true, event: result.event, outcome: result.outcome })
  } finally {
    await sql.end()
  }
})

export default identityEvents
