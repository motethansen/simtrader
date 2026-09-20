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
  /** Authentication methods BudgetApp reported for the sign-in behind this session.
   *  `otp` present means 2FA was used; the admin guard requires it (ST-008 / ST-g). */
  amr: string[]
  /** When the BudgetApp sign-in happened, seconds since epoch. */
  authTime: number
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
  // Primary database path (ST-010): Hyperdrive -> Cloudflare Tunnel -> Postgres on vizneo-docker.
  HYPERDRIVE?: Hyperdrive
  // Fallback for local `wrangler dev` against docker-compose Postgres.
  DATABASE_URL: string
  TOKEN_ENCRYPTION_KEY: string
  ENVIRONMENT: string
  // --- BudgetApp sign-in (ST-008). BudgetApp is the only identity provider. ---
  /** Exact `iss` of BudgetApp ID tokens, e.g. https://api.budgetapp.example.com */
  BUDGETAPP_ISSUER: string
  /** Defaults to <issuer>/.well-known/jwks.json */
  BUDGETAPP_JWKS_URL: string
  /** Defaults to <issuer>/api/v1/sso/token */
  BUDGETAPP_TOKEN_URL: string
  /** Browser-facing consent page, e.g. https://budgetapp.example.com/connect */
  BUDGETAPP_CONNECT_URL: string
  /** simtrader's own origin, used to build the exact registered redirect_uri */
  SIMTRADER_PUBLIC_URL: string
  /** Audience simtrader answers to in ID tokens */
  SSO_AUDIENCE: string
  /** OAuth client id simtrader presents to BudgetApp */
  SSO_CLIENT_ID: string
  /** Secret half of that client — `wrangler secret put`, never in wrangler.toml */
  SIMTRADER_SSO_CLIENT_SECRET: string
}

// Hono context variables set by middleware
export interface HonoVars {
  userId: string
  userRole: UserRole
  userStatus: UserStatus
  /** `amr` from the BudgetApp sign-in behind this session; `otp` means 2FA was used. */
  authMethods: string[]
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
