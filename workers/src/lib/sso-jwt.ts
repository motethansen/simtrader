// Verifier for ID tokens from a configured external identity provider (ST-008).
//
// The only issuer today is BudgetApp, which signs ES256. Every check here is deliberately
// strict, because a relying party that is lax about any one of them accepts forged identities:
//
//   - `alg` is pinned per issuer and must also match the key type. A token is never allowed to
//     choose its own algorithm, which is what turns "RS256 or whatever the key is" into a
//     confusion attack.
//   - The JWKS URL comes from OUR issuer config, never from the token. A token that could name
//     its own key source could name one the attacker controls.
//   - `exp` is required. The previous version compared `payload.exp < now`, which is `false`
//     when `exp` is absent, so a token with no expiry verified forever.
//   - `nbf` and `iat` are honoured with a small leeway for clock skew.
//
// JWKS responses are cached per URL for the lifetime of the isolate, up to 5 minutes.

export interface IdTokenClaims {
  iss: string
  sub: string
  aud: string | string[]
  exp: number
  iat: number
  nbf?: number
  jti?: string
  nonce?: string
  auth_time?: number
  amr?: string[]
  email?: string
  email_verified?: boolean
  name?: string
  /** Identity events only (ST-f): which lifecycle event this is. Never present in an ID token. */
  event?: string
}

/**
 * The `typ` header BudgetApp puts on identity events (BA-166 / ST-f). One key signs both ID
 * tokens and events, so the header is what keeps them apart: the event receiver requires it,
 * and ID-token verification refuses it.
 */
export const IDENTITY_EVENT_TYP = 'identity-event'

export type SignatureAlg = 'ES256' | 'RS256'

export interface IssuerConfig {
  /** Exact `iss` string the token must carry. */
  issuer: string
  /** Where this issuer's public keys live. Taken from config, never from the token. */
  jwksUrl: string
  /** The single algorithm this issuer is allowed to sign with. */
  alg: SignatureAlg
  /** The audience this relying party answers to. */
  audience: string
}

export type VerifyFailure =
  | 'malformed'
  | 'typ_mismatch'
  | 'alg_not_allowed'
  | 'issuer_mismatch'
  | 'audience_mismatch'
  | 'exp_missing'
  | 'expired'
  | 'iat_missing'
  | 'iat_in_future'
  | 'not_yet_valid'
  | 'nonce_mismatch'
  | 'jwks_unavailable'
  | 'no_matching_key'
  | 'bad_signature'

export type VerifyResult =
  | { ok: true; claims: IdTokenClaims }
  | { ok: false; reason: VerifyFailure }

interface JwkKey {
  kty: string
  kid?: string
  use?: string
  alg?: string
  n?: string   // RSA modulus (base64url)
  e?: string   // RSA exponent (base64url)
  x?: string   // EC x (base64url)
  y?: string   // EC y (base64url)
  crv?: string // EC curve name
}

interface Jwks {
  keys: JwkKey[]
}

// Clock skew allowance, in seconds, for exp/nbf/iat.
const LEEWAY_SECONDS = 60

// Module-level JWKS cache — shared across requests in the same isolate.
const jwksCache = new Map<string, { keys: JwkKey[]; fetchedAt: number }>()
const JWKS_TTL_MS = 5 * 60 * 1000 // 5 minutes

/** Exported for tests: drops cached JWKS so each case starts clean. */
export function clearJwksCache(): void {
  jwksCache.clear()
}

async function fetchJwks(jwksUrl: string): Promise<JwkKey[]> {
  const cached = jwksCache.get(jwksUrl)
  if (cached && Date.now() - cached.fetchedAt < JWKS_TTL_MS) return cached.keys

  const resp = await fetch(jwksUrl, { cf: { cacheEverything: true, cacheTtl: 300 } } as RequestInit)
  if (!resp.ok) throw new Error(`JWKS fetch failed: ${resp.status}`)
  const jwks = await resp.json() as Jwks
  if (!Array.isArray(jwks.keys)) throw new Error('JWKS has no keys array')
  jwksCache.set(jwksUrl, { keys: jwks.keys, fetchedAt: Date.now() })
  return jwks.keys
}

function base64urlToBuffer(b64: string): ArrayBuffer {
  const padded = b64.replace(/-/g, '+').replace(/_/g, '/').padEnd(
    b64.length + (4 - (b64.length % 4)) % 4, '='
  )
  const bin = atob(padded)
  const buf = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i)
  return buf.buffer
}

async function importVerifyKey(jwk: JwkKey, alg: SignatureAlg): Promise<CryptoKey> {
  if (alg === 'ES256') {
    return crypto.subtle.importKey(
      'jwk',
      jwk as JsonWebKey,
      { name: 'ECDSA', namedCurve: jwk.crv ?? 'P-256' },
      false,
      ['verify'],
    )
  }
  return crypto.subtle.importKey(
    'jwk',
    jwk as JsonWebKey,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify'],
  )
}

function verifyParams(alg: SignatureAlg): SubtleCryptoSignAlgorithm {
  return alg === 'ES256'
    ? { name: 'ECDSA', hash: 'SHA-256' }
    : { name: 'RSASSA-PKCS1-v1_5' }
}

/** The key type a given algorithm must be backed by — blocks alg/key confusion. */
function expectedKty(alg: SignatureAlg): string {
  return alg === 'ES256' ? 'EC' : 'RSA'
}

interface ParsedJwt {
  header: Record<string, string>
  payload: IdTokenClaims
  sig: ArrayBuffer
  message: Uint8Array
}

function parseJwtParts(token: string): ParsedJwt | null {
  const parts = token.split('.')
  if (parts.length !== 3) return null
  try {
    const header = JSON.parse(atob(parts[0]!.replace(/-/g, '+').replace(/_/g, '/'))) as Record<string, string>
    const payload = JSON.parse(atob(parts[1]!.replace(/-/g, '+').replace(/_/g, '/'))) as IdTokenClaims
    const sig = base64urlToBuffer(parts[2]!)
    const message = new TextEncoder().encode(`${parts[0]}.${parts[1]}`)
    return { header, payload, sig, message }
  } catch {
    return null
  }
}

export interface VerifyOptions {
  /** When set, the token's `nonce` must equal this exactly. */
  nonce?: string
  /**
   * When set, the header `typ` must equal this exactly — the event receiver passes
   * IDENTITY_EVENT_TYP. When unset, the token is being verified as an ID token, and a token
   * labelled as an identity event is refused: it is a signed statement *about* a member, not a
   * sign-in *by* one.
   */
  typ?: string
  /** Override "now" (seconds since epoch). Tests only. */
  now?: number
}

export async function verifyIdToken(
  token: string,
  config: IssuerConfig,
  options: VerifyOptions = {},
): Promise<VerifyResult> {
  const parsed = parseJwtParts(token)
  if (!parsed) return { ok: false, reason: 'malformed' }

  const { header, payload, sig, message } = parsed
  const now = options.now ?? Math.floor(Date.now() / 1000)

  // --- Claims first: cheap, and they decide which key we are even allowed to use ---
  const typ = header['typ']
  if (options.typ !== undefined ? typ !== options.typ : typ === IDENTITY_EVENT_TYP) {
    return { ok: false, reason: 'typ_mismatch' }
  }
  if ((header['alg'] ?? '') !== config.alg) return { ok: false, reason: 'alg_not_allowed' }
  if (payload.iss !== config.issuer) return { ok: false, reason: 'issuer_mismatch' }

  const audMatch = Array.isArray(payload.aud)
    ? payload.aud.includes(config.audience)
    : payload.aud === config.audience
  if (!audMatch) return { ok: false, reason: 'audience_mismatch' }

  if (typeof payload.exp !== 'number') return { ok: false, reason: 'exp_missing' }
  if (payload.exp + LEEWAY_SECONDS <= now) return { ok: false, reason: 'expired' }

  if (typeof payload.iat !== 'number') return { ok: false, reason: 'iat_missing' }
  if (payload.iat - LEEWAY_SECONDS > now) return { ok: false, reason: 'iat_in_future' }

  if (typeof payload.nbf === 'number' && payload.nbf - LEEWAY_SECONDS > now) {
    return { ok: false, reason: 'not_yet_valid' }
  }

  if (options.nonce !== undefined && payload.nonce !== options.nonce) {
    return { ok: false, reason: 'nonce_mismatch' }
  }

  // --- Signature, against keys from OUR configured JWKS for this issuer ---
  let keys: JwkKey[]
  try {
    keys = await fetchJwks(config.jwksUrl)
  } catch {
    return { ok: false, reason: 'jwks_unavailable' }
  }

  const kid = header['kid']
  const candidates = keys
    .filter(k => k.kty === expectedKty(config.alg))
    .filter(k => k.alg === undefined || k.alg === config.alg)
    .filter(k => (kid ? k.kid === kid : true))
  if (candidates.length === 0) return { ok: false, reason: 'no_matching_key' }

  for (const jwk of candidates) {
    try {
      const cryptoKey = await importVerifyKey(jwk, config.alg)
      const verified = await crypto.subtle.verify(verifyParams(config.alg), cryptoKey, sig, message)
      if (verified) return { ok: true, claims: payload }
    } catch {
      continue
    }
  }

  return { ok: false, reason: 'bad_signature' }
}
