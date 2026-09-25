// Tests for the identity-event receiver (ST-f / BudgetApp BA-166).
//
// Real ES256 tokens and a real JWKS behind a stubbed fetch, as in sso-jwt.test.ts, and a fake
// store in place of Postgres and KV. The two that matter most:
//
//   - a deletion erases the member and ends their sessions — BudgetApp tells the member their
//     account is gone on the strength of our 2xx;
//   - an ID token cannot be posted here as an event, and an event cannot be used to sign in.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { verifyIdToken, clearJwksCache, IDENTITY_EVENT_TYP, type IssuerConfig } from '../src/lib/sso-jwt'
import { receiveIdentityEvent, type IdentityEventStore } from '../src/lib/identity-events'

const ISSUER = 'https://api.budgetapp.example.com'
const JWKS_URL = `${ISSUER}/.well-known/jwks.json`
const KID = 'ba-test-1'
const config: IssuerConfig = { issuer: ISSUER, jwksUrl: JWKS_URL, alg: 'ES256', audience: 'simtrader' }

function b64url(bytes: Uint8Array): string {
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

const b64urlJson = (value: unknown) => b64url(new TextEncoder().encode(JSON.stringify(value)))
const now = () => Math.floor(Date.now() / 1000)

async function sign(key: CryptoKey, claims: Record<string, unknown>, typ: string): Promise<string> {
  const head = b64urlJson({ alg: 'ES256', typ, kid: KID })
  const body = b64urlJson(claims)
  const sig = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    key,
    new TextEncoder().encode(`${head}.${body}`),
  )
  return `${head}.${body}.${b64url(new Uint8Array(sig))}`
}

function eventClaims(event: string, overrides: Record<string, unknown> = {}) {
  const iat = now()
  return { iss: ISSUER, aud: 'simtrader', sub: 'budgetapp-user-1', iat, nbf: iat, exp: iat + 300, jti: 'evt-1', event, ...overrides }
}

/** A store that records what it was asked to do. `budgetapp-user-1` is simtrader user `st-1`. */
function fakeStore(known: Record<string, string> = { 'budgetapp-user-1': 'st-1' }) {
  const calls: string[] = []
  const audits: { action: string; detail: Record<string, string> }[] = []
  const store: IdentityEventStore = {
    async findUserId(iss, sub) {
      return iss === ISSUER ? known[sub] ?? null : null
    },
    async eraseUser(userId) {
      calls.push(`erase:${userId}`)
      for (const [sub, id] of Object.entries(known)) if (id === userId) delete known[sub]
    },
    async endSessions(userId) {
      calls.push(`sessions:${userId}`)
    },
    async audit(action, detail) {
      audits.push({ action, detail })
    },
  }
  return { store, calls, audits }
}

describe('identity events', () => {
  let keys: CryptoKeyPair

  beforeEach(async () => {
    clearJwksCache()
    keys = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
    const jwk = await crypto.subtle.exportKey('jwk', keys.publicKey) as Record<string, unknown>
    delete jwk['key_ops']
    delete jwk['ext']
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (String(url) !== JWKS_URL) throw new Error(`unexpected fetch: ${url}`)
      return new Response(JSON.stringify({ keys: [{ ...jwk, kid: KID, alg: 'ES256', use: 'sig' }] }), { status: 200 })
    }))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('erases a deleted member and ends their sessions first', async () => {
    const { store, calls, audits } = fakeStore()
    const token = await sign(keys.privateKey, eventClaims('user.deleted'), IDENTITY_EVENT_TYP)

    const result = await receiveIdentityEvent(token, config, store)

    expect(result).toEqual({ ok: true, event: 'user.deleted', outcome: 'erased' })
    expect(calls).toEqual(['sessions:st-1', 'erase:st-1'])
    expect(audits).toEqual([{ action: 'user.erased', detail: { source: 'budgetapp', event: 'user.deleted', jti: 'evt-1' } }])
  })

  it('the erasure audit row names nobody', async () => {
    const { store, audits } = fakeStore()
    await receiveIdentityEvent(await sign(keys.privateKey, eventClaims('user.deleted'), IDENTITY_EVENT_TYP), config, store)

    const text = JSON.stringify(audits)
    expect(text).not.toContain('st-1')
    expect(text).not.toContain('budgetapp-user-1')
  })

  it('acknowledges a deletion twice — BudgetApp resends on a retried purge', async () => {
    const { store, calls } = fakeStore()
    const first = await sign(keys.privateKey, eventClaims('user.deleted'), IDENTITY_EVENT_TYP)
    const second = await sign(keys.privateKey, eventClaims('user.deleted', { jti: 'evt-2' }), IDENTITY_EVENT_TYP)

    await receiveIdentityEvent(first, config, store)
    const again = await receiveIdentityEvent(second, config, store)

    expect(again).toEqual({ ok: true, event: 'user.deleted', outcome: 'unknown_member' })
    expect(calls).toEqual(['sessions:st-1', 'erase:st-1'])
  })

  it('acknowledges a member simtrader never saw, and touches nothing', async () => {
    const { store, calls } = fakeStore({})
    const result = await receiveIdentityEvent(await sign(keys.privateKey, eventClaims('user.deleted'), IDENTITY_EVENT_TYP), config, store)

    expect(result).toEqual({ ok: true, event: 'user.deleted', outcome: 'unknown_member' })
    expect(calls).toEqual([])
  })

  it.each(['user.suspended', 'user.sessions_revoked'])('%s ends sessions and deletes nothing', async (event) => {
    const { store, calls } = fakeStore()
    const result = await receiveIdentityEvent(await sign(keys.privateKey, eventClaims(event), IDENTITY_EVENT_TYP), config, store)

    expect(result).toEqual({ ok: true, event, outcome: 'sessions_ended' })
    expect(calls).toEqual(['sessions:st-1'])
  })

  it('refuses an ID token posted as an event', async () => {
    const { store, calls } = fakeStore()
    const idToken = await sign(keys.privateKey, { ...eventClaims('user.deleted'), nonce: 'n' }, 'JWT')

    const result = await receiveIdentityEvent(idToken, config, store)

    expect(result).toEqual({ ok: false, status: 401, reason: 'typ_mismatch' })
    expect(calls).toEqual([])
  })

  it('an event cannot be used to sign in', async () => {
    const event = await sign(keys.privateKey, eventClaims('user.deleted'), IDENTITY_EVENT_TYP)

    // Without a nonce, as ID-token verification is called — the typ alone refuses it.
    expect(await verifyIdToken(event, config)).toEqual({ ok: false, reason: 'typ_mismatch' })
  })

  it('refuses an event for another audience', async () => {
    const { store } = fakeStore()
    const token = await sign(keys.privateKey, eventClaims('user.deleted', { aud: 'someone-else' }), IDENTITY_EVENT_TYP)

    expect(await receiveIdentityEvent(token, config, store)).toEqual({ ok: false, status: 401, reason: 'audience_mismatch' })
  })

  it('refuses an event signed by a key BudgetApp does not publish', async () => {
    const { store, calls } = fakeStore()
    const stranger = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
    const token = await sign(stranger.privateKey, eventClaims('user.deleted'), IDENTITY_EVENT_TYP)

    expect(await receiveIdentityEvent(token, config, store)).toEqual({ ok: false, status: 401, reason: 'bad_signature' })
    expect(calls).toEqual([])
  })

  it('refuses an expired event', async () => {
    const { store } = fakeStore()
    const token = await sign(keys.privateKey, eventClaims('user.deleted', { exp: now() - 3600 }), IDENTITY_EVENT_TYP)

    expect(await receiveIdentityEvent(token, config, store)).toEqual({ ok: false, status: 401, reason: 'expired' })
  })

  it('refuses an event it does not know, rather than guessing', async () => {
    const { store, calls } = fakeStore()
    const token = await sign(keys.privateKey, eventClaims('user.renamed'), IDENTITY_EVENT_TYP)

    expect(await receiveIdentityEvent(token, config, store)).toEqual({ ok: false, status: 400, reason: 'unsupported_event' })
    expect(calls).toEqual([])
  })

  it('answers 503 when the JWKS cannot be fetched, so BudgetApp retries instead of giving up', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('down', { status: 502 })))
    const { store } = fakeStore()
    const token = await sign(keys.privateKey, eventClaims('user.deleted'), IDENTITY_EVENT_TYP)

    expect(await receiveIdentityEvent(token, config, store)).toEqual({ ok: false, status: 503, reason: 'jwks_unavailable' })
  })
})
