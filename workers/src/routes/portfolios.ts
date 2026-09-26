// Portfolios and holdings — W3 / ST-015. The first thing a member can do here unaided.
//
// Everything is scoped to `c.var.userId` **in the SQL**, never by checking an id the browser sent:
// a portfolio id is a uuid in a URL, and `WHERE id = $1 AND user_id = $2` is the difference
// between a private portfolio and one that anybody who guesses can read. A miss is a 404 rather
// than a 403, so the URL space does not confirm which ids exist.
//
// The forms are plain HTML POSTs — no fetch, no JSON — so the pages work before any script does.
// That costs the REST-shaped `PUT`/`DELETE` the backlog sketched, because a browser form cannot
// send either; the paths say what they do instead (`/holdings/:id/update`, `/holdings/:id/delete`).

import { Hono } from 'hono'
import type { Env, HonoVars } from '../lib/types'
import { getDb, type Sql } from '../lib/db'
import { requireAuth } from '../middleware/auth'
import {
  parseHoldingsCsv,
  HOLDINGS_CSV_TEMPLATE,
  MAX_ROWS,
  type CsvError,
  type ParsedHolding,
} from '../lib/holdings-csv'
import {
  portfolioFormPage,
  portfolioPage,
  portfoliosPage,
  type HoldingRow,
  type PortfolioRow,
} from '../ui/portfolios'

const portfolios = new Hono<{ Bindings: Env; Variables: HonoVars }>()

/** A holdings file large enough to be a mistake. 500 rows of this shape is well under 64 KB. */
const MAX_UPLOAD_BYTES = 256 * 1024

const CURRENCY_RE = /^[A-Z]{3}$/
const DECIMAL_RE = /^\d{1,16}(\.\d{1,8})?$/

async function listPortfolios(sql: Sql, userId: string): Promise<PortfolioRow[]> {
  return sql<PortfolioRow[]>`
    SELECT p.id, p.name, p.base_currency, p.starting_cash, p.created_at,
           COUNT(h.id)::int AS holding_count
    FROM portfolios p
    LEFT JOIN holdings h ON h.portfolio_id = p.id
    WHERE p.user_id = ${userId}
    GROUP BY p.id
    ORDER BY p.created_at DESC
  `
}

/** The portfolio, only if it belongs to this member. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

async function ownedPortfolio(sql: Sql, userId: string, id: string): Promise<PortfolioRow | null> {
  // An id that is not a uuid would make Postgres raise rather than return nothing, and a 500 on a
  // typed URL is noise, so it is filtered here first.
  if (!UUID_RE.test(id)) return null
  const rows = await sql<PortfolioRow[]>`
    SELECT id, name, base_currency, starting_cash, created_at
    FROM portfolios WHERE id = ${id} AND user_id = ${userId}
  `
  return rows[0] ?? null
}

async function holdingsOf(sql: Sql, portfolioId: string): Promise<HoldingRow[]> {
  return sql<HoldingRow[]>`
    SELECT id, symbol, mic, units, avg_cost, currency
    FROM holdings WHERE portfolio_id = ${portfolioId}
    ORDER BY symbol, mic
  `
}

/** Upsert a batch, so re-uploading a file corrects a portfolio instead of duplicating it. */
async function upsertHoldings(sql: Sql, portfolioId: string, rows: ParsedHolding[]): Promise<void> {
  await sql.begin(async (tx) => {
    for (const h of rows) {
      await tx`
        INSERT INTO holdings (portfolio_id, symbol, mic, units, avg_cost, currency)
        VALUES (${portfolioId}, ${h.symbol}, ${h.mic}, ${h.units}, ${h.avgCost}, ${h.currency})
        ON CONFLICT (portfolio_id, symbol, mic) DO UPDATE
          SET units = EXCLUDED.units,
              avg_cost = EXCLUDED.avg_cost,
              currency = EXCLUDED.currency,
              updated_at = NOW()
      `
    }
  })
}

const touch = (sql: Sql, portfolioId: string) =>
  sql`UPDATE portfolios SET updated_at = NOW() WHERE id = ${portfolioId}`

// ---------------------------------------------------------------- template

// Before requireAuth on purpose: it is a blank file with a header row, and a member who lands here
// from a bookmark should get the template rather than a trip through BudgetApp.
portfolios.get('/template.csv', (c) =>
  c.body(HOLDINGS_CSV_TEMPLATE, 200, {
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': 'attachment; filename="holdings-template.csv"',
  }),
)

portfolios.use('*', requireAuth)

// ---------------------------------------------------------------- list + create

portfolios.get('/', async (c) => {
  const sql = getDb(c.env)
  try {
    return c.html(portfoliosPage({ portfolios: await listPortfolios(sql, c.var.userId) }))
  } finally {
    await sql.end()
  }
})

portfolios.get('/new', (c) => c.html(portfolioFormPage({})))

portfolios.post('/', async (c) => {
  const form = await c.req.formData()
  const name = String(form.get('name') ?? '').trim()
  const baseCurrency = String(form.get('base_currency') ?? '').trim().toUpperCase()
  const startingCash = String(form.get('starting_cash') ?? '').trim() || '0'

  const errors: string[] = []
  if (name === '') errors.push('Give the portfolio a name.')
  if (name.length > 80) errors.push('Keep the name to 80 characters or fewer.')
  if (!CURRENCY_RE.test(baseCurrency)) errors.push('Base currency is a three-letter code, e.g. USD.')
  if (!DECIMAL_RE.test(startingCash)) errors.push('Starting cash is a plain decimal, e.g. 10000.00.')
  if (errors.length > 0) {
    return c.html(portfolioFormPage({ errors, values: { name, baseCurrency, startingCash } }), 400)
  }

  const sql = getDb(c.env)
  try {
    const rows = await sql<{ id: string }[]>`
      INSERT INTO portfolios (user_id, name, base_currency, starting_cash)
      VALUES (${c.var.userId}, ${name}, ${baseCurrency}, ${startingCash})
      ON CONFLICT DO NOTHING
      RETURNING id
    `
    const id = rows[0]?.id
    // The unique index is on (user_id, lower(name)), so nothing coming back means that name is
    // taken. Reported as the member's own duplicate rather than as a database error.
    if (!id) {
      return c.html(
        portfolioFormPage({
          errors: [`You already have a portfolio called "${name}".`],
          values: { name, baseCurrency, startingCash },
        }),
        409,
      )
    }
    return c.redirect(`/portfolios/${id}`)
  } finally {
    await sql.end()
  }
})

// ---------------------------------------------------------------- one portfolio

portfolios.get('/:id', async (c) => {
  const sql = getDb(c.env)
  try {
    const portfolio = await ownedPortfolio(sql, c.var.userId, c.req.param('id'))
    if (!portfolio) return c.text('Not found', 404)
    return c.html(
      portfolioPage({
        portfolio,
        holdings: await holdingsOf(sql, portfolio.id),
        notice: c.req.query('added') ? `Imported ${c.req.query('added')} holdings.` : null,
      }),
    )
  } finally {
    await sql.end()
  }
})

portfolios.post('/:id/delete', async (c) => {
  const sql = getDb(c.env)
  try {
    const portfolio = await ownedPortfolio(sql, c.var.userId, c.req.param('id'))
    if (!portfolio) return c.text('Not found', 404)
    // Holdings go with it through ON DELETE CASCADE.
    await sql`DELETE FROM portfolios WHERE id = ${portfolio.id} AND user_id = ${c.var.userId}`
    return c.redirect('/portfolios')
  } finally {
    await sql.end()
  }
})

// ---------------------------------------------------------------- holdings

portfolios.post('/:id/holdings', async (c) => {
  const form = await c.req.formData()
  const sql = getDb(c.env)
  try {
    const portfolio = await ownedPortfolio(sql, c.var.userId, c.req.param('id'))
    if (!portfolio) return c.text('Not found', 404)

    // One row through the same parser as an upload, so a typed holding and an imported one cannot
    // disagree about what is valid.
    const line = [
      'symbol,mic,units,avg_cost,currency',
      [
        String(form.get('symbol') ?? ''),
        String(form.get('mic') ?? ''),
        String(form.get('units') ?? ''),
        String(form.get('avg_cost') ?? ''),
        String(form.get('currency') ?? portfolio.baseCurrency),
      ]
        .map((v) => `"${v.trim().replace(/"/g, '""')}"`)
        .join(','),
    ].join('\n')

    const { holdings, errors } = parseHoldingsCsv(line)
    if (errors.length > 0 || holdings.length !== 1) {
      return c.html(
        portfolioPage({
          portfolio,
          holdings: await holdingsOf(sql, portfolio.id),
          // The line number belongs to the CSV this built, not to anything the member typed.
          errors: errors.map((e) => e.message),
        }),
        400,
      )
    }

    await upsertHoldings(sql, portfolio.id, holdings)
    await touch(sql, portfolio.id)
    return c.redirect(`/portfolios/${portfolio.id}`)
  } finally {
    await sql.end()
  }
})

portfolios.post('/:id/holdings/upload', async (c) => {
  const sql = getDb(c.env)
  try {
    const portfolio = await ownedPortfolio(sql, c.var.userId, c.req.param('id'))
    if (!portfolio) return c.text('Not found', 404)

    const render = (errors: string[], csvErrors: CsvError[] = [], status: 400 | 413 = 400) =>
      c.html(
        portfolioPage({ portfolio, holdings: [], errors, csvErrors }),
        status,
      )

    const form = await c.req.formData()
    // `FormData.get` is typed `string | File`, and a union with a primitive cannot be
    // instanceof-checked, so the narrowing is done by hand.
    const upload = form.get('file')
    const file = upload === null || typeof upload === 'string' ? null : (upload as File)
    if (!file || file.size === 0) {
      return render(['Choose a CSV file to upload.'])
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      return render([
        `That file is ${Math.round(file.size / 1024)} KB. The limit is ${MAX_UPLOAD_BYTES / 1024} KB — ${MAX_ROWS} holdings fit well inside it.`,
      ], [], 413)
    }

    const { holdings, errors } = parseHoldingsCsv(await file.text())
    if (errors.length > 0) {
      // Nothing is stored when anything is wrong: a half-imported portfolio looks complete and is
      // not, which is worse than a rejected file.
      const existing = await holdingsOf(sql, portfolio.id)
      return c.html(
        portfolioPage({
          portfolio,
          holdings: existing,
          errors: [`Nothing was imported. ${errors.length} problem${errors.length > 1 ? 's' : ''} in the file:`],
          csvErrors: errors,
        }),
        400,
      )
    }

    await upsertHoldings(sql, portfolio.id, holdings)
    await touch(sql, portfolio.id)
    return c.redirect(`/portfolios/${portfolio.id}?added=${holdings.length}`)
  } finally {
    await sql.end()
  }
})

portfolios.post('/:id/holdings/:hid/update', async (c) => {
  const form = await c.req.formData()
  const units = String(form.get('units') ?? '').trim()
  const avgCost = String(form.get('avg_cost') ?? '').trim()

  const sql = getDb(c.env)
  try {
    const portfolio = await ownedPortfolio(sql, c.var.userId, c.req.param('id'))
    if (!portfolio) return c.text('Not found', 404)

    const holdingId = c.req.param('hid')
    if (!UUID_RE.test(holdingId)) return c.text('Not found', 404)

    const bad: string[] = []
    if (!DECIMAL_RE.test(units) || /^0+(\.0+)?$/.test(units)) {
      bad.push(`Units must be a positive decimal — "${units}" is not.`)
    }
    if (!DECIMAL_RE.test(avgCost)) {
      bad.push(`Average cost must be a decimal — "${avgCost}" is not.`)
    }
    if (bad.length > 0) {
      return c.html(
        portfolioPage({ portfolio, holdings: await holdingsOf(sql, portfolio.id), errors: bad }),
        400,
      )
    }

    // The holding is reached through the portfolio, so another member's holding id matches nothing.
    await sql`
      UPDATE holdings SET units = ${units}, avg_cost = ${avgCost}, updated_at = NOW()
      WHERE id = ${holdingId} AND portfolio_id = ${portfolio.id}
    `
    await touch(sql, portfolio.id)
    return c.redirect(`/portfolios/${portfolio.id}`)
  } finally {
    await sql.end()
  }
})

portfolios.post('/:id/holdings/:hid/delete', async (c) => {
  const sql = getDb(c.env)
  try {
    const portfolio = await ownedPortfolio(sql, c.var.userId, c.req.param('id'))
    if (!portfolio) return c.text('Not found', 404)
    const holdingId = c.req.param('hid')
    if (!UUID_RE.test(holdingId)) return c.text('Not found', 404)
    await sql`
      DELETE FROM holdings WHERE id = ${holdingId} AND portfolio_id = ${portfolio.id}
    `
    await touch(sql, portfolio.id)
    return c.redirect(`/portfolios/${portfolio.id}`)
  } finally {
    await sql.end()
  }
})

export default portfolios
