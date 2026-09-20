// Tests for the ID token verifier (ST-008 / ST-a).
//
// Each case here corresponds to a way a relying party can be fooled. They mint real ES256
// tokens with WebCrypto and serve a real JWKS through a stubbed fetch, so a regression in the
// crypto path fails too, not just the claim checks.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { verifyIdToken, clearJwksCache, type IssuerConfig } from '../src/lib/sso-jwt'

const ISSUER = 'https://api.budgetapp.example.com'
const JWKS_URL = `${ISSUER}/.well-known/jwks.json`
const AUDIENCE = 'simtrader'
const KID = 'ba-test-1'

const config: IssuerConfig = { issuer: ISSUER, jwksUrl: JWKS_URL, alg: 'ES256', audience: AUDIENCE }

function b64url(bytes: Uint8Array): string {
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function b64urlJson(value: unknown): string {
  return b64url(new TextEncoder().encode(JSON.stringify(value)))
}

async function makeEcKeypair() {
  return crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
}

async function makeRsaKeypair() {
  return crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify'],
  )
}

async function publicJwk(key: CryptoKey, kid = KID, alg = 'ES256') {
  const jwk = await crypto.subtle.exportKey('jwk', key) as Record<string, unknown>
  delete jwk['d']
  delete jwk['key_ops']
  delete jwk['ext']
  return { ...jwk, kid, alg, use: 'sig' }
}

function now(): number {
  return Math.floor(Date.now() / 1000)
}

function baseClaims(overrides: Record<string, unknown> = {}) {
  const iat = now()
  return {
    iss: ISSUER,
    aud: AUDIENCE,
    sub: 'budgetapp-user-1',
    iat,
    nbf: iat,
    exp: iat + 300,
    jti: 'jti-1',
    nonce: 'nonce-1',
    auth_time: iat - 60,
    amr: ['pwd', 'otp'],
    email: 'user@example.com',
    email_verified: false,
    name: 'A User',
    ...overrides,
  }
}

async function signToken(
  privateKey: CryptoKey,
  claims: Record<string, unknown>,
  header: Record<string, unknown> = {},
  alg: 'ES256' | 'RS256' = 'ES256',
): Promise<string> {
  const head = b64urlJson({ alg, typ: 'JWT', kid: KID, ...header })
  const body = b64urlJson(claims)
  const message = new TextEncoder().encode(`${head}.${body}`)
  const params = alg === 'ES256'
    ? { name: 'ECDSA', hash: 'SHA-256' }
    : { name: 'RSASSA-PKCS1-v1_5' }
  const sig = await crypto.subtle.sign(params as AlgorithmIdentifier, privateKey, message)
  return `${head}.${body}.${b64url(new Uint8Array(sig))}`
}

function stubJwks(keys: unknown[]) {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (String(url) !== JWKS_URL) throw new Error(`unexpected fetch: ${url}`)
    return new Response(JSON.stringify({ keys }), { status: 200 })
  }))
}

describe('verifyIdToken', () => {
  let keys: CryptoKeyPair

  beforeEach(async () => {
    clearJwksCache()
    keys = await makeEcKeypair()
    stubJwks([await publicJwk(keys.publicKey)])
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('accepts a well-formed token', async () => {
    const token = await signToken(keys.privateKey, baseClaims())
    const result = await verifyIdToken(token, config, { nonce: 'nonce-1' })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.claims.sub).toBe('budgetapp-user-1')
      expect(result.claims.amr).toEqual(['pwd', 'otp'])
    }
  })

  it('rejects a token with no exp', async () => {
    // The old verifier compared `payload.exp < now`, which is false when exp is undefined,
    // so a token with no expiry was valid forever.
    const claims = baseClaims()
    delete (claims as Record<string, unknown>)['exp']
    const token = await signToken(keys.privateKey, claims)
    const result = await verifyIdToken(token, config, { nonce: 'nonce-1' })
    expect(result).toEqual({ ok: false, reason: 'exp_missing' })
  })

  it('rejects an expired token', async () => {
    const token = await signToken(keys.privateKey, baseClaims({ exp: now() - 3600 }))
    expect(await verifyIdToken(token, config)).toEqual({ ok: false, reason: 'expired' })
  })

  it('rejects a token from another issuer, even if correctly signed', async () => {
    const token = await signToken(keys.privateKey, baseClaims({ iss: 'https://auth.evil.example' }))
    expect(await verifyIdToken(token, config)).toEqual({ ok: false, reason: 'issuer_mismatch' })
  })

  it('rejects a token minted for a different audience', async () => {
    const token = await signToken(keys.privateKey, baseClaims({ aud: 'someone-else' }))
    expect(await verifyIdToken(token, config)).toEqual({ ok: false, reason: 'audience_mismatch' })
  })

  it('accepts an audience array that contains us', async () => {
    const token = await signToken(keys.privateKey, baseClaims({ aud: ['other', AUDIENCE] }))
    expect((await verifyIdToken(token, config)).ok).toBe(true)
  })

  it('rejects a token that is not valid yet, beyond the leeway', async () => {
    const token = await signToken(keys.privateKey, baseClaims({ nbf: now() + 600 }))
    expect(await verifyIdToken(token, config)).toEqual({ ok: false, reason: 'not_yet_valid' })
  })

  it('tolerates small clock skew on nbf', async () => {
    const token = await signToken(keys.privateKey, baseClaims({ nbf: now() + 30 }))
    expect((await verifyIdToken(token, config)).ok).toBe(true)
  })

  it('rejects a mismatched nonce', async () => {
    const token = await signToken(keys.privateKey, baseClaims({ nonce: 'someone-elses-nonce' }))
    const result = await verifyIdToken(token, config, { nonce: 'nonce-1' })
    expect(result).toEqual({ ok: false, reason: 'nonce_mismatch' })
  })

  it('rejects an alg the issuer is not configured for', async () => {
    const rsa = await makeRsaKeypair()
    stubJwks([await publicJwk(rsa.publicKey, KID, 'RS256')])
    const token = await signToken(rsa.privateKey, baseClaims(), {}, 'RS256')
    expect(await verifyIdToken(token, config)).toEqual({ ok: false, reason: 'alg_not_allowed' })
  })

  it('rejects "alg: none"', async () => {
    const head = b64urlJson({ alg: 'none', typ: 'JWT', kid: KID })
    const body = b64urlJson(baseClaims())
    expect(await verifyIdToken(`${head}.${body}.`, config)).toEqual({ ok: false, reason: 'alg_not_allowed' })
  })

  it('rejects a token signed by a key that is not in the JWKS', async () => {
    const attacker = await makeEcKeypair()
    const token = await signToken(attacker.privateKey, baseClaims())
    expect(await verifyIdToken(token, config)).toEqual({ ok: false, reason: 'bad_signature' })
  })

  it('rejects a tampered payload', async () => {
    const token = await signToken(keys.privateKey, baseClaims())
    const [head, , sig] = token.split('.')
    const forged = `${head}.${b64urlJson(baseClaims({ sub: 'someone-else' }))}.${sig}`
    expect(await verifyIdToken(forged, config)).toEqual({ ok: false, reason: 'bad_signature' })
  })

  it('rejects a token whose kid is not published', async () => {
    const token = await signToken(keys.privateKey, baseClaims(), { kid: 'rotated-away' })
    expect(await verifyIdToken(token, config)).toEqual({ ok: false, reason: 'no_matching_key' })
  })

  it('rejects malformed input', async () => {
    expect(await verifyIdToken('not-a-jwt', config)).toEqual({ ok: false, reason: 'malformed' })
  })

  it('reports an unreachable JWKS rather than passing the token', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 500 })))
    const token = await signToken(keys.privateKey, baseClaims())
    expect(await verifyIdToken(token, config)).toEqual({ ok: false, reason: 'jwks_unavailable' })
  })

  it('caches JWKS across verifications', async () => {
    const fetchSpy = vi.fn(async () => new Response(
      JSON.stringify({ keys: [await publicJwk(keys.publicKey)] }), { status: 200 },
    ))
    vi.stubGlobal('fetch', fetchSpy)
    const token = await signToken(keys.privateKey, baseClaims())
    await verifyIdToken(token, config)
    await verifyIdToken(token, config)
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })
})
