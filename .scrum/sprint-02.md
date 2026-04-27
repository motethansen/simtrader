# Sprint 02 — W1 + W2: Web Foundation, Multi-user Auth & Admin

**Sprint goal**: A user can sign up and reach a dashboard. An admin can log in to a separate admin interface, see all users, manage their accounts, and inspect audit logs. Saxo tokens are accepted, encrypted, and proxy-callable. No browser ever sees a raw token after submission.

**Milestones**: W1 (Web foundation + Admin), W2 (Saxo token vault)
**Status**: Planning
**Period**: TBD

**Prerequisites before starting**:
- Cloudflare Workers account + Wrangler CLI installed
- DO managed Postgres accessible (or docker-compose local Postgres)
- `alembic` in dev venv
- Saxo dev token (24h) for manual proxy testing

---

## Database schema

All migrations live in `src/tradingplatform/persistence/migrations/`.

### Migration 0001 — users + sessions

```sql
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE users (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email           TEXT UNIQUE NOT NULL,
    password_hash   TEXT NOT NULL,                        -- bcrypt, cost 12
    role            TEXT NOT NULL DEFAULT 'user'
                        CHECK (role IN ('user', 'admin')),
    status          TEXT NOT NULL DEFAULT 'active'
                        CHECK (status IN ('active', 'suspended', 'pending')),
    email_verified  BOOLEAN NOT NULL DEFAULT FALSE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_login_at   TIMESTAMPTZ,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_users_email   ON users (email);
CREATE INDEX idx_users_role    ON users (role);
CREATE INDEX idx_users_status  ON users (status);
```

Sessions live in **Workers KV** (not Postgres) — TTL is built-in, no cleanup job needed.

KV key: `session:<token>` → value: `{ user_id, role, expires_at }` (JSON)
TTL: 7 days for users, 24h for admins (shorter session for elevated privilege).

### Migration 0002 — saxo_tokens

```sql
CREATE TABLE saxo_tokens (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    ciphertext  BYTEA NOT NULL,      -- AES-256-GCM encrypted token bytes
    iv          BYTEA NOT NULL,      -- 12-byte GCM nonce, unique per row
    tag         BYTEA NOT NULL,      -- 16-byte GCM auth tag
    expires_at  TIMESTAMPTZ NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_saxo_tokens_user ON saxo_tokens (user_id);  -- one active token per user
CREATE INDEX idx_saxo_tokens_expiry ON saxo_tokens (expires_at);
```

### Migration 0003 — audit_log

```sql
CREATE TABLE audit_log (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_id        UUID REFERENCES users(id) ON DELETE SET NULL,  -- NULL = system/cron
    target_user_id  UUID REFERENCES users(id) ON DELETE SET NULL,
    action          TEXT NOT NULL,   -- namespaced: 'user.suspend', 'token.force_expire', etc.
    detail          JSONB,           -- extra context; never contains secrets
    ip_address      INET,
    ts              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_audit_log_actor      ON audit_log (actor_id, ts DESC);
CREATE INDEX idx_audit_log_target     ON audit_log (target_user_id, ts DESC);
CREATE INDEX idx_audit_log_action     ON audit_log (action, ts DESC);
CREATE INDEX idx_audit_log_ts         ON audit_log (ts DESC);
```

Audit log is **append-only** — no UPDATE or DELETE. Retained ≥ 1 year.

---

## Part A — Auth (multi-user, roles)

### A1. Password + session utilities (shared Workers module)
- [ ] `hashPassword(password: string): Promise<string>` — bcrypt, cost 12
- [ ] `verifyPassword(password: string, hash: string): Promise<boolean>`
- [ ] `createSession(userId, role, kv): Promise<string>` — random 32-byte hex token, stored in KV with TTL
- [ ] `validateSession(token, kv): Promise<{ userId, role } | null>`
- [ ] `destroySession(token, kv): Promise<void>`
- [ ] Auth middleware: extracts Bearer token or cookie, validates, attaches `{ userId, role }` to `ctx`
- [ ] Role guard factory: `requireRole('admin')` → returns 403 if role doesn't match

### A2. Auth endpoints
- [ ] `POST /auth/signup`
  - Validate: email format, password ≥ 12 chars, not already registered
  - Hash password, insert user (`role='user'`, `status='active'`)
  - Create session, return `Set-Cookie: session=<token>; HttpOnly; Secure; SameSite=Strict`
  - Write audit log: `action='user.signup', actor_id=new_user_id`
- [ ] `POST /auth/login`
  - Fetch user by email, bcrypt compare
  - On success: update `last_login_at`, create session, set cookie
  - On fail: uniform error "Invalid email or password" (no user enumeration)
  - Rate limit: 5 failed attempts per IP per 15 min (KV counter + TTL)
  - Write audit log: `action='user.login'` or `'user.login_failed'`
- [ ] `POST /auth/logout` — destroy session, clear cookie
- [ ] `GET /me` — returns `{ id, email, role, status, created_at, last_login_at }`

### A3. User dashboard (public)
- [ ] `GET /dashboard` — served to authenticated users
- [ ] Shows: welcome, token status widget, portfolio list (empty state), recent simulations
- [ ] 403 redirect to `/login` if unauthenticated

---

## Part B — Admin interface

### B1. Admin middleware + routing
- [ ] All `/admin/*` routes require `requireRole('admin')` — hard 403 otherwise
- [ ] Admin session TTL: 24h (shorter than user sessions)
- [ ] Admin actions are always written to `audit_log` — enforced by a wrapper, not by convention

### B2. Admin dashboard — `GET /admin`
- [ ] KPI cards (all read from Postgres):
  - Total users (all time)
  - Active users (logged in last 7 days, by `last_login_at`)
  - Active Saxo tokens right now (`COUNT WHERE expires_at > NOW()`)
  - Tokens expiring in < 1h (early warning)
  - Simulations run today (from `simulation_runs` table, M6+; show 0 until then)
  - Suspended users
- [ ] Recent audit log (last 20 entries) with actor, action, target, timestamp
- [ ] Quick links: User list, Audit log, System health

### B3. User management — `GET /admin/users`
- [ ] Paginated user list (20/page, cursor-based pagination)
- [ ] Columns: email, role, status, created_at, last_login_at, token status (active/expired/none)
- [ ] Search by email (`ILIKE`)
- [ ] Filter by: role, status
- [ ] Sort by: created_at, last_login_at
- [ ] Per-row quick actions: Suspend / Unsuspend / View detail

### B4. User detail — `GET /admin/users/:id`
- [ ] Profile card: all user fields
- [ ] Token section: `expires_at`, created_at, [Force Expire] button
- [ ] Portfolios list (once W3 exists): name, holdings count, last updated
- [ ] Simulations list (once W6 exists): date, strategy, result summary
- [ ] Audit trail for this user: all log entries where `actor_id=id OR target_user_id=id`

### B5. User management actions
- [ ] `PATCH /admin/users/:id/suspend`
  - Sets `status='suspended'`
  - Destroys all active sessions for that user (KV scan by prefix `session:` — or store a set of session tokens per user in KV)
  - Writes audit log: `action='user.suspend', actor_id=admin, target_user_id=id`
- [ ] `PATCH /admin/users/:id/unsuspend`
  - Sets `status='active'`
  - Writes audit log: `action='user.unsuspend'`
- [ ] `PATCH /admin/users/:id/role` — `{ role: 'user' | 'admin' }`
  - Cannot demote yourself (guard: `actorId !== targetId`)
  - Writes audit log: `action='user.role_change', detail: { from, to }`
- [ ] `POST /admin/users/:id/token/expire` — force-expires saxo token
  - Sets `expires_at = NOW()` on token row
  - Writes audit log: `action='token.force_expire'`
- [ ] `DELETE /admin/users/:id`
  - Soft-delete preferred: set `status='deleted'`, anonymise email to `deleted_<id>@deleted`
  - Hard-delete only on explicit `?confirm=true` with a second admin audit log entry
  - Writes audit log: `action='user.delete'`

### B6. Audit log viewer — `GET /admin/audit`
- [ ] Paginated list (50/page), newest first
- [ ] Columns: timestamp, actor email, action, target email, detail (collapsed JSON), IP
- [ ] Filter by: action prefix (e.g. `user.*`, `token.*`), actor, target, date range
- [ ] Export to CSV: `GET /admin/audit/export?from=&to=`
- [ ] Audit log rows are never editable — no PUT/PATCH/DELETE on this table, enforced at DB role level

### B7. System health — `GET /admin/system`
- [ ] Postgres: connection count, DB size, replication lag (if applicable)
- [ ] Token vault: total active tokens, expiring soon, last cleanup run timestamp
- [ ] Workers KV: active session count (approximate, via metadata)
- [ ] Simulation queue: pending jobs, running jobs, failed jobs (once M6 exists)
- [ ] Version: git SHA, deploy timestamp (via `VERSION` env var set by CI)

### B8. Admin UI design
- [ ] Separate layout from user-facing pages: admin nav sidebar + top bar showing logged-in admin email
- [ ] Responsive but desktop-first (admin is an operational tool, not consumer UI)
- [ ] Danger actions (suspend, delete) require confirmation modal before firing
- [ ] Toast notifications for action results
- [ ] Admin login page at `/admin/login` — same endpoint as `/auth/login` but redirects to `/admin`

---

## Part C — Saxo token vault

### C1. Token storage + encryption (same as original sprint-02 plan)
- [ ] AES-256-GCM encryption in DO Function `token-vault`
- [ ] Master key: `TOKEN_ENCRYPTION_KEY` env var (DO Function secret), separate per environment
- [ ] AAD = `user_id.bytes` — ties ciphertext to this user
- [ ] `POST /saxo/token` — encrypt + store (Worker calls Function, token never touches Worker plaintext)
- [ ] `DELETE /saxo/token` — remove row
- [ ] `GET /saxo/token/status` — `{ active, expires_at, expires_in_seconds }` only

### C2. Expiry cleanup
- [ ] DO Functions cron (every 15 min): `DELETE FROM saxo_tokens WHERE expires_at < NOW()`
- [ ] Cron writes audit log: `action='token.cleanup_run', detail: { deleted_count }`, `actor_id=NULL`
- [ ] Worker middleware `requireActiveToken` checks expiry before any proxy call

### C3. Saxo proxy
- [ ] DO Function `saxo-proxy`: decrypt token → forward to Saxo OpenAPI → return response
- [ ] Log: `user_id`, `path`, `status_code`, `duration_ms` — never the token
- [ ] Suspended users: proxy returns 403 before even decrypting token

---

## Definition of done

- [ ] New user can sign up and reach `/dashboard`
- [ ] Admin user (seeded by migration or CLI) can reach `/admin`
- [ ] Admin can view user list, suspend a user, and see the action in audit log
- [ ] Suspended user's session is invalidated immediately
- [ ] User submits Saxo token → `GET /saxo/token/status` returns `{ active: true }`
- [ ] `GET /saxo/proxy/port/v1/accounts` returns real Saxo account data for a valid token
- [ ] Admin can force-expire a user's token; subsequent proxy call returns 402
- [ ] Audit log entry exists for every admin action taken during testing
- [ ] Raw Saxo token never appears in logs, DB, API response, or browser storage
- [ ] `pytest` still passes (13+ tests green)
- [ ] Admin login with non-admin account returns 403

---

## Security checklist

- [ ] bcrypt cost ≥ 12 on password hashes
- [ ] Session tokens: 32-byte random, hex-encoded
- [ ] Admin sessions: 24h TTL (shorter than user 7-day)
- [ ] Saxo token: AES-256-GCM, fresh IV per row, AAD = user_id.bytes
- [ ] Encryption key: DO Function env var only
- [ ] Logs: no token values, no passwords, no session tokens
- [ ] Auth middleware on every protected route
- [ ] Admin role guard on every `/admin/*` route
- [ ] Rate limit on login (5 fails / 15 min / IP)
- [ ] No user enumeration on login failure (uniform error message)
- [ ] `httpOnly; Secure; SameSite=Strict` on session cookie
- [ ] Admin actions cannot be taken on yourself (suspend self, demote self)
- [ ] Audit log: append-only, no UPDATE/DELETE at DB role level
- [ ] Soft-delete users (preserve audit trail); hard-delete requires explicit confirmation

---

## Seed data (local dev)

`make seed-admin` — creates an admin user from env vars `SEED_ADMIN_EMAIL` + `SEED_ADMIN_PASSWORD`.
Fails loudly if run against production DB (checks `TP_MODE` env var).
