import type { UserRole, SessionData } from './types'
import { generateToken } from './auth'

// Every session now comes from a BudgetApp sign-in, and ST-008 caps those at 24 hours for
// users and admins alike: BudgetApp is the only door, so a suspension or deletion there has to
// take effect within one session lifetime. The old 7-day user session outlived that guarantee.
export const SESSION_TTL_SECONDS = 24 * 3600

export interface NewSession {
  userId: string
  role: UserRole
  amr: string[]
  authTime: number
}

export async function createSession(
  kv: KVNamespace,
  session: NewSession,
): Promise<string> {
  const token = generateToken()
  const ttlSeconds = SESSION_TTL_SECONDS
  const { userId, role, amr, authTime } = session
  const data: SessionData = { userId, role, amr, authTime }

  await kv.put(`session:${token}`, JSON.stringify(data), { expirationTtl: ttlSeconds })

  // Track tokens per user so we can bulk-invalidate on suspend
  const setKey = `user_sessions:${userId}`
  const existing: string[] = JSON.parse(await kv.get(setKey) ?? '[]')
  existing.push(token)
  // Store the set with a longer TTL so it outlasts the longest possible session
  await kv.put(setKey, JSON.stringify(existing), { expirationTtl: ttlSeconds + 3600 })

  return token
}

export async function validateSession(
  kv: KVNamespace,
  token: string,
): Promise<SessionData | null> {
  const raw = await kv.get(`session:${token}`)
  if (!raw) return null
  const data = JSON.parse(raw) as Partial<SessionData>
  if (!data.userId || !data.role) return null
  // amr/authTime are absent in sessions written before ST-008; treat them as "no 2FA proven",
  // which costs such a session nothing but admin access.
  return {
    userId: data.userId,
    role: data.role,
    amr: data.amr ?? [],
    authTime: data.authTime ?? 0,
  }
}

export async function destroySession(kv: KVNamespace, token: string): Promise<void> {
  // Get userId before deleting so we can remove from the tracking set
  const raw = await kv.get(`session:${token}`)
  if (raw) {
    const { userId } = JSON.parse(raw) as SessionData
    await kv.delete(`session:${token}`)
    const setKey = `user_sessions:${userId}`
    const tokens: string[] = JSON.parse(await kv.get(setKey) ?? '[]')
    const updated = tokens.filter(t => t !== token)
    if (updated.length > 0) await kv.put(setKey, JSON.stringify(updated))
    else await kv.delete(setKey)
  }
}

export async function destroyAllUserSessions(kv: KVNamespace, userId: string): Promise<void> {
  const setKey = `user_sessions:${userId}`
  const tokens: string[] = JSON.parse(await kv.get(setKey) ?? '[]')
  await Promise.all(tokens.map(t => kv.delete(`session:${t}`)))
  await kv.delete(setKey)
}
