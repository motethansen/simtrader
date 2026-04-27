import { Hono } from 'hono'
import type { Env, HonoVars } from '../../lib/types'
import { getDb } from '../../lib/db'
import { writeAudit } from '../../lib/audit'
import { destroyAllUserSessions } from '../../lib/session'
import { adminUsersPage, adminUserDetailPage } from '../../ui/admin/users'

const users = new Hono<{ Bindings: Env; Variables: HonoVars }>()

function getIp(c: { req: { header: (k: string) => string | undefined } }): string {
  return c.req.header('CF-Connecting-IP') ?? 'unknown'
}

// --- GET /admin/users ---
users.get('/', async (c) => {
  const page = Math.max(1, parseInt(c.req.query('page') ?? '1'))
  const limit = 20
  const offset = (page - 1) * limit
  const search = c.req.query('q') ?? ''
  const roleFilter = c.req.query('role') ?? ''
  const statusFilter = c.req.query('status') ?? ''

  const sql = getDb(c.env.DATABASE_URL)
  try {
    const where = sql`
      WHERE status != 'deleted'
      ${search ? sql`AND email ILIKE ${'%' + search + '%'}` : sql``}
      ${roleFilter ? sql`AND role = ${roleFilter}` : sql``}
      ${statusFilter ? sql`AND status = ${statusFilter}` : sql``}
    `

    const [rows, countRows] = await Promise.all([
      sql<{ id: string; email: string; role: string; status: string; createdAt: string; lastLoginAt: string | null; hasToken: boolean }[]>`
        SELECT
          u.id, u.email, u.role, u.status, u.created_at, u.last_login_at,
          EXISTS(SELECT 1 FROM saxo_tokens st WHERE st.user_id = u.id AND st.expires_at > NOW()) AS has_token
        FROM users u
        ${where}
        ORDER BY u.created_at DESC
        LIMIT ${limit} OFFSET ${offset}
      `,
      sql<{ count: number }[]>`SELECT COUNT(*)::int AS count FROM users u ${where}`,
    ])

    const total = countRows[0]?.count ?? 0
    return c.html(adminUsersPage({
      users: rows,
      page,
      total,
      limit,
      search,
      roleFilter,
      statusFilter,
    }))
  } finally {
    await sql.end()
  }
})

// --- GET /admin/users/:id ---
users.get('/:id', async (c) => {
  const id = c.req.param('id')
  const sql = getDb(c.env.DATABASE_URL)
  try {
    const [userRows, auditRows, tokenRows] = await Promise.all([
      sql<{ id: string; email: string; role: string; status: string; emailVerified: boolean; createdAt: string; lastLoginAt: string | null }[]>`
        SELECT id, email, role, status, email_verified, created_at, last_login_at
        FROM users WHERE id = ${id}
      `,
      sql<{ id: string; action: string; ts: string; actorEmail: string | null; detail: Record<string, unknown> | null }[]>`
        SELECT al.id, al.action, al.ts, al.detail, a.email AS actor_email
        FROM audit_log al
        LEFT JOIN users a ON a.id = al.actor_id
        WHERE al.actor_id = ${id} OR al.target_user_id = ${id}
        ORDER BY al.ts DESC LIMIT 50
      `,
      sql<{ expiresAt: string; createdAt: string }[]>`
        SELECT expires_at, created_at FROM saxo_tokens WHERE user_id = ${id}
      `,
    ])

    const user = userRows[0]
    if (!user) return c.text('User not found', 404)

    return c.html(adminUserDetailPage({
      user,
      auditTrail: auditRows,
      token: tokenRows[0] ?? null,
    }))
  } finally {
    await sql.end()
  }
})

// --- PATCH /admin/users/:id/suspend ---
users.post('/:id/suspend', async (c) => {
  const targetId = c.req.param('id')
  const actorId = c.var.userId
  if (targetId === actorId) return c.json({ error: 'Cannot suspend yourself' }, 400)

  const sql = getDb(c.env.DATABASE_URL)
  try {
    await sql`UPDATE users SET status = 'suspended', updated_at = NOW() WHERE id = ${targetId}`
    await destroyAllUserSessions(c.env.KV, targetId)
    await writeAudit({
      sql, actorId, targetUserId: targetId,
      action: 'user.suspend', ipAddress: getIp(c),
    })
    return c.json({ ok: true })
  } finally {
    await sql.end()
  }
})

// --- POST /admin/users/:id/unsuspend ---
users.post('/:id/unsuspend', async (c) => {
  const targetId = c.req.param('id')
  const sql = getDb(c.env.DATABASE_URL)
  try {
    await sql`UPDATE users SET status = 'active', updated_at = NOW() WHERE id = ${targetId}`
    await writeAudit({
      sql, actorId: c.var.userId, targetUserId: targetId,
      action: 'user.unsuspend', ipAddress: getIp(c),
    })
    return c.json({ ok: true })
  } finally {
    await sql.end()
  }
})

// --- POST /admin/users/:id/role ---
users.post('/:id/role', async (c) => {
  const targetId = c.req.param('id')
  const actorId = c.var.userId
  if (targetId === actorId) return c.json({ error: 'Cannot change your own role' }, 400)

  const body = await c.req.json<{ role: string }>()
  if (!['user', 'admin'].includes(body.role)) return c.json({ error: 'Invalid role' }, 400)

  const sql = getDb(c.env.DATABASE_URL)
  try {
    const current = await sql<{ role: string }[]>`SELECT role FROM users WHERE id = ${targetId}`
    const fromRole = current[0]?.role ?? 'unknown'
    await sql`UPDATE users SET role = ${body.role}, updated_at = NOW() WHERE id = ${targetId}`
    await writeAudit({
      sql, actorId, targetUserId: targetId,
      action: 'user.role_change',
      detail: { from: fromRole, to: body.role },
      ipAddress: getIp(c),
    })
    return c.json({ ok: true })
  } finally {
    await sql.end()
  }
})

// --- POST /admin/users/:id/token/expire ---
users.post('/:id/token/expire', async (c) => {
  const targetId = c.req.param('id')
  const sql = getDb(c.env.DATABASE_URL)
  try {
    await sql`UPDATE saxo_tokens SET expires_at = NOW() WHERE user_id = ${targetId}`
    await writeAudit({
      sql, actorId: c.var.userId, targetUserId: targetId,
      action: 'token.force_expire', ipAddress: getIp(c),
    })
    return c.json({ ok: true })
  } finally {
    await sql.end()
  }
})

// --- DELETE /admin/users/:id ---
users.post('/:id/delete', async (c) => {
  const targetId = c.req.param('id')
  const actorId = c.var.userId
  if (targetId === actorId) return c.json({ error: 'Cannot delete yourself' }, 400)

  const body = await c.req.json<{ confirm?: boolean }>().catch(() => ({ confirm: false }))
  if (!body.confirm) return c.json({ error: 'confirm required' }, 400)

  const sql = getDb(c.env.DATABASE_URL)
  try {
    // Soft-delete: anonymise email, keep audit trail intact
    await sql`
      UPDATE users SET
        email = 'deleted_' || id || '@deleted',
        password_hash = 'deleted',
        status = 'deleted',
        updated_at = NOW()
      WHERE id = ${targetId}
    `
    await destroyAllUserSessions(c.env.KV, targetId)
    await writeAudit({
      sql, actorId, targetUserId: targetId,
      action: 'user.delete', ipAddress: getIp(c),
    })
    return c.json({ ok: true })
  } finally {
    await sql.end()
  }
})

export default users
