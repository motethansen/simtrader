// A10: Portfolio context pull for research engines (M9a)
// GET /research/portfolio-context
//
// Returns a summarised view of tracked instruments and (when W3 is deployed)
// the user's portfolio holdings. Engine keys receive an aggregate view;
// bridge JWT auth scopes to the provisioned user's portfolios.

import { Hono } from 'hono'
import type { Env, HonoVars } from '../../lib/types'
import { getDb } from '../../lib/db'
import { requireResearchAuth } from '../../middleware/research-auth'

const portfolioContext = new Hono<{ Bindings: Env; Variables: HonoVars }>()

portfolioContext.get('/', requireResearchAuth, async (c) => {
  const sql = getDb(c.env)
  try {
    // Tracked instruments are always available
    const instruments = await sql<{ symbol: string; mic: string; name: string | null }[]>`
      SELECT symbol, mic, name FROM research_instruments WHERE tracked = TRUE ORDER BY symbol
    `

    // Holdings require W3 (portfolios + holdings tables). Graceful degradation if not yet deployed.
    let holdings: Array<{ symbol: string; mic: string; units: string }> = []
    const userId = c.var.userId ?? null

    if (userId) {
      try {
        holdings = await sql<{ symbol: string; mic: string; units: string }[]>`
          SELECT h.symbol, h.mic, h.units::text
          FROM holdings h
          JOIN portfolios p ON p.id = h.portfolio_id
          WHERE p.user_id = ${userId}
          ORDER BY h.symbol
        `
      } catch {
        // W3 not yet deployed — return empty
      }
    }

    return c.json({
      tracked_instruments: instruments,
      holdings,
      total_positions: holdings.length,
    })
  } finally {
    await sql.end()
  }
})

export default portfolioContext
