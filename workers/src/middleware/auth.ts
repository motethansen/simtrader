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
        const sql = getDb(c.env.DATABASE_URL)
        try {
          const rows = await sql<{ status: string; role: string }[]>`
            SELECT status, role FROM users WHERE id = ${session.userId}
          `
          const user = rows[0]
          if (user && user.status === 'active') {
            c.set('userId', session.userId)
            c.set('userRole', session.role)
            c.set('userStatus', 'active')
          }
        } finally {
          await sql.end()
        }
      }
    }
    await next()
  }
)

// Requires an authenticated session. Redirects to /login otherwise.
export const requireAuth = createMiddleware<{ Bindings: Env; Variables: HonoVars }>(
  async (c, next) => {
    if (!c.var.userId) return c.redirect('/login')
    await next()
  }
)

// Requires admin role. Returns 403 for non-admins.
export const requireAdmin = createMiddleware<{ Bindings: Env; Variables: HonoVars }>(
  async (c, next) => {
    if (!c.var.userId) return c.redirect('/admin/login')
    if (c.var.userRole !== 'admin') {
      return c.text('Forbidden', 403)
    }
    await next()
  }
)
