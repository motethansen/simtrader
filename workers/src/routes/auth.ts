import { Hono } from 'hono'
import { setCookie, deleteCookie, getCookie } from 'hono/cookie'
import type { Env, HonoVars } from '../lib/types'
import { getDb } from '../lib/db'
import { hashPassword, verifyPassword } from '../lib/auth'
import { createSession, destroySession } from '../lib/session'
import { writeAudit } from '../lib/audit'
import { loginPage, signupPage } from '../ui/auth'

const auth = new Hono<{ Bindings: Env; Variables: HonoVars }>()

// Rate limiting: 5 failed attempts per IP per 15 minutes
async function checkRateLimit(kv: KVNamespace, ip: string): Promise<boolean> {
  const key = `rl:login:${ip}`
  const count = parseInt(await kv.get(key) ?? '0')
  return count < 5
}

async function incrementFailCount(kv: KVNamespace, ip: string): Promise<void> {
  const key = `rl:login:${ip}`
  const count = parseInt(await kv.get(key) ?? '0')
  await kv.put(key, String(count + 1), { expirationTtl: 900 }) // 15 min
}

function getIp(c: { req: { header: (k: string) => string | undefined } }): string {
  return c.req.header('CF-Connecting-IP') ?? c.req.header('X-Forwarded-For') ?? 'unknown'
}

// --- GET /auth/login ---
auth.get('/login', (c) => {
  if (c.var.userId) return c.redirect('/dashboard')
  return c.html(loginPage({ error: null, redirectTo: c.req.query('next') ?? null }))
})

// --- POST /auth/login ---
auth.post('/login', async (c) => {
  const ip = getIp(c)
  const allowed = await checkRateLimit(c.env.KV, ip)
  if (!allowed) {
    return c.html(loginPage({ error: 'Too many attempts. Try again in 15 minutes.', redirectTo: null }), 429)
  }

  const body = await c.req.parseBody()
  const email = String(body['email'] ?? '').trim().toLowerCase()
  const password = String(body['password'] ?? '')
  const next = String(body['next'] ?? '')

  const fail = async () => {
    await incrementFailCount(c.env.KV, ip)
    return c.html(loginPage({ error: 'Invalid email or password.', redirectTo: null }), 401)
  }

  const sql = getDb(c.env.DATABASE_URL)
  try {
    const rows = await sql<{ id: string; passwordHash: string; role: string; status: string }[]>`
      SELECT id, password_hash, role, status FROM users WHERE email = ${email}
    `
    const user = rows[0]
    if (!user) return fail()

    const valid = await verifyPassword(password, user.passwordHash)
    if (!valid) return fail()

    if (user.status === 'suspended') {
      return c.html(loginPage({ error: 'Your account has been suspended.', redirectTo: null }), 403)
    }
    if (user.status !== 'active') {
      return c.html(loginPage({ error: 'Account not yet active.', redirectTo: null }), 403)
    }

    await sql`UPDATE users SET last_login_at = NOW() WHERE id = ${user.id}`
    await writeAudit({ sql, actorId: user.id, action: 'user.login', ipAddress: ip })

    const token = await createSession(c.env.KV, user.id, user.role as 'user' | 'admin')
    setCookie(c, '__session', token, {
      httpOnly: true,
      secure: true,
      sameSite: 'Strict',
      maxAge: user.role === 'admin' ? 86400 : 7 * 86400,
      path: '/',
    })

    const destination = user.role === 'admin'
      ? '/admin'
      : (next && next.startsWith('/') ? next : '/dashboard')
    return c.redirect(destination)
  } finally {
    await sql.end()
  }
})

// --- GET /auth/signup ---
auth.get('/signup', (c) => {
  if (c.var.userId) return c.redirect('/dashboard')
  return c.html(signupPage({ error: null }))
})

// --- POST /auth/signup ---
auth.post('/signup', async (c) => {
  const body = await c.req.parseBody()
  const email = String(body['email'] ?? '').trim().toLowerCase()
  const password = String(body['password'] ?? '')
  const confirm = String(body['confirm'] ?? '')
  const ip = getIp(c)

  if (!email.includes('@')) {
    return c.html(signupPage({ error: 'Enter a valid email address.' }), 400)
  }
  if (password.length < 12) {
    return c.html(signupPage({ error: 'Password must be at least 12 characters.' }), 400)
  }
  if (password !== confirm) {
    return c.html(signupPage({ error: 'Passwords do not match.' }), 400)
  }

  const sql = getDb(c.env.DATABASE_URL)
  try {
    const existing = await sql`SELECT id FROM users WHERE email = ${email}`
    if (existing.length > 0) {
      // Don't reveal whether the email exists — send to a "check your email" page regardless
      return c.redirect('/auth/signup-pending')
    }

    const passwordHash = await hashPassword(password)
    const result = await sql<{ id: string }[]>`
      INSERT INTO users (email, password_hash, role, status)
      VALUES (${email}, ${passwordHash}, 'user', 'active')
      RETURNING id
    `
    const userId = result[0]!.id
    await writeAudit({ sql, actorId: userId, action: 'user.signup', ipAddress: ip })

    const token = await createSession(c.env.KV, userId, 'user')
    setCookie(c, '__session', token, {
      httpOnly: true, secure: true, sameSite: 'Strict', maxAge: 7 * 86400, path: '/',
    })
    return c.redirect('/dashboard')
  } finally {
    await sql.end()
  }
})

// --- POST /auth/logout ---
auth.post('/logout', async (c) => {
  const token = getCookie(c, '__session')
  if (token) await destroySession(c.env.KV, token)
  deleteCookie(c, '__session', { path: '/' })
  return c.redirect('/login')
})

// --- GET /me ---
auth.get('/me', async (c) => {
  if (!c.var.userId) return c.json({ error: 'Unauthenticated' }, 401)
  const sql = getDb(c.env.DATABASE_URL)
  try {
    const rows = await sql`
      SELECT id, email, role, status, email_verified, created_at, last_login_at
      FROM users WHERE id = ${c.var.userId}
    `
    return c.json(rows[0] ?? null)
  } finally {
    await sql.end()
  }
})

// Shown after signup — avoids email enumeration
auth.get('/signup-pending', (c) =>
  c.html(`<!DOCTYPE html><html><body style="font-family:sans-serif;max-width:480px;margin:4rem auto;padding:2rem">
    <h2>Account created</h2>
    <p>You're signed in. <a href="/dashboard">Go to your dashboard →</a></p>
  </body></html>`)
)

export default auth
