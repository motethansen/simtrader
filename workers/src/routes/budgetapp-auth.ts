// BudgetApp sign-in — OpenID Connect authorization code + PKCE (ST-008).
//
// BudgetApp is the only way into simtrader. There is no sign-up and no password login.
//
// The flow always STARTS here, never at BudgetApp. That is what lets simtrader create the
// `state`, `nonce` and PKCE verifier that tie the eventual token to this browser. A provider
// that pushed a code to us unasked would have no `state` to check, so an attacker could sign a
// victim into the attacker's simtrader account (login CSRF).

import { Hono } from 'hono'
import { setCookie } from 'hono/cookie'
import type { Env, HonoVars } from '../lib/types'
import { getDb } from '../lib/db'
import { createSession, SESSION_TTL_SECONDS } from '../lib/session'
import { writeAudit } from '../lib/audit'
import { verifyIdToken } from '../lib/sso-jwt'
import { budgetAppConnectUrl, budgetAppIssuer, budgetAppTokenUrl, BUDGETAPP_PROVIDER } from '../lib/issuers'

const budgetappAuth = new Hono<{ Bindings: Env; Variables: HonoVars }>()

// A started flow is worth nothing after 10 minutes, and may be completed exactly once.
const FLOW_TTL_SECONDS = 600

interface FlowState {
  nonce: string
  codeVerifier: string
  next: string | null
  startedAt: number
}

function randomUrlSafe(bytes = 32): string {
  return base64url(crypto.getRandomValues(new Uint8Array(bytes)))
}

function base64url(bytes: Uint8Array): string {
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

async function s256Challenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
  return base64url(new Uint8Array(digest))
}

/** The redirect URI BudgetApp has registered. It is matched exactly, so it is built, not guessed. */
export function redirectUri(env: Env): string {
  return new URL('/auth/budgetapp/callback', env.SIMTRADER_PUBLIC_URL).toString()
}

function configured(env: Env): boolean {
  return Boolean(env.BUDGETAPP_ISSUER && env.BUDGETAPP_CONNECT_URL && env.SIMTRADER_PUBLIC_URL)
}

function errorPage(message: string): string {
  return `<!DOCTYPE html><html><body style="font-family:system-ui;max-width:480px;margin:4rem auto;padding:2rem">
    <h2>Could not sign you in</h2>
    <p>${message}</p>
    <p><a href="/auth/budgetapp/start">Try again</a></p>
  </body></html>`
}

// --- GET /auth/budgetapp/start ---
budgetappAuth.get('/start', async (c) => {
  if (c.var.userId) return c.redirect('/dashboard')
  if (!configured(c.env)) {
    return c.html(errorPage('Sign-in is not configured on this deployment.'), 503)
  }

  const state = randomUrlSafe()
  const nonce = randomUrlSafe()
  const codeVerifier = randomUrlSafe(64)
  const next = c.req.query('next')

  const flow: FlowState = {
    nonce,
    codeVerifier,
    next: next && next.startsWith('/') ? next : null,
    startedAt: Math.floor(Date.now() / 1000),
  }
  await c.env.KV.put(`sso:flow:${state}`, JSON.stringify(flow), { expirationTtl: FLOW_TTL_SECONDS })

  const url = new URL(budgetAppConnectUrl(c.env))
  url.searchParams.set('client_id', c.env.SSO_CLIENT_ID || 'simtrader')
  url.searchParams.set('redirect_uri', redirectUri(c.env))
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('scope', 'openid profile email')
  url.searchParams.set('state', state)
  url.searchParams.set('nonce', nonce)
  url.searchParams.set('code_challenge', await s256Challenge(codeVerifier))
  url.searchParams.set('code_challenge_method', 'S256')

  return c.redirect(url.toString())
})

// --- GET /auth/budgetapp/callback ---
budgetappAuth.get('/callback', async (c) => {
  if (!configured(c.env)) return c.html(errorPage('Sign-in is not configured.'), 503)

  const providerError = c.req.query('error')
  if (providerError) {
    return c.html(errorPage(`BudgetApp declined the request (${providerError}).`), 400)
  }

  const code = c.req.query('code')
  const state = c.req.query('state')
  if (!code || !state) return c.html(errorPage('Missing code or state.'), 400)

  // One-time: reading the flow also consumes it, so a replayed callback URL finds nothing.
  const flowRaw = await c.env.KV.get(`sso:flow:${state}`)
  if (!flowRaw) return c.html(errorPage('This sign-in link has expired or was already used.'), 400)
  await c.env.KV.delete(`sso:flow:${state}`)
  const flow = JSON.parse(flowRaw) as FlowState

  // --- Exchange the code for an ID token, server to server ---
  let idToken: string
  try {
    const resp = await fetch(budgetAppTokenUrl(c.env), {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        code_verifier: flow.codeVerifier,
        client_id: c.env.SSO_CLIENT_ID || 'simtrader',
        client_secret: c.env.SIMTRADER_SSO_CLIENT_SECRET,
        redirect_uri: redirectUri(c.env),
      }),
    })
    if (!resp.ok) {
      // The body may carry a provider error code, but never echo it to the browser verbatim.
      return c.html(errorPage('BudgetApp rejected the sign-in.'), 401)
    }
    const body = await resp.json() as { id_token?: string }
    if (!body.id_token) return c.html(errorPage('BudgetApp returned no identity token.'), 502)
    idToken = body.id_token
  } catch {
    return c.html(errorPage('Could not reach BudgetApp.'), 502)
  }

  // --- Verify it ---
  const issuer = budgetAppIssuer(c.env)
  if (!issuer) return c.html(errorPage('Sign-in is not configured.'), 503)

  const result = await verifyIdToken(idToken, issuer, { nonce: flow.nonce })
  if (!result.ok) return c.html(errorPage('The identity token did not verify.'), 401)
  const claims = result.claims

  // Replay guard: a `jti` is accepted once, remembered until the token would have expired anyway.
  if (claims.jti) {
    const jtiKey = `sso:jti:${issuer.issuer}:${claims.jti}`
    if (await c.env.KV.get(jtiKey)) return c.html(errorPage('That sign-in was already used.'), 401)
    const ttl = Math.max(60, claims.exp - Math.floor(Date.now() / 1000) + 60)
    await c.env.KV.put(jtiKey, '1', { expirationTtl: ttl })
  }

  // --- Map (iss, sub) to a simtrader user. Never look anyone up by email. ---
  const sql = getDb(c.env)
  try {
    const identity = await sql<{ userId: string }[]>`
      SELECT user_id FROM external_identities
      WHERE iss = ${claims.iss} AND sub = ${claims.sub}
      LIMIT 1
    `

    let userId: string
    let role: 'user' | 'admin' = 'user'
    let status = 'active'

    if (identity[0]) {
      userId = identity[0].userId
      const rows = await sql<{ role: 'user' | 'admin'; status: string }[]>`
        SELECT role, status FROM users WHERE id = ${userId}
      `
      if (!rows[0]) return c.html(errorPage('Your simtrader account is missing.'), 500)
      role = rows[0].role
      status = rows[0].status

      await sql`
        UPDATE external_identities
        SET last_seen_at = NOW(), email = ${claims.email ?? null}, name = ${claims.name ?? null}
        WHERE iss = ${claims.iss} AND sub = ${claims.sub}
      `
      // Email is a copy for display; it is deliberately not a key and not unique.
      await sql`
        UPDATE users SET email = ${claims.email ?? ''}, last_login_at = NOW(), updated_at = NOW()
        WHERE id = ${userId}
      `
    } else {
      const created = await sql<{ id: string }[]>`
        INSERT INTO users (email, role, status, last_login_at)
        VALUES (${claims.email ?? ''}, 'user', 'active', NOW())
        RETURNING id
      `
      userId = created[0]!.id
      await sql`
        INSERT INTO external_identities (user_id, provider, iss, sub, email, name)
        VALUES (${userId}, ${BUDGETAPP_PROVIDER}, ${claims.iss}, ${claims.sub},
                ${claims.email ?? null}, ${claims.name ?? null})
      `
      await writeAudit({ sql, actorId: userId, action: 'user.provisioned', detail: { provider: BUDGETAPP_PROVIDER } })
    }

    if (status !== 'active') {
      return c.html(errorPage('Your simtrader account is not active.'), 403)
    }

    const amr = Array.isArray(claims.amr) ? claims.amr : []
    await writeAudit({
      sql,
      actorId: userId,
      action: 'user.login',
      detail: { provider: BUDGETAPP_PROVIDER, amr },
      ipAddress: c.req.header('CF-Connecting-IP') ?? null,
    })

    const token = await createSession(c.env.KV, {
      userId,
      role,
      amr,
      authTime: claims.auth_time ?? claims.iat,
    })
    setCookie(c, '__session', token, {
      httpOnly: true,
      // Secure everywhere except plain-HTTP local development, where the browser would
      // otherwise drop the cookie and the flow could never be tested end to end.
      secure: new URL(c.req.url).protocol === 'https:',
      sameSite: 'Lax', // the browser arrives here by redirect from BudgetApp
      maxAge: SESSION_TTL_SECONDS,
      path: '/',
    })

    const destination = flow.next ?? (role === 'admin' ? '/admin' : '/dashboard')
    return c.redirect(destination)
  } finally {
    await sql.end()
  }
})

export default budgetappAuth
