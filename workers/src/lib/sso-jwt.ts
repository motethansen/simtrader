// Bridge JWT verifier for urbanlife.works SSO tokens.
// Supports RS256 and ES256. JWKS is fetched and cached in memory for the
// lifetime of the Worker isolate (typically minutes).

export interface BridgeClaims {
  sub: string
  email: string
  iss: string
  aud: string | string[]
  exp: number
  iat: number
  name?: string
}

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

// Module-level JWKS cache — shared across requests in the same isolate.
const jwksCache = new Map<string, { keys: JwkKey[]; fetchedAt: number }>()
const JWKS_TTL_MS = 5 * 60 * 1000 // 5 minutes

async function fetchJwks(jwksUrl: string): Promise<JwkKey[]> {
  const cached = jwksCache.get(jwksUrl)
  if (cached && Date.now() - cached.fetchedAt < JWKS_TTL_MS) return cached.keys

  const resp = await fetch(jwksUrl, { cf: { cacheEverything: true, cacheTtl: 300 } } as RequestInit)
  if (!resp.ok) throw new Error(`JWKS fetch failed: ${resp.status}`)
  const jwks = await resp.json() as Jwks
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

async function importRsaKey(jwk: JwkKey): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'jwk',
    jwk as JsonWebKey,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify'],
  )
}

async function importEcKey(jwk: JwkKey): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'jwk',
    jwk as JsonWebKey,
    { name: 'ECDSA', namedCurve: jwk.crv ?? 'P-256' },
    false,
    ['verify'],
  )
}

function parseJwtParts(token: string): { header: Record<string, string>; payload: BridgeClaims; sig: ArrayBuffer; message: Uint8Array } | null {
  const parts = token.split('.')
  if (parts.length !== 3) return null
  try {
    const header = JSON.parse(atob(parts[0]!.replace(/-/g, '+').replace(/_/g, '/'))) as Record<string, string>
    const payload = JSON.parse(atob(parts[1]!.replace(/-/g, '+').replace(/_/g, '/'))) as BridgeClaims
    const sig = base64urlToBuffer(parts[2]!)
    const message = new TextEncoder().encode(`${parts[0]}.${parts[1]}`)
    return { header, payload, sig, message }
  } catch {
    return null
  }
}

export async function verifyBridgeJwt(
  token: string,
  jwksUrl: string,
  audience: string,
): Promise<BridgeClaims | null> {
  const parsed = parseJwtParts(token)
  if (!parsed) return null

  const { header, payload, sig, message } = parsed
  const now = Math.floor(Date.now() / 1000)

  // Verify standard claims before touching crypto
  if (payload.exp < now) return null
  const audMatch = Array.isArray(payload.aud)
    ? payload.aud.includes(audience)
    : payload.aud === audience
  if (!audMatch) return null

  // Find a matching key in JWKS
  let keys: JwkKey[]
  try {
    keys = await fetchJwks(jwksUrl)
  } catch {
    return null
  }

  const kid = header['kid']
  const candidates = kid ? keys.filter(k => k.kid === kid) : keys
  if (candidates.length === 0) return null

  const alg = (header['alg'] ?? '').toUpperCase()

  for (const jwk of candidates) {
    try {
      let cryptoKey: CryptoKey
      let verified: boolean

      if (alg === 'RS256' || jwk.kty === 'RSA') {
        cryptoKey = await importRsaKey(jwk)
        verified = await crypto.subtle.verify(
          { name: 'RSASSA-PKCS1-v1_5' },
          cryptoKey,
          sig,
          message,
        )
      } else if (alg === 'ES256' || jwk.kty === 'EC') {
        cryptoKey = await importEcKey(jwk)
        verified = await crypto.subtle.verify(
          { name: 'ECDSA', hash: 'SHA-256' },
          cryptoKey,
          sig,
          message,
        )
      } else {
        continue
      }

      if (verified) return payload
    } catch {
      continue
    }
  }

  return null
}
