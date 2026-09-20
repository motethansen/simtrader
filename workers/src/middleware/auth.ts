import { createMiddleware } from 'hono/factory'
import { getCookie } from 'hono/cookie'
import type { Env, HonoVars } from '../lib/types'
import { validateSession } from '../lib/session'
import { getDb } from '../lib/db'

// Attaches session to context if present. Does NOT block unauthenticated requests.
export const sessionMiddleware = createMiddleware<{ Bindings: Env; Variables: HonoVars }>(
  async (c, next) => {
    const token = getCookie(c, '__session')
    if (token) {
      const session = await validateSession(c.env.KV, token)
      if (session) {
        // Re-check user status from DB (catches suspension between requests)
        const sql = getDb(c.env)
        try {
          const rows = await sql<{ status: string; role: string }[]>`
            SELECT status, role FROM users WHERE id = ${session.userId}
          `
          const user = rows[0]
          if (user && user.status === 'active') {
            c.set('userId', session.userId)
            // Role comes from the database, not the session copy: a demotion takes effect at
            // once rather than at the next sign-in.
            c.set('userRole', user.role as 'user' | 'admin')
            c.set('userStatus', 'active')
            c.set('authMethods', session.amr)
          }
        } finally {
          await sql.end()
        }
      }
    }
    await next()
  }
)

// Requires an authenticated session. Sends people to BudgetApp otherwise — the only way in.
export const requireAuth = createMiddleware<{ Bindings: Env; Variables: HonoVars }>(
  async (c, next) => {
    if (!c.var.userId) return c.redirect(startUrlFor(c.req.path))
    await next()
  }
)

// Requires admin role AND that BudgetApp 2FA was used for this sign-in (ST-008 / ST-g).
// Admin rights alone are not enough: `amr` records how the person proved who they were, and
// BudgetApp applies the same rule to its own admins.
export const requireAdmin = createMiddleware<{ Bindings: Env; Variables: HonoVars }>(
  async (c, next) => {
    if (!c.var.userId) return c.redirect(startUrlFor(c.req.path))
    if (c.var.userRole !== 'admin') {
      return c.text('Forbidden', 403)
    }
    if (!(c.var.authMethods ?? []).includes('otp')) {
      return c.text(
        'Admin access requires two-factor authentication. Turn on 2FA in BudgetApp, sign out, and sign in again.',
        403,
      )
    }
    await next()
  }
)

function startUrlFor(path: string): string {
  return `/auth/budgetapp/start?next=${encodeURIComponent(path)}`
}
