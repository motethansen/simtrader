// Research router — mounts all research sub-routes (M9a)
// Mounted at /research in workers/src/index.ts

import { Hono } from 'hono'
import type { Env, HonoVars } from '../../lib/types'
import { requireAdmin } from '../../middleware/auth'
import keysRouter from './keys'
import signalsRouter from './signals'
import evaluationsRouter from './evaluations'
import instrumentsRouter from './instruments'
import portfolioContextRouter from './portfolio-context'

const research = new Hono<{ Bindings: Env; Variables: HonoVars }>()

// A2: Health check — no auth required
research.get('/health', (c) => c.json({ ok: true, ts: new Date().toISOString() }))

// A1: Engine API key management — admin session required
research.use('/engine-keys/*', requireAdmin)
research.route('/engine-keys', keysRouter)

// A3: Instruments
research.route('/instruments', instrumentsRouter)

// A4-A7: Signals
research.route('/signals', signalsRouter)

// A8-A9: Evaluations
research.route('/evaluations', evaluationsRouter)

// A10: Portfolio context
research.route('/portfolio-context', portfolioContextRouter)

export default research
