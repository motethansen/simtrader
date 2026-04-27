import type { Sql } from './db'

interface AuditParams {
  sql: Sql
  actorId: string | null
  targetUserId?: string | null
  action: string
  detail?: Record<string, unknown> | null
  ipAddress?: string | null
}

// Every admin action calls this. Never skip it.
export async function writeAudit(p: AuditParams): Promise<void> {
  await p.sql`
    INSERT INTO audit_log (actor_id, target_user_id, action, detail, ip_address)
    VALUES (
      ${p.actorId},
      ${p.targetUserId ?? null},
      ${p.action},
      ${p.detail ? JSON.stringify(p.detail) : null},
      ${p.ipAddress ?? null}
    )
  `
}
