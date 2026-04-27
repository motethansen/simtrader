import { Hono } from 'hono'
import type { Env, HonoVars } from '../../lib/types'
import { getDb } from '../../lib/db'
import { adminAuditLogPage } from '../../ui/admin/audit-log'

const auditLog = new Hono<{ Bindings: Env; Variables: HonoVars }>()

auditLog.get('/', async (c) => {
  const page = Math.max(1, parseInt(c.req.query('page') ?? '1'))
  const limit = 50
  const offset = (page - 1) * limit
  const actionFilter = c.req.query('action') ?? ''
  const from = c.req.query('from') ?? ''
  const to = c.req.query('to') ?? ''

  const sql = getDb(c.env.DATABASE_URL)
  try {
    const where = sql`
      WHERE 1=1
      ${actionFilter ? sql`AND al.action ILIKE ${'%' + actionFilter + '%'}` : sql``}
      ${from ? sql`AND al.ts >= ${from}::timestamptz` : sql``}
      ${to ? sql`AND al.ts <= ${to}::timestamptz` : sql``}
    `

    const [rows, countRows] = await Promise.all([
      sql<{ id: string; action: string; ts: string; detail: Record<string, unknown> | null; ipAddress: string | null; actorEmail: string | null; targetEmail: string | null }[]>`
        SELECT
          al.id, al.action, al.ts, al.detail, al.ip_address,
          a.email AS actor_email,
          t.email AS target_email
        FROM audit_log al
        LEFT JOIN users a ON a.id = al.actor_id
        LEFT JOIN users t ON t.id = al.target_user_id
        ${where}
        ORDER BY al.ts DESC
        LIMIT ${limit} OFFSET ${offset}
      `,
      sql<{ count: number }[]>`
        SELECT COUNT(*)::int AS count FROM audit_log al ${where}
      `,
    ])

    return c.html(adminAuditLogPage({
      entries: rows,
      page,
      total: countRows[0]?.count ?? 0,
      limit,
      actionFilter,
      from,
      to,
    }))
  } finally {
    await sql.end()
  }
})

// CSV export
auditLog.get('/export', async (c) => {
  const from = c.req.query('from') ?? ''
  const to = c.req.query('to') ?? ''

  const sql = getDb(c.env.DATABASE_URL)
  try {
    const rows = await sql<{ action: string; ts: string; actorEmail: string | null; targetEmail: string | null; ipAddress: string | null; detail: string | null }[]>`
      SELECT
        al.action, al.ts, al.ip_address,
        a.email AS actor_email,
        t.email AS target_email,
        al.detail::text AS detail
      FROM audit_log al
      LEFT JOIN users a ON a.id = al.actor_id
      LEFT JOIN users t ON t.id = al.target_user_id
      ${from || to ? sql`WHERE 1=1 ${from ? sql`AND al.ts >= ${from}::timestamptz` : sql``} ${to ? sql`AND al.ts <= ${to}::timestamptz` : sql``}` : sql``}
      ORDER BY al.ts DESC
      LIMIT 10000
    `

    const header = 'timestamp,actor,target,action,ip,detail\n'
    const csvRows = rows.map(r =>
      [r.ts, r.actorEmail ?? '', r.targetEmail ?? '', r.action, r.ipAddress ?? '', r.detail ?? '']
        .map(v => `"${String(v).replace(/"/g, '""')}"`)
        .join(',')
    )
    const csv = header + csvRows.join('\n')

    c.header('Content-Type', 'text/csv')
    c.header('Content-Disposition', `attachment; filename="audit-${new Date().toISOString().slice(0, 10)}.csv"`)
    return c.body(csv)
  } finally {
    await sql.end()
  }
})

export default auditLog
