import type { UserRole, SessionData } from './types'
import { generateToken } from './auth'

const USER_SESSION_TTL_DAYS = 7
const ADMIN_SESSION_TTL_DAYS = 1

export async function createSession(
  kv: KVNamespace,
  userId: string,
  role: UserRole,
): Promise<string> {
  const token = generateToken()
  const ttlDays = role === 'admin' ? ADMIN_SESSION_TTL_DAYS : USER_SESSION_TTL_DAYS
  const ttlSeconds = ttlDays * 86400
  const data: SessionData = { userId, role }

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
  return JSON.parse(raw) as SessionData
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
