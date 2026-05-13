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
  // Research engine (M9a) — optional; empty string if not configured
  SSO_JWKS_URL: string
  SSO_AUDIENCE: string
}

// Hono context variables set by middleware
export interface HonoVars {
  userId: string
  userRole: UserRole
  userStatus: UserStatus
  // Set by researchAuth middleware (M9a)
  authMethod: 'session' | 'engine_key' | 'bridge_jwt'
  apiKeyId: string | null
  bridgeSub: string | null
  researchScopes: string[]
}

// Research domain types (M9a)
export type SignalHorizon = '1d' | '1w' | '1m' | '3m'
export type EvaluationVerdict = 'buy' | 'sell' | 'hold' | 'watch'
export type SignalAction = 'acknowledged' | 'dismissed' | 'queued' | 'executed'

export interface ResearchSignal {
  id: string
  instrumentKey: string
  symbol: string
  mic: string
  score: string
  horizon: SignalHorizon
  source: string
  payload: Record<string, unknown> | null
  apiKeyId: string | null
  bridgeSub: string | null
  expiresAt: string | null
  createdAt: string
}

export interface ResearchEvaluation {
  id: string
  signalId: string | null
  instrumentKey: string
  verdict: EvaluationVerdict
  confidence: string
  rationale: string | null
  model: string | null
  apiKeyId: string | null
  bridgeSub: string | null
  createdAt: string
}

export interface EngineApiKey {
  id: string
  name: string
  keyPrefix: string
  scopes: string[]
  lastUsedAt: string | null
  expiresAt: string | null
  revokedAt: string | null
  createdAt: string
}
