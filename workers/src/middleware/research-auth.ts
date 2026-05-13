// Dual-auth middleware for the research API (M9a).
// Accepts either:
//   (a) Engine API key — "Authorization: Bearer sk_<64hex>"
//   (b) Bridge JWT    — "Authorization: Bearer <jwt>" from urbanlife.works SSO
//   (c) Session cookie — for user-facing endpoints (signal actions)
//
// Sets context vars: authMethod, userId?, apiKeyId?, bridgeSub?, researchScopes.

import { createMiddleware } from 'hono/factory'
import type { Env, HonoVars } from '../lib/types'
import { getDb } from '../lib/db'
import { validateSession } from '../lib/session'
import { verifyBridgeJwt } from '../lib/sso-jwt'
import { getCookie } from 'hono/cookie'

const ENGINE_KEY_PREFIX = 'sk_'

async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input))
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('')
}

// Fire-and-forget: bump last_used_at without blocking the response.
function bumpKeyLastUsed(databaseUrl: string, keyId: string): void {
  const sql = getDb(databaseUrl)
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
        const sql = getDb(c.env.DATABASE_URL)
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
            bumpKeyLastUsed(c.env.DATABASE_URL, key.id)
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

      // --- Bridge JWT path (contains dots = JWT shape) ---
      if (bearer.includes('.') && c.env.SSO_JWKS_URL) {
        const claims = await verifyBridgeJwt(bearer, c.env.SSO_JWKS_URL, c.env.SSO_AUDIENCE)
        if (claims) {
          const sql = getDb(c.env.DATABASE_URL)
          try {
            // Look up or auto-provision simtrader user
            const identRows = await sql<{ userId: string }[]>`
              SELECT user_id FROM bridge_jwt_identities
              WHERE iss = ${claims.iss} AND sub = ${claims.sub}
              LIMIT 1
            `
            let userId: string

            if (identRows[0]) {
              userId = identRows[0].userId
              // Update last_seen_at fire-and-forget
              sql`UPDATE bridge_jwt_identities SET last_seen_at = NOW(), email = ${claims.email ?? null}
                  WHERE iss = ${claims.iss} AND sub = ${claims.sub}`
                .then(() => {}).catch(() => {})
            } else {
              // Auto-provision: create user with password_hash NULL (cannot log in directly)
              const newUser = await sql<{ id: string }[]>`
                INSERT INTO users (email, password_hash, role, status)
                VALUES (${claims.email ?? `bridge_${claims.sub}@sso`}, NULL, 'user', 'active')
                ON CONFLICT (email) DO UPDATE SET updated_at = NOW()
                RETURNING id
              `
              userId = newUser[0]!.id
              await sql`
                INSERT INTO bridge_jwt_identities (user_id, iss, sub, email)
                VALUES (${userId}, ${claims.iss}, ${claims.sub}, ${claims.email ?? null})
                ON CONFLICT (iss, sub) DO UPDATE SET last_seen_at = NOW()
              `
            }

            c.set('authMethod', 'bridge_jwt')
            c.set('userId', userId)
            c.set('userRole', 'user')
            c.set('apiKeyId', null)
            c.set('bridgeSub', claims.sub)
            c.set('researchScopes', ['signals:read', 'signals:write', 'evaluations:read', 'evaluations:write'])
            await next()
            return
          } finally {
            await sql.end()
          }
        }
        return c.json({ error: 'Invalid or expired bridge JWT' }, 401)
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
        const sql = getDb(c.env.DATABASE_URL)
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
