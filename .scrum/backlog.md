# Product Backlog

Two milestone tracks run in parallel after M0:
- **M-series**: backend engine (backtester, adapters, cloud infra)
- **W-series**: web product (user-facing features, auth, dashboard, simulation UI)

The W-series is the primary product direction. M-series milestones are prerequisites where noted.

---

## M0 — Skeleton ✅ DONE

- [x] Repo structure + domain model (Order, Fill, Position, Instrument, Quote, Bar, Signal)
- [x] SimBroker, BacktestEngine, RiskEngine, OMS, PortfolioTracker
- [x] SmaCrossStrategy example, SyntheticProvider
- [x] CLI skeleton, Makefile, docker-compose, pyproject.toml
- [x] ARCHITECTURE.md

---

## W1 — Web foundation + Admin interface 🔲

**Acceptance**: A user can sign up, log in, and reach their dashboard. An admin can log in to `/admin`, see all users, manage their accounts, and read the audit log.
**Prerequisites**: M0 ✅, Cloudflare Workers project initialised.
**Sprint**: sprint-02.md (see for full task breakdown)

### Auth + multi-user
- [ ] Cloudflare Workers project: TypeScript, Wrangler, staging + production environments
- [ ] DB migration 0001: `users` table — `id`, `email`, `password_hash`, `role` (user/admin), `status` (active/suspended), `email_verified`, `created_at`, `last_login_at`
- [ ] DB migration 0003: `audit_log` table — `actor_id`, `target_user_id`, `action`, `detail` (JSONB), `ip_address`, `ts` — append-only
- [ ] Sessions in Workers KV (7-day TTL for users, 24h for admins)
- [ ] `POST /auth/signup`, `POST /auth/login`, `POST /auth/logout`, `GET /me`
- [ ] Auth middleware + role guard (`requireRole('admin')`)
- [ ] Rate limiting: 5 failed logins per IP per 15 min
- [ ] `httpOnly; Secure; SameSite=Strict` session cookie
- [ ] User dashboard (empty state — portfolios + simulations come in W3/W6)

### Admin interface
- [ ] `/admin` — dashboard: KPI cards (total users, active tokens, active today, suspended), recent audit log
- [ ] `/admin/users` — paginated user list, search by email, filter by role/status, sort by created/last login
- [ ] `/admin/users/:id` — user detail: profile, token status, portfolios, audit trail for this user
- [ ] `PATCH /admin/users/:id/suspend` + `/unsuspend` — invalidates active sessions immediately
- [ ] `PATCH /admin/users/:id/role` — promote/demote (cannot demote yourself)
- [ ] `POST /admin/users/:id/token/expire` — force-expire Saxo token
- [ ] `DELETE /admin/users/:id` — soft-delete (anonymise email); hard-delete requires `?confirm=true`
- [ ] `/admin/audit` — paginated audit log viewer, filter by action/actor/target/date, CSV export
- [ ] `/admin/system` — DB stats, active token count, session count, version/deploy timestamp
- [ ] Confirmation modal before all destructive actions
- [ ] Every admin action writes to `audit_log` — enforced in code, not by convention
- [ ] `make seed-admin` — creates first admin user from env vars (dev/staging only)
- [ ] CI: Wrangler deploy on merge to `main`

---

## W2 — Saxo token vault 🔲

**Acceptance**: User submits a 24h Saxo dev token; it is stored encrypted; a Saxo API call can be proxied server-side; the token is auto-deleted on expiry.

**Prerequisites**: W1, M4 (Postgres + DO Functions).

### Token storage
- [ ] Postgres table: `saxo_tokens` — `user_id`, `ciphertext` (AES-256-GCM), `iv`, `expires_at`, `created_at`
- [ ] Master encryption key: DO Function env var (never in DB), separate key per environment
- [ ] `POST /saxo-token` endpoint (Worker): receives token, encrypts in DO Function, stores ciphertext
- [ ] Token is never returned to the browser after submission — one-way
- [ ] Alembic migration for `saxo_tokens`

### Expiry cleanup
- [ ] DO Functions cron (every 15 min): `DELETE FROM saxo_tokens WHERE expires_at < NOW()`
- [ ] Worker middleware: if token is expired or absent, return `402 Token required` prompting re-submission
- [ ] UI: token status indicator — "Active (expires in Xh)", "Expired — re-enter token"

### Saxo proxy
- [ ] DO Function `saxo-proxy`: decrypts token, forwards request to Saxo OpenAPI, returns response
- [ ] Workers route `POST /saxo/*` → invokes `saxo-proxy` function
- [ ] Instrument lookup: `GET /saxo/ref/v2/instruments?Keywords=AAPL` proxied through
- [ ] Account info: `GET /saxo/port/v1/accounts` proxied through
- [ ] Never log the raw token; log only `user_id` + endpoint + status code

---

## W3 — Portfolio input 🔲

**Acceptance**: User can upload a CSV of their current holdings or enter them manually, see them saved, and edit them.

**Prerequisites**: W1.

- [x] Postgres tables:
  - `portfolios` — `id`, `user_id`, `name`, `created_at`, `starting_cash`, `base_currency`
  - `holdings` — `id`, `portfolio_id`, `symbol`, `mic`, `units`, `avg_cost`, `currency`
- [x] Alembic migrations — `0013_portfolios`, both tables cascading from `users` so ST-f erasure reaches them
- [x] `POST /portfolios` — create portfolio with name + starting_cash
- [x] `POST /portfolios/:id/holdings/upload` — accepts CSV: `symbol,mic,units,avg_cost,currency`
- [x] `POST /portfolios/:id/holdings` — manual single-holding entry
- [x] `GET /portfolios/:id` — portfolio with its holdings (not `/holdings` on its own: there is no
      caller for a bare list, and the page needs the portfolio anyway)
- [x] `POST /portfolios/:id/holdings/:hid/update` — edit units/avg_cost. **Not `PUT`**: these are
      plain HTML forms and a browser form can only GET or POST
- [x] `POST /portfolios/:id/holdings/:hid/delete` — same reason
- [x] UI: upload form + editable holdings table
- [x] CSV template download: `GET /portfolios/template.csv`
- [x] Input validation: symbol format, positive units/cost, recognised currency codes —
      `workers/src/lib/holdings-csv.ts`, 23 tests, and the same rules again as DB check constraints

---

## W4 — Live portfolio view 🔲

**Acceptance**: User sees their portfolio's current market value and a trend chart that matches what they'd see in their Saxo account given the same holdings.

**Prerequisites**: W2, W3.

- [ ] DO Function `portfolio-snapshot`: for each holding, fetch last price via Saxo proxy → compute market value, unrealised PnL
- [ ] Postgres table: `portfolio_snapshots` — `portfolio_id`, `ts`, `total_value`, `cash`, `holdings_json` (JSONB)
- [ ] Snapshot on demand (user refresh) + scheduled every 15 min while token is active
- [ ] `GET /portfolios/:id/snapshot` — returns latest snapshot
- [ ] `GET /portfolios/:id/history?from=&to=` — returns snapshot history for chart
- [ ] UI: portfolio summary card (total value, day change %, unrealised PnL per holding)
- [ ] UI: trend chart — equity curve from snapshot history (lightweight chart or Chart.js)
- [ ] Currency conversion: FX rates fetched from Saxo `GET /saxo/ref/v1/fxrates` for multi-currency holdings
- [ ] "Last updated: Xm ago" indicator; manual refresh button
- [ ] Handle missing prices gracefully (delisted / outside trading hours)

---

## W5 — Simulation v1: portfolio rebalancing 🔲

**Acceptance**: User clicks "Run simulation" and sees a ranked list of suggested buy/sell actions to rebalance their portfolio, with projected impact on total value and exposure.

**Prerequisites**: W3, M1 (Planner + BacktestEngine).

### Rebalancing engine
- [ ] DO Function `simulate-rebalance`: takes portfolio holdings + current prices → runs Planner → returns suggested orders
- [ ] Rebalancing strategies available:
  - Equal weight (sell over-weight, buy under-weight)
  - Momentum tilt (increase weight toward top performers over trailing window)
  - Minimum variance (reduce correlation / volatility, keep total exposure)
- [ ] `POST /portfolios/:id/simulate` — `{ strategy, params, starting_cash }` → returns simulation result
- [ ] Simulation result: `{ orders: [{symbol, action, units, est_price, est_notional}], projected_value, vs_current }` 

### UI
- [ ] Strategy selector dropdown + param sliders (e.g. trailing window for momentum)
- [ ] Results table: suggested actions ranked by impact, colour-coded buy/sell
- [ ] Side-by-side chart: current allocation vs projected allocation (donut or bar)
- [ ] "What if I do nothing" vs "What if I follow these suggestions" equity projection
- [ ] Export as PDF / CSV

---

## W6 — Historical simulation 🔲

**Acceptance**: User sets a start date, defines a set of buy/sell actions (or picks a strategy), and the platform replays historical prices to show how the portfolio would have performed.

**Prerequisites**: W4, M1 (CSV provider + real bars).

- [ ] DO Function `simulate-historical`: takes holdings + actions + date range → runs BacktestEngine with CsvProvider → returns equity curve + trades
- [ ] `POST /simulations` — `{ portfolio_id, start_date, end_date, actions: [{symbol, side, units, date}], strategy? }` → returns job id
- [ ] Simulation job table: `simulation_runs` — `id`, `user_id`, `portfolio_id`, `params_json`, `status`, `result_url`
- [ ] Results stored as JSON blob in R2 (linked from `result_url`)
- [ ] `GET /simulations/:id` — poll for status + result when ready
- [ ] UI: timeline scrubber to set start date, trade action editor (symbol + date + side + units)
- [ ] UI: results — equity curve chart, trade markers on timeline, final vs starting value, Sharpe, max drawdown
- [ ] Compare mode: run two scenarios side by side (e.g. "do nothing" vs "buy NVDA in Jan 2024")
- [ ] Share link: `GET /simulations/:id/share` — public read-only result page

---

## M1 — Backtester (engine) 🔲

**Needed by**: W5, W6
**Status**: See sprint-01.md

- [ ] CsvProvider full implementation
- [ ] `make fetch-data` — 1y daily bars for 10-symbol universe
- [ ] EqualWeightRebalStrategy
- [ ] Planner (fraction-of-equity sizing, replaces hardcoded qty=10)
- [ ] Extend BacktestResult: Sharpe, max drawdown, win rate, avg hold days
- [ ] CLI `--report` flag
- [ ] Tests for all new components

---

## M2 — Saxo SIM adapter 🔲

**Needed by**: W4 (real Saxo price fetching), W5 (live paper orders in simulation)

- [ ] `SaxoAdapter` — OAuth2 token flow, Uic mapping, order placement
- [ ] `stream_fills`, `stream_quotes` normalised to core types
- [ ] Replay test fixture
- [ ] `configs/paper.saxo.example.yaml`

---

## M3 — IBKR paper adapter 🔲

- [ ] `IBKRAdapter` via `ib_insync`
- [ ] Cross-broker reconciliation test
- [ ] `configs/paper.ibkr.example.yaml`

---

## M4 — Cloud foundation 🔲

**Needed by**: W2 (token vault), W4 (DO Functions snapshots)

- [ ] DO droplet provisioned, systemd units
- [ ] Dockerfile + CI build + push to DO Container Registry
- [ ] Managed Postgres wired, Alembic migrations
- [ ] PgBouncer config (cloud tiers + direct OMS connection)
- [ ] Postgres roles: `tp_worker`, `tp_core`
- [ ] Secrets via systemd `EnvironmentFile=`

---

## M5 — Edge tier (Cloudflare Workers) 🔲

**Needed by**: W1 (auth), W2 (token endpoint)
Note: W1 can start with a minimal Workers setup before full M5 infra is in place.

- [ ] Workers auth: session tokens in KV
- [ ] REST API: orders, positions, LISTEN/NOTIFY command channel
- [ ] Durable Object for live updates
- [ ] Wrangler preview deploys per branch

---

## M6 — DO Functions tier 🔲

**Needed by**: W2 (token vault), W4 (snapshots), W5/W6 (simulation functions)

- [ ] Functions namespace per environment
- [ ] `saxo-proxy`, `portfolio-snapshot`, `simulate-rebalance`, `simulate-historical` functions
- [ ] Triggered by Workers HTTP or DO cron
- [ ] 15-min cap guard; long backtests go to droplet queue

---

## M7 — Risk + OMS hardening 🔲

- [ ] Full risk gates, kill-switch, OMS replay
- [ ] OpenTelemetry + Prometheus + Grafana

---

## M8 — Execution Agent 🔲

- [ ] TWAP/POV slicer, plan→orders FSM
- [ ] 2-week paper runbook

---

## M9 — Research Agent 🔲

- [ ] Signal stack, Claude API evaluator, strategy proposal output

---

## M10 — Optional live trading 🔲

- [ ] Separate-everything live deploy, hard capital cap

---

## Icebox

- Streaming quotes (Saxo SSE) instead of polling — upgrade from W4
- Mobile app / PWA
- Options/futures support
- Multi-broker comparison in same simulation
- Tax report export (FY-aware, multi-currency)
- Vectorbt sweep integration for parameter optimisation
- Social / share-a-simulation feed
