// Dual-auth middleware for the research API (M9a).
// Accepts either:
//   (a) Engine API key — "Authorization: Bearer sk_<64hex>"
//   (b) ID token      — "Authorization: Bearer <jwt>" from a trusted issuer (BudgetApp)
//   (c) Session cookie — for user-facing endpoints (signal actions)
//
// Sets context vars: authMethod, userId?, apiKeyId?, bridgeSub?, researchScopes.

import { createMiddleware } from 'hono/factory'
import type { Env, HonoVars } from '../lib/types'
import { getDb } from '../lib/db'
import { validateSession } from '../lib/session'
import { verifyIdToken } from '../lib/sso-jwt'
import { issuerConfigFor, unverifiedIssuer } from '../lib/issuers'
import { getCookie } from 'hono/cookie'

const ENGINE_KEY_PREFIX = 'sk_'

async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input))
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('')
}

// Fire-and-forget: bump last_used_at without blocking the response.
function bumpKeyLastUsed(env: Env, keyId: string): void {
  const sql = getDb(env)
  sql`UPDATE engine_api_keys SET last_used_at = NOW() WHERE id = ${keyId}`
    .then(() => sql.end())
    .catch(() => sql.end())
}

// Middleware that REQUIRES research auth (engine key or bridge JWT).
export const requireResearchAuth = createMiddleware<{ Bindings: Env; Variables: HonoVars }>(
  async (c, next) => {
    const authHeader = c.req.header('Authorization') ?? ''
    const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null

    if (bearer) {
      // --- Engine API key path ---
      if (bearer.startsWith(ENGINE_KEY_PREFIX)) {
        const hash = await sha256Hex(bearer)
        const sql = getDb(c.env)
        try {
          const rows = await sql<{ id: string; scopes: string[] }[]>`
            SELECT id, scopes FROM engine_api_keys
            WHERE key_hash = ${hash}
              AND revoked_at IS NULL
              AND (expires_at IS NULL OR expires_at > NOW())
            LIMIT 1
          `
          if (rows[0]) {
            const key = rows[0]
            bumpKeyLastUsed(c.env, key.id)
            c.set('authMethod', 'engine_key')
            c.set('apiKeyId', key.id)
            c.set('bridgeSub', null)
            c.set('researchScopes', key.scopes)
            // Engine keys are not user-scoped unless explicitly linked; leave userId unset
            await next()
            return
          }
        } finally {
          await sql.end()
        }
        return c.json({ error: 'Invalid or revoked engine API key' }, 401)
      }

      // --- ID token path (contains dots = JWT shape) ---
      if (bearer.includes('.')) {
        // The token names its issuer, but that only selects a trusted config — it never
        // supplies the JWKS URL, the algorithm or the audience.
        const iss = unverifiedIssuer(bearer)
        const issuerConfig = iss ? issuerConfigFor(c.env, iss) : null
        if (!issuerConfig) return c.json({ error: 'Unknown token issuer' }, 401)

        const result = await verifyIdToken(bearer, issuerConfig)
        if (!result.ok) return c.json({ error: 'Invalid or expired token' }, 401)
        const claims = result.claims

        const sql = getDb(c.env)
        try {
          // Identity is (iss, sub) and nothing else. There is deliberately no provisioning
          // here: an account is created only by the browser sign-in flow, which proves the
          // person is present. Matching on email would attach a token to whichever account
          // happens to share the address — an account takeover, admins included.
          const identRows = await sql<{ userId: string; role: 'user' | 'admin'; status: string }[]>`
            SELECT e.user_id, u.role, u.status
            FROM external_identities e
            JOIN users u ON u.id = e.user_id
            WHERE e.iss = ${claims.iss} AND e.sub = ${claims.sub}
            LIMIT 1
          `
          const ident = identRows[0]
          if (!ident) return c.json({ error: 'No simtrader account for this identity — sign in first' }, 403)
          if (ident.status !== 'active') return c.json({ error: 'Account is not active' }, 403)

          sql`UPDATE external_identities SET last_seen_at = NOW()
              WHERE iss = ${claims.iss} AND sub = ${claims.sub}`
            .then(() => {}).catch(() => {})

          c.set('authMethod', 'bridge_jwt')
          c.set('userId', ident.userId)
          c.set('userRole', ident.role)
          c.set('apiKeyId', null)
          c.set('bridgeSub', claims.sub)
          c.set('researchScopes', ['signals:read', 'signals:write', 'evaluations:read', 'evaluations:write'])
          await next()
          return
        } finally {
          await sql.end()
        }
      }
    }

    return c.json({ error: 'Missing or unsupported Authorization header' }, 401)
  }
)

// Softer variant: also accepts session cookies (for user-facing endpoints).
export const requireResearchOrSession = createMiddleware<{ Bindings: Env; Variables: HonoVars }>(
  async (c, next) => {
    const authHeader = c.req.header('Authorization') ?? ''
    const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null

    // If a Bearer token is present, delegate to the strict research auth
    if (bearer) {
      return requireResearchAuth(c, next)
    }

    // Fall back to session cookie
    const sessionToken = getCookie(c, '__session')
    if (sessionToken) {
      const session = await validateSession(c.env.KV, sessionToken)
      if (session) {
        const sql = getDb(c.env)
        try {
          const rows = await sql<{ status: string; role: string }[]>`
            SELECT status, role FROM users WHERE id = ${session.userId}
          `
          const user = rows[0]
          if (user && user.status === 'active') {
            c.set('userId', session.userId)
            c.set('userRole', session.role as 'user' | 'admin')
            c.set('authMethod', 'session')
            c.set('apiKeyId', null)
            c.set('bridgeSub', null)
            c.set('researchScopes', ['signals:read', 'evaluations:read'])
            await next()
            return
          }
        } finally {
          await sql.end()
        }
      }
    }

    return c.json({ error: 'Authentication required' }, 401)
  }
)
