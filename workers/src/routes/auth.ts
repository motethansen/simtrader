// What is left of simtrader's own auth after ST-008: a way out, and a way to ask who you are.
//
// Sign-up, password login, the login rate limiter and the password pages are gone. BudgetApp is
// the only identity provider, so simtrader stores no passwords at all. The flow lives in
// ./budgetapp-auth.ts.

import { Hono } from 'hono'
import { deleteCookie, getCookie } from 'hono/cookie'
import type { Env, HonoVars } from '../lib/types'
import { getDb } from '../lib/db'
import { destroySession } from '../lib/session'
import budgetappAuth from './budgetapp-auth'

const auth = new Hono<{ Bindings: Env; Variables: HonoVars }>()

auth.route('/budgetapp', budgetappAuth)

// --- GET /auth/login — kept as a redirect so old links and bookmarks still work ---
auth.get('/login', (c) =>
  c.var.userId ? c.redirect('/dashboard') : c.redirect('/auth/budgetapp/start')
)

// --- POST /auth/logout ---
// Ends the simtrader session only. The BudgetApp session is untouched, so signing in again is
// silent while it lasts — ordinary single sign-on behaviour.
auth.post('/logout', async (c) => {
  const token = getCookie(c, '__session')
  if (token) await destroySession(c.env.KV, token)
  deleteCookie(c, '__session', { path: '/' })
  return c.redirect('/goodbye')
})

// --- GET /me ---
auth.get('/me', async (c) => {
  if (!c.var.userId) return c.json({ error: 'Unauthenticated' }, 401)
  const sql = getDb(c.env)
  try {
    const rows = await sql`
      SELECT u.id, u.email, u.role, u.status, u.created_at, u.last_login_at,
             e.provider, e.sub AS provider_sub, e.name
      FROM users u
      LEFT JOIN external_identities e ON e.user_id = u.id
      WHERE u.id = ${c.var.userId}
    `
    return c.json(rows[0] ?? null)
  } finally {
    await sql.end()
  }
})

export default auth
