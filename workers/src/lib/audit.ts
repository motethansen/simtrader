import type { Sql } from './db'

/** What can legally go in a JSONB column. */
export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue }

interface AuditParams {
  sql: Sql
  actorId: string | null
  targetUserId?: string | null
  action: string
  detail?: Record<string, JsonValue> | null
  ipAddress?: string | null
}

// Every admin action calls this. Never skip it.
// `detail` goes in as JSONB, not as a JSON string: a stringified object lands in the column as
// a quoted scalar, which no `detail->>'key'` query can read back.
export async function writeAudit(p: AuditParams): Promise<void> {
  await p.sql`
    INSERT INTO audit_log (actor_id, target_user_id, action, detail, ip_address)
    VALUES (
      ${p.actorId},
      ${p.targetUserId ?? null},
      ${p.action},
      ${p.detail ? p.sql.json(p.detail) : null},
      ${p.ipAddress ?? null}
    )
  `
}
