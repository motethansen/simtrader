import postgres from 'postgres'
import type { Env } from './types'

// One client per request — Workers don't share memory between requests.
// `prepare: false` required for PgBouncer compatibility.
//
// Connection path: the Hyperdrive binding, which reaches Postgres on the droplet through a
// Cloudflare Tunnel gated by an Access service token. Hyperdrive terminates TLS to the origin
// and pools connections, so the client speaks plaintext to the binding and asks for no types.
// `DATABASE_URL` stays as the fallback for `wrangler dev` against a local Postgres.
export function getDb(env: Env) {
  if (env.HYPERDRIVE) {
    return postgres(env.HYPERDRIVE.connectionString, {
      max: 1,
      prepare: false,
      fetch_types: false,
      transform: {
        column: { from: postgres.toCamel },
      },
    })
  }
  return postgres(env.DATABASE_URL, {
    ssl: 'require',
    max: 1,
    prepare: false,
    transform: {
      column: { from: postgres.toCamel },
    },
  })
}

export type Sql = ReturnType<typeof getDb>
