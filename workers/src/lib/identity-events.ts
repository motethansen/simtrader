// Identity events from BudgetApp — ST-f, the receiving half of BudgetApp's BA-166.
//
// simtrader is a module of BudgetApp: one product, one data controller. When a member deletes
// their BudgetApp account, their simtrader data has to go too, and BudgetApp refuses the deletion
// until this receiver has acknowledged it. So a 2xx from here is a promise: the data is gone.
//
// Each event is a POST whose body is one ES256 JWT, signed with the same key as BudgetApp's ID
// tokens and verified against the same issuer config. What makes it an event and not a sign-in:
//
//   - header `typ: identity-event`, required here and refused by the sign-in callback;
//   - an `event` claim naming what happened;
//   - `sub` is BudgetApp's user id, mapped through `external_identities` — never an email.
//
// Every event is idempotent. A member simtrader never saw is acknowledged (there is nothing to
// erase), and a repeated deletion finds nothing and says so. BudgetApp relies on this: it resends
// `user.deleted` when a purge it started has to be retried.

import { IDENTITY_EVENT_TYP, verifyIdToken, type IdTokenClaims, type IssuerConfig } from './sso-jwt'

export const USER_DELETED = 'user.deleted'
export const USER_SUSPENDED = 'user.suspended'
export const USER_SESSIONS_REVOKED = 'user.sessions_revoked'

const KNOWN_EVENTS = new Set([USER_DELETED, USER_SUSPENDED, USER_SESSIONS_REVOKED])

/** What the receiver needs from the outside world. The route passes Postgres and KV. */
export interface IdentityEventStore {
  /** simtrader's user id for BudgetApp's `(iss, sub)`, or null if this member never signed in. */
  findUserId(iss: string, sub: string): Promise<string | null>
  /** Delete the user and everything hanging off them. Foreign keys cascade from `users`. */
  eraseUser(userId: string): Promise<void>
  /** End every live session this user has. */
  endSessions(userId: string): Promise<void>
  /** Record what happened, without naming the person — see `applyIdentityEvent`. */
  audit(action: string, detail: Record<string, string>): Promise<void>
}

export type EventOutcome = 'erased' | 'sessions_ended' | 'unknown_member'

export type ReceiveResult =
  | { ok: true; event: string; outcome: EventOutcome }
  | { ok: false; status: 400 | 401 | 503; reason: string }

/** Verify an event token. Rejections carry the status the route should answer with. */
export async function verifyIdentityEvent(
  token: string,
  issuer: IssuerConfig,
  options: { now?: number } = {},
): Promise<{ ok: true; claims: IdTokenClaims & { event: string } } | { ok: false; status: 400 | 401 | 503; reason: string }> {
  const result = await verifyIdToken(token, issuer, { typ: IDENTITY_EVENT_TYP, now: options.now })
  if (!result.ok) {
    // An unreachable JWKS is our problem, not a bad token: 503 makes BudgetApp's deletion fail
    // closed and retryable instead of treating the event as refused for good.
    return result.reason === 'jwks_unavailable'
      ? { ok: false, status: 503, reason: result.reason }
      : { ok: false, status: 401, reason: result.reason }
  }
  const { event } = result.claims
  if (typeof event !== 'string' || !KNOWN_EVENTS.has(event)) {
    return { ok: false, status: 400, reason: 'unsupported_event' }
  }
  return { ok: true, claims: { ...result.claims, event } }
}

/** Carry out a verified event. Throws only if the store does, which the route turns into a 5xx. */
export async function applyIdentityEvent(
  claims: IdTokenClaims & { event: string },
  store: IdentityEventStore,
): Promise<EventOutcome> {
  const userId = await store.findUserId(claims.iss, claims.sub)
  if (!userId) return 'unknown_member'

  if (claims.event === USER_DELETED) {
    // Sessions first: a session that outlived its user would point at nothing, and the next
    // request on it should find no session rather than a missing row.
    await store.endSessions(userId)
    await store.eraseUser(userId)
    // No user id, no email: the row records that an erasure happened and on whose instruction,
    // and survives because it names nobody. `jti` matches BudgetApp's side of the same event.
    await store.audit('user.erased', { source: 'budgetapp', event: claims.event, jti: claims.jti ?? '' })
    return 'erased'
  }

  // user.suspended and user.sessions_revoked both end sessions and nothing else. Suspension is
  // deliberately NOT copied into `users.status`: there is no "reactivated" event, and BudgetApp's
  // /sso/authorize already refuses a suspended member, so it stays the single place that decides.
  await store.endSessions(userId)
  await store.audit('user.sessions_ended', { source: 'budgetapp', event: claims.event, user_id: userId })
  return 'sessions_ended'
}

/** Verify, then apply. The route is a thin wrapper around this. */
export async function receiveIdentityEvent(
  token: string,
  issuer: IssuerConfig,
  store: IdentityEventStore,
  options: { now?: number } = {},
): Promise<ReceiveResult> {
  const verified = await verifyIdentityEvent(token, issuer, options)
  if (!verified.ok) return verified
  const outcome = await applyIdentityEvent(verified.claims, store)
  return { ok: true, event: verified.claims.event, outcome }
}
