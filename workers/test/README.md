# Testing BudgetApp sign-in locally

simtrader has no login of its own: every account is created by signing in through BudgetApp
(ST-008). That makes the sign-in flow awkward to test, because it needs an identity provider.
Two ways to get one.

## 1. Against the fake provider (no BudgetApp checkout needed)

`fake-idp.mjs` implements the three endpoints simtrader depends on — JWKS, `/connect` and the
token endpoint — signing with a throwaway key generated at startup. It is a test double, never
a fallback: nothing outside this directory refers to it.

```bash
cd workers
node test/fake-idp.mjs &                       # listens on :8901

# Hyperdrive needs a local Postgres. Either run one (`docker compose up -d postgres`), or
# tunnel to the shared development database — host, user and password are in the private ops
# notes, not here:
#   ssh -f -N -L 5434:127.0.0.1:5433 <db-droplet>
export CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE=\
"postgres://simtrader_app:<password>@127.0.0.1:5434/simtraderdb"

npx wrangler dev --port 8787 \
  --var BUDGETAPP_ISSUER:http://localhost:8901 \
  --var BUDGETAPP_JWKS_URL:http://localhost:8901/.well-known/jwks.json \
  --var BUDGETAPP_TOKEN_URL:http://localhost:8901/api/v1/sso/token \
  --var BUDGETAPP_CONNECT_URL:http://localhost:8901/connect \
  --var SIMTRADER_PUBLIC_URL:http://localhost:8787 \
  --var SIMTRADER_SSO_CLIENT_SECRET:dev-secret
```

Then open <http://localhost:8787/auth/budgetapp/start>. You land on `/dashboard`, signed in.

Use `localhost`, not `127.0.0.1`: the session cookie is issued for whichever host you start on,
and mixing the two silently drops it.

The fake provider takes query parameters on `/connect` so you can play the awkward cases —
`?sub=`, `?email=`, and `?amr=pwd` to sign in **without** 2FA, which is what `/admin` must refuse.

## 2. Against a real BudgetApp checkout

Run BudgetApp's `docker-compose.dev.yml` (API on :8000, web on :5173), register
`http://localhost:8787/auth/budgetapp/callback` as an **exact** redirect URI for the `simtrader`
client, then run `wrangler dev --port 8787` with no `--var` overrides: `wrangler.toml` already
points at those local ports.

## What to check by hand

| Step | Expected |
|---|---|
| Click *Launch simtrader* in BudgetApp (or open `/auth/budgetapp/start`) | Lands on `/dashboard`, signed in |
| `GET /auth/me` | The BudgetApp `sub` under `providerSub`, `provider: budgetapp` |
| Database | One `users` row and one `external_identities` row; `audit_log` has `user.provisioned` and `user.login` |
| Sign in a second time | No new user row — `(iss, sub)` matched the existing identity |
| Consent screen | Shown the first time only (real BudgetApp; the fake provider always consents) |
| Replay the callback URL | Fails with 400 — the state was consumed on first use |
| `/admin` as a non-admin | 403 |
| `/admin` as an admin who signed in with `amr=pwd` | 403, asking for 2FA |
| `/admin` as an admin who signed in with `amr=pwd,otp` | 200 |
| `POST /auth/logout`, then `/dashboard` | Redirected back to `/auth/budgetapp/start` |

Making someone an admin (they must have signed in once first — there is no password to seed):

```bash
TP_DB_URL="postgresql://simtrader_migrator:<password>@<host>:<port>/simtraderdb" \
  tradingplatform seed-admin --budgetapp-id <their BudgetApp user id>
```

## Unit tests

`npm test` runs the verifier tests (`sso-jwt.test.ts`), which mint real ES256 tokens and cover
the ways a relying party gets fooled: a missing `exp`, a foreign issuer, a wrong audience, a
mismatched nonce, `alg: none`, an algorithm the issuer is not configured for, a key that is not
in the JWKS, and a tampered payload.
