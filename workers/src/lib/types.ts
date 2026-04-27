export type UserRole = 'user' | 'admin'
export type UserStatus = 'active' | 'suspended' | 'pending' | 'deleted'

export interface User {
  id: string
  email: string
  role: UserRole
  status: UserStatus
  emailVerified: boolean
  createdAt: string
  lastLoginAt: string | null
  updatedAt: string
}

export interface SessionData {
  userId: string
  role: UserRole
}

export interface AuditEntry {
  id: string
  actorId: string | null
  targetUserId: string | null
  action: string
  detail: Record<string, unknown> | null
  ipAddress: string | null
  ts: string
  // Joined fields (populated by admin queries)
  actorEmail?: string | null
  targetEmail?: string | null
}

// Cloudflare Workers bindings
export interface Env {
  KV: KVNamespace
  DATABASE_URL: string
  TOKEN_ENCRYPTION_KEY: string
  ENVIRONMENT: string
}

// Hono context variables set by middleware
export interface HonoVars {
  userId: string
  userRole: UserRole
  userStatus: UserStatus
}
