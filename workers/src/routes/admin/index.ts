import { Hono } from 'hono'
import type { Env, HonoVars } from '../../lib/types'
import { getDb } from '../../lib/db'
import { adminDashboardPage } from '../../ui/admin/dashboard'

const dashboard = new Hono<{ Bindings: Env; Variables: HonoVars }>()

dashboard.get('/', async (c) => {
  const sql = getDb(c.env.DATABASE_URL)
  try {
    const [[totals], [tokenStats], recentAudit] = await Promise.all([
      sql<{ total: number; active: number; suspended: number; activeToday: number }[]>`
        SELECT
          COUNT(*)::int                                                    AS total,
          COUNT(*) FILTER (WHERE status = 'active')::int                  AS active,
          COUNT(*) FILTER (WHERE status = 'suspended')::int               AS suspended,
          COUNT(*) FILTER (WHERE last_login_at > NOW() - INTERVAL '7 days')::int AS active_today
        FROM users WHERE status != 'deleted'
      `,
      sql<{ activeTokens: number; expiringsSoon: number }[]>`
        SELECT
          COUNT(*) FILTER (WHERE expires_at > NOW())::int                  AS active_tokens,
          COUNT(*) FILTER (WHERE expires_at BETWEEN NOW() AND NOW() + INTERVAL '1 hour')::int
                                                                           AS expiring_soon
        FROM saxo_tokens
      `,
      sql<{ id: string; action: string; ts: string; actorEmail: string | null; targetEmail: string | null }[]>`
        SELECT
          al.id, al.action, al.ts,
          a.email AS actor_email,
          t.email AS target_email
        FROM audit_log al
        LEFT JOIN users a ON a.id = al.actor_id
        LEFT JOIN users t ON t.id = al.target_user_id
        ORDER BY al.ts DESC
        LIMIT 20
      `,
    ])

    return c.html(adminDashboardPage({
      adminEmail: '', // fetched by layout from /me if needed
      stats: {
        totalUsers: totals?.total ?? 0,
        activeUsers: totals?.active ?? 0,
        suspendedUsers: totals?.suspended ?? 0,
        activeToday: totals?.activeToday ?? 0,
        activeTokens: tokenStats?.activeTokens ?? 0,
        expiringsSoon: tokenStats?.expiringsSoon ?? 0,
      },
      recentAudit,
    }))
  } finally {
    await sql.end()
  }
})

export default dashboard
