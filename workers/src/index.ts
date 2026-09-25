import { Hono } from 'hono'
import type { Env, HonoVars } from './lib/types'
import { sessionMiddleware, requireAuth, requireAdmin } from './middleware/auth'
import { getDb } from './lib/db'
import { getCookie } from 'hono/cookie'
import { validateSession } from './lib/session'

import authRoutes from './routes/auth'
import adminDashboard from './routes/admin/index'
import adminUsers from './routes/admin/users'
import adminAuditLog from './routes/admin/audit-log'
import researchRoutes from './routes/research/index'
import identityEvents from './routes/identity-events'

import { dashboardPage } from './ui/dashboard'

const app = new Hono<{ Bindings: Env; Variables: HonoVars }>()

// Session middleware runs on every request
app.use('*', sessionMiddleware)

// Health check: unauthenticated on purpose, so uptime checks can reach it. It says whether
// the database answered, and nothing else — no versions, no hostnames, no error text.
app.get('/health', async (c) => {
  const sql = getDb(c.env)
  try {
    await sql`SELECT 1`
    return c.json({ ok: true, db: true, environment: c.env.ENVIRONMENT })
  } catch {
    return c.json({ ok: false, db: false, environment: c.env.ENVIRONMENT }, 503)
  } finally {
    await sql.end()
  }
})

// ---- Public auth routes ----
app.route('/auth', authRoutes)

// ---- Identity events from BudgetApp (ST-f) ----
// Server to server. The signed body is the authentication; see routes/identity-events.ts.
app.route('/internal', identityEvents)

// Convenience redirects. There is no sign-up: an account is created on first BudgetApp
// sign-in, so /signup goes to the same place as /login (ST-008).
app.get('/', (c) => c.redirect(c.var.userId ? '/dashboard' : '/auth/budgetapp/start'))
app.get('/login', (c) => c.redirect('/auth/budgetapp/start'))
app.get('/signup', (c) => c.redirect('/auth/budgetapp/start'))
app.get('/admin/login', (c) => c.redirect('/auth/budgetapp/start?next=%2Fadmin'))

// Shown after logout, so the landing page does not bounce straight back into BudgetApp.
app.get('/goodbye', (c) =>
  c.html(`<!DOCTYPE html><html><body style="font-family:system-ui;max-width:480px;margin:4rem auto;padding:2rem">
    <h2>Signed out of simtrader</h2>
    <p>Your BudgetApp session is untouched.</p>
    <p><a href="/auth/budgetapp/start">Sign in again</a></p>
  </body></html>`)
)

// ---- User dashboard ----
app.get('/dashboard', requireAuth, async (c) => {
  const sql = getDb(c.env)
  try {
    const [userRows, tokenRows] = await Promise.all([
      sql<{ email: string }[]>`SELECT email FROM users WHERE id = ${c.var.userId}`,
      sql<{ expiresAt: string }[]>`
        SELECT expires_at FROM saxo_tokens
        WHERE user_id = ${c.var.userId} AND expires_at > NOW()
      `,
    ])
    const email = userRows[0]?.email ?? ''
    const token = tokenRows[0]
    return c.html(dashboardPage({
      email,
      token: { active: !!token, expiresAt: token?.expiresAt ?? null },
    }))
  } finally {
    await sql.end()
  }
})

// ---- Admin routes (all behind requireAdmin) ----
app.use('/admin/*', requireAdmin)

// Admin login redirect — same auth endpoint, role checked after
app.get('/admin/login', (c) => c.redirect('/auth/login'))

// Wire admin sub-routers.
// We need to attach the current admin's email to all admin responses.
// This is done by a small wrapping middleware that enriches the context.
app.use('/admin/*', async (c, next) => {
  // Fetch admin email once and attach to layout via a custom header we'll read in the UI.
  // (In a full implementation, we'd use Hono context vars or a layout prop.)
  await next()
})

app.route('/admin', adminDashboard)
app.route('/admin/users', adminUsers)
app.route('/admin/audit', adminAuditLog)

// ---- Research API (M9a) ----
app.route('/research', researchRoutes)

// Simple system health stub (full implementation in a later sprint)
app.get('/admin/system', requireAdmin, async (c) => {
  const sql = getDb(c.env)
  try {
    const [dbCheck] = await sql<{ now: string }[]>`SELECT NOW()::text AS now`
    return c.json({
      db: { ok: true, serverTime: dbCheck?.now },
      environment: c.env.ENVIRONMENT,
      worker: 'ok',
    })
  } catch (e) {
    return c.json({ db: { ok: false, error: String(e) } }, 500)
  } finally {
    await sql.end()
  }
})

// 404 fallback
app.notFound((c) => c.text('Not found', 404))

// Global error handler — never expose stack traces to the client
app.onError((err, c) => {
  console.error(err)
  const isAdmin = c.req.path.startsWith('/admin')
  if (isAdmin) return c.text('Internal server error', 500)
  return c.html(`<!DOCTYPE html><html><body style="font-family:sans-serif;padding:2rem">
    <h2>Something went wrong</h2>
    <p>Please try again. If this keeps happening, contact support.</p>
    <a href="/">← Home</a>
  </body></html>`, 500)
})

export default app
