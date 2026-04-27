import postgres from 'postgres'

// One client per request — Workers don't share memory between requests.
// `prepare: false` required for PgBouncer compatibility.
export function getDb(url: string) {
  return postgres(url, {
    ssl: 'require',
    max: 1,
    prepare: false,
    transform: {
      column: { from: postgres.toCamel },
    },
  })
}

export type Sql = ReturnType<typeof getDb>
