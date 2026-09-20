// A stand-in for BudgetApp's SSO endpoints, for local development and end-to-end testing.
//
// It implements exactly the three things simtrader depends on, and nothing else:
//   GET  /.well-known/jwks.json   the ES256 public key
//   GET  /connect                 what BudgetApp's consent page does: mint a code, redirect back
//   POST /api/v1/sso/token        PKCE check, then an ID token
//
// It signs with a throwaway key generated at startup, so it can never be mistaken for the real
// thing. Use it to test simtrader before BudgetApp's side is built:
//
//   node test/fake-idp.mjs &
//   npx wrangler dev --port 8787 \
//     --var BUDGETAPP_ISSUER:http://localhost:8901 \
//     --var BUDGETAPP_JWKS_URL:http://localhost:8901/.well-known/jwks.json \
//     --var BUDGETAPP_TOKEN_URL:http://localhost:8901/api/v1/sso/token \
//     --var BUDGETAPP_CONNECT_URL:http://localhost:8901/connect \
//     --var SIMTRADER_PUBLIC_URL:http://localhost:8787
//
// Then open http://localhost:8787/auth/budgetapp/start in a browser.
//
// Query parameters on /connect let you play the cases that matter:
//   ?sub=...      which BudgetApp user to be (default fake-user-1)
//   ?email=...    the email claim
//   ?amr=pwd      sign in WITHOUT 2FA, to check that /admin refuses (default pwd,otp)

import http from 'node:http'
import { webcrypto as crypto } from 'node:crypto'

const PORT = Number(process.env.FAKE_IDP_PORT ?? 8901)
const ISSUER = process.env.FAKE_IDP_ISSUER ?? `http://localhost:${PORT}`
const AUDIENCE = 'simtrader'
const KID = 'fake-idp-1'

const keypair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
const publicJwk = await crypto.subtle.exportKey('jwk', keypair.publicKey)
delete publicJwk.key_ops
delete publicJwk.ext
const jwks = { keys: [{ ...publicJwk, kid: KID, alg: 'ES256', use: 'sig' }] }

/** code → what it was issued for. One-time, 60 seconds, like the real thing. */
const codes = new Map()

const b64url = (bytes) => Buffer.from(bytes).toString('base64url')
const b64urlJson = (v) => Buffer.from(JSON.stringify(v)).toString('base64url')
const randomId = () => b64url(crypto.getRandomValues(new Uint8Array(24)))

async function s256(verifier) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
  return b64url(new Uint8Array(digest))
}

async function mintIdToken({ sub, email, name, nonce, amr }) {
  const iat = Math.floor(Date.now() / 1000)
  const header = { alg: 'ES256', typ: 'JWT', kid: KID }
  const payload = {
    iss: ISSUER, aud: AUDIENCE, sub,
    iat, nbf: iat, exp: iat + 300,
    jti: randomId(), nonce, auth_time: iat - 30,
    amr, email, email_verified: false, name,
  }
  const message = `${b64urlJson(header)}.${b64urlJson(payload)}`
  const sig = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' }, keypair.privateKey, new TextEncoder().encode(message),
  )
  return `${message}.${b64url(new Uint8Array(sig))}`
}

function send(res, status, body, type = 'application/json') {
  res.writeHead(status, { 'Content-Type': type })
  res.end(typeof body === 'string' ? body : JSON.stringify(body))
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`)

  if (req.method === 'GET' && url.pathname === '/.well-known/jwks.json') {
    return send(res, 200, jwks)
  }

  // Stands in for BudgetApp's consent page: consent is assumed, a code is minted, done.
  if (req.method === 'GET' && url.pathname === '/connect') {
    const q = url.searchParams
    const redirectUri = q.get('redirect_uri')
    if (!redirectUri || q.get('code_challenge_method') !== 'S256') {
      return send(res, 400, { error: 'invalid_request' })
    }
    const code = randomId()
    codes.set(code, {
      challenge: q.get('code_challenge'),
      nonce: q.get('nonce'),
      redirectUri,
      sub: q.get('sub') ?? 'fake-user-1',
      email: q.get('email') ?? 'fake.user@example.com',
      name: q.get('name') ?? 'Fake User',
      amr: (q.get('amr') ?? 'pwd,otp').split(','),
      expiresAt: Date.now() + 60_000,
    })
    const back = new URL(redirectUri)
    back.searchParams.set('code', code)
    back.searchParams.set('state', q.get('state') ?? '')
    res.writeHead(302, { Location: back.toString() })
    return res.end()
  }

  if (req.method === 'POST' && url.pathname === '/api/v1/sso/token') {
    const raw = await new Promise((resolve) => {
      let data = ''
      req.on('data', (c) => { data += c })
      req.on('end', () => resolve(data))
    })
    const form = new URLSearchParams(raw)
    const entry = codes.get(form.get('code'))
    // Single use: gone whether or not the rest of the checks pass.
    codes.delete(form.get('code'))

    if (!entry) return send(res, 400, { error: 'invalid_grant' })
    if (entry.expiresAt < Date.now()) return send(res, 400, { error: 'expired_code' })
    if (form.get('redirect_uri') !== entry.redirectUri) return send(res, 400, { error: 'redirect_uri_mismatch' })
    if (!form.get('client_secret')) return send(res, 401, { error: 'invalid_client' })
    if (await s256(form.get('code_verifier') ?? '') !== entry.challenge) {
      return send(res, 400, { error: 'pkce_mismatch' })
    }

    const idToken = await mintIdToken(entry)
    return send(res, 200, { id_token: idToken, token_type: 'Bearer', expires_in: 300 })
  }

  send(res, 404, { error: 'not_found' })
})

server.listen(PORT, () => {
  console.log(`fake IdP on ${ISSUER} — jwks, /connect, /api/v1/sso/token`)
})
