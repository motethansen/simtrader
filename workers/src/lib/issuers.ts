// Which identity providers simtrader trusts, and where their keys live.
//
// The map is keyed by the exact `iss` string. A token may say who issued it, but it can only
// ever select an entry here — it can never supply a JWKS URL, an algorithm or an audience.
// BudgetApp is the only issuer (ST-008: it is the only way in).

import type { Env } from './types'
import type { IssuerConfig } from './sso-jwt'

export const BUDGETAPP_PROVIDER = 'budgetapp'

/** Trusted issuers for this deployment, `iss` → config. Empty if none is configured. */
export function trustedIssuers(env: Env): Map<string, IssuerConfig> {
  const map = new Map<string, IssuerConfig>()
  const issuer = env.BUDGETAPP_ISSUER
  if (issuer) {
    map.set(issuer, {
      issuer,
      jwksUrl: env.BUDGETAPP_JWKS_URL || new URL('/.well-known/jwks.json', issuer).toString(),
      alg: 'ES256',
      audience: env.SSO_AUDIENCE || 'simtrader',
    })
  }
  return map
}

/** The BudgetApp issuer config, or null when the Worker has no issuer configured. */
export function budgetAppIssuer(env: Env): IssuerConfig | null {
  return env.BUDGETAPP_ISSUER ? trustedIssuers(env).get(env.BUDGETAPP_ISSUER) ?? null : null
}

/** Config for a token's `iss`, or null when that issuer is not trusted here. */
export function issuerConfigFor(env: Env, iss: string): IssuerConfig | null {
  return trustedIssuers(env).get(iss) ?? null
}

/** Where to exchange an authorization code for an ID token. */
export function budgetAppTokenUrl(env: Env): string {
  return env.BUDGETAPP_TOKEN_URL || `${env.BUDGETAPP_ISSUER}/api/v1/sso/token`
}

/** The browser-facing consent/login page that starts the flow. */
export function budgetAppConnectUrl(env: Env): string {
  return env.BUDGETAPP_CONNECT_URL
}

/** Reads `iss` out of a token without verifying it — only to pick a config to verify against. */
export function unverifiedIssuer(token: string): string | null {
  const parts = token.split('.')
  if (parts.length !== 3) return null
  try {
    const payload = JSON.parse(atob(parts[1]!.replace(/-/g, '+').replace(/_/g, '/'))) as { iss?: string }
    return typeof payload.iss === 'string' ? payload.iss : null
  } catch {
    return null
  }
}
