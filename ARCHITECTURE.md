# Trading Platform — Architecture

A broker-agnostic platform for **paper trading**, **backtesting**, and (later) **AI-driven execution and research** across US, European, and Australia/ASEAN equities and ETFs. Connects to **Saxo OpenAPI** and **Interactive Brokers** (IB Gateway / Client Portal Gateway).

Deployed as a **hybrid cloud topology**: a tiny always-on host for broker sessions and the trading core, with Cloudflare Workers handling the edge/API and DigitalOcean Functions handling request-shaped Python work. State of record is a managed Postgres behind PgBouncer.

---

## 1. Goals & Non-Goals

### Phase 1 — "Simulate"
Connect to Saxo SIM and IBKR paper accounts, place and track simulated orders end-to-end. Run **historical backtests** locally against the same strategy code (no broker dependency). Run **internal mock-fill simulations** for unit tests and stress runs (configurable slippage, latency, partial fills).

### Phase 2 — "Execute"
An **Execution Agent** that takes signals from a strategy/portfolio target and routes orders through the broker abstraction with risk gates, scheduling, and child-order slicing. Initially constrained to a curated whitelist of stocks/ETFs and hard position/dollar limits.

### Phase 3 — "Research"
A **Research/Evaluator Agent** that scores and ranks instruments on a configurable signal stack (fundamentals, momentum, volatility, news/sentiment) and emits a **strategy proposal** (universe, weights, rebalancing rules) for human review and optional handoff to the Execution Agent.

### Non-goals
HFT and co-located low-latency are out of scope — target horizon is intraday-to-multi-day, not microseconds. We don't self-clear or route outside what Saxo/IBKR provide. Tax and accounting reports are nice-to-have but not in scope; exportable trade history is enough.

---

## 2. High-Level (Logical) Architecture

```
                ┌────────────────────────────────────────────────┐
                │                CLI / Web UI / API              │
                └───────────────┬────────────────────────────────┘
                                │
            ┌───────────────────┴────────────────────┐
            │             Application core           │
            │                                        │
            │   Strategies   ─►  Portfolio target    │
            │       │                  │             │
            │       ▼                  ▼             │
            │   Signals          Execution Agent     │
            │       │                  │             │
            │       └──────► OMS ◄─────┘             │
            │                  │                     │
            │              Risk gates                │
            │                  │                     │
            └──────────────────┼─────────────────────┘
                               │
            ┌──────────────────┴─────────────────────┐
            │           Broker abstraction           │
            │   ┌──────────┬──────────┬──────────┐   │
            │   │ Saxo     │ IBKR     │  Sim/    │   │
            │   │ adapter  │ adapter  │  Backtest│   │
            │   └────┬─────┴────┬─────┴─────┬────┘   │
            └────────┼──────────┼───────────┼────────┘
                     ▼          ▼           ▼
                 Saxo OpenAPI  IB Gateway  Local engines

       ┌─────────────────────────────────────────────────┐
       │  Market data layer (live + historical, multi-region)
       └─────────────────────────────────────────────────┘
       ┌─────────────────────────────────────────────────┐
       │  Persistence (managed Postgres + Timescale + PgBouncer)
       └─────────────────────────────────────────────────┘
       ┌─────────────────────────────────────────────────┐
       │  Observability (structured logs, metrics, traces)
       └─────────────────────────────────────────────────┘
```

The defining design principle: **everything that touches a broker goes through one interface.** The same strategy code runs against Saxo SIM, IBKR paper, the historical backtester, or the mock simulator with no changes — only the adapter and its config differ.

---

## 3. Core Domain Model

Pure-Python pydantic models; no broker types leak into the core.

| Object | Purpose |
| --- | --- |
| `Instrument` | Canonical id (`ISIN` + MIC), normalised symbol, currency, exchange, asset class. Maps to broker-specific ids via the adapter. |
| `Quote` / `Bar` | Top-of-book + OHLCV. Timestamped in UTC. |
| `Order` | Side, qty, type (mkt/lmt/stop), tif, broker hints, parent/child link. |
| `Fill` | Executed slice; price, qty, fees, venue, ts. |
| `Position` | Per-instrument net qty, avg price, realised + unrealised PnL. |
| `Account` | Cash by currency, equity, margin, buying power. |
| `Signal` | Strategy output: instrument + score + horizon + metadata. |
| `Plan` | Target portfolio (instrument → weight or qty), rebalancing constraints. |
| `RiskCheckResult` | Pass/fail + reason; produced by the Risk module. |

Multi-currency is first-class — Australia/ASEAN markets force this regardless of whether you trade them today.

---

## 4. Broker Abstraction

```python
class Broker(Protocol):
    async def connect(self) -> None: ...
    async def get_account(self) -> Account: ...
    async def get_positions(self) -> list[Position]: ...
    async def place_order(self, order: Order) -> str: ...      # returns broker order id
    async def cancel_order(self, order_id: str) -> None: ...
    async def stream_fills(self) -> AsyncIterator[Fill]: ...
    async def stream_quotes(self, symbols: list[str]) -> AsyncIterator[Quote]: ...
```

Three concrete implementations live behind it.

**`SaxoAdapter`** uses Saxo OpenAPI (REST + streaming). OAuth2 token, Saxo's `Uic` instrument ids, `OrderType`/`AssetType` mapping. We default to the SIM environment (`gateway.saxobank.com/sim/openapi/`). 24h dev tokens are fine to start; renewable refresh tokens are the right answer once the platform runs unattended on the droplet.

**`IBKRAdapter`** has two viable transports — **`ib_insync` over IB Gateway** (paper account on port 7497) is easiest, and the **Client Portal Gateway** (REST + websocket) is better for headless deployments. Both require a long-running gateway process — that's a hard constraint that drives the deployment topology in Section 10. The recommendation is to start with `ib_insync` against IB Gateway running on the droplet; switch to CP Gateway only if it becomes a pain.

**`SimBroker`** is the internal mock-fill engine. It's used by the historical backtester and by unit tests. It plugs into the same interface so strategies, OMS, and risk are exercised end-to-end with no real broker.

Adapter responsibilities are narrow: protocol translation, instrument id mapping, rate-limit/backoff, reconnection. **No business logic** — all PnL, position math, and risk rules live in the core so they're reproducible across brokers.

---

## 5. Market Data Layer

Separate from execution. Two surfaces.

**Live data** comes from broker streams (Saxo InfoPrices subscriptions, IBKR `reqMktData`). Streams are normalised to the core `Quote` type and fanned out via Postgres `LISTEN/NOTIFY` for the lightweight case, or Redis pub/sub once volume warrants it.

**Historical data** powers backtests. Initial sources: IBKR historical (free with the account, rate-limited), Stooq / Yahoo for daily bars across EU/APAC, with a clean pluggable interface for paid feeds (Polygon, EODHD, Tiingo) when needed.

Time-series go to a **TimescaleDB** hypertable in the managed Postgres (one hypertable per granularity — `bars_1m`, `bars_1d`). Reference data (instruments, exchanges, calendars) lives in regular tables.

Trading calendars matter when you span US/EU/APAC. Use `pandas_market_calendars` and store sessions per exchange.

---

## 6. Order Management & Risk

The **OMS** is a stateful service that owns the lifecycle of every order: `NEW → SENT → PARTIALLY_FILLED → FILLED | CANCELLED | REJECTED`. It persists every transition in an event log (Postgres) so the entire trading session can be replayed.

**Risk gates** sit between strategies/agents and the OMS. Every order passes through a chain — per-symbol max position (qty + notional), per-strategy max gross/net exposure, per-day loss limit (kill switch), order-rate cap (max N per minute), and most importantly the **live-vs-paper guard**: a config flag `mode: paper | live` with a hard fail if a live broker is attached in paper mode (and vice versa). This is the single most important guardrail.

Phase 2's Execution Agent doesn't get to bypass risk — it produces orders that flow through the same gates.

---

## 7. Strategies & Agents

A `Strategy` is the deterministic, testable thing:

```python
class Strategy(Protocol):
    def on_bar(self, bar: Bar, ctx: Context) -> list[Signal]: ...
    def on_fill(self, fill: Fill, ctx: Context) -> None: ...
```

Strategies emit `Signal`s. A `Planner` translates signals + current portfolio + cash into a target `Plan`. The OMS turns the delta between current and target into orders.

The two agents in the roadmap layer on top.

The **Execution Agent (Phase 2)** takes a `Plan` and decides *how* to get there: order slicing (TWAP/VWAP/POV), limit-vs-market choice, retry on partial fills, end-of-day flatten, cancel-on-disconnect. Implemented as a finite state machine with policies, not a freeform LLM. An LLM may *configure* its parameters from a brief, but the executor itself is deterministic — non-negotiable for trade safety and reproducibility.

The **Research Agent (Phase 3)** is the LLM-heavy one. Given a universe and a brief ("low-vol dividend ETFs in AU/NZ"), it pulls reference data + recent fundamentals/news, runs a configurable signal stack (momentum, mean-reversion, vol, fundamentals, sentiment), backtests the candidate strategy via the existing backtester, and emits a strategy proposal — markdown report + machine-readable `Plan` config. The Research Agent never places orders. Its output is a config file + report; promotion to live execution is a manual step until you trust it.

---

## 8. Persistence

| Store | Where it lives | Purpose |
| --- | --- | --- |
| Managed Postgres + Timescale | DigitalOcean managed cluster (existing) | Reference data, time-series bars/quotes, order/fill event log, agent runs, configs, audit log. Single source of truth. |
| PgBouncer | Existing droplet (or sidecar on the trading-core droplet) | Transaction-mode connection pooling. Crucial for the serverless tier — Workers and Functions open many short-lived connections. |
| Object store (R2 or DO Spaces) | Cloudflare R2 (preferred — free egress) | Backtest result blobs, agent reports, daily snapshots. |
| Workers KV | Cloudflare | Short-TTL cache for the API tier (latest equity, last fill ts). Not state of record. |

SQLAlchemy + Alembic for schema migrations, run from the droplet. Every order/fill/agent decision is append-only — you should always be able to answer "why did we trade X at Y on date Z?" months later.

The platform never connects directly to Postgres from a Worker or DO Function — always via PgBouncer. The droplet has its own connection pool (in-process) for the OMS and broker adapter.

---

## 9. Tech Stack

Python 3.11+ for the trading core (broker SDKs are Python-first). `asyncio` + `httpx` + `websockets` for adapters, `ib_insync` for IBKR. Pydantic v2 for config and DTOs. FastAPI for the droplet's local control endpoints. Typer for the CLI. pandas/polars/numpy for data work. A homegrown event-driven backtester so live and historical share code (vectorbt is faster for sweeps but I'd add it later).

JavaScript/TypeScript for the Cloudflare Workers tier — Workers' native runtime. The Workers tier is small (auth, API routing, dashboard); Python work lives elsewhere.

DO Functions runs Python natively and supports pandas/numpy.

Tests: pytest + hypothesis + freezegun. Containers: Docker Compose locally, a single Dockerfile for the trading core that runs as a systemd unit on the droplet (or inside DO App Platform's "worker" component).

Observability: OpenTelemetry traces, Prometheus metrics, structured logs via `structlog`. Logs ship to a free tier on Better Stack / Grafana Cloud / Loki, depending on cost preference.

---

## 10. Deployment Topology

```
                         Internet
                            │
              ┌─────────────┴──────────────┐
              │   Cloudflare Workers (JS)  │   <- edge / API tier
              │   - Auth, sessions         │
              │   - REST API (dashboard)   │
              │   - Static assets          │
              │   - Durable Objects (WS)   │
              │   - Cron triggers          │
              └─────────────┬──────────────┘
                            │
              ┌─────────────┴──────────────┐
              │  DO Functions (Python)     │   <- request-shaped Python
              │  - Report generation       │
              │  - One-off evaluator runs  │
              │  - PDF/Excel exports       │
              │  - Scheduled snapshots     │
              └─────────────┬──────────────┘
                            │
                            │  (writes commands; LISTEN/NOTIFY)
                            ▼
   ┌─────────────────────────────────────────────────┐
   │  Managed Postgres + Timescale  (state of record) │
   │  ── PgBouncer (transaction pool) ────────────    │
   └─────────────────────────────────────────────────┘
                            ▲
                            │  (long-lived poolless connection)
                            │
              ┌─────────────┴──────────────┐
              │  Trading-core droplet       │  <- always-on, persistent
              │  - IB Gateway (Python proc) │
              │  - Saxo streaming consumer  │
              │  - OMS daemon               │
              │  - Strategy runner          │
              │  - Backtest worker          │
              │  - Webhook receiver         │
              └─────────────────────────────┘
```

The mental model: **functions for things that have a request and a response; the droplet for things that have a session.** Trading sessions are sessions. UIs and reports are requests.

### Trading-core droplet

A single small DigitalOcean droplet (Basic, $6–12/mo) — or one component in DO App Platform if you'd rather not manage VMs ($5–7/mo for a basic worker, slightly nicer ops). It runs the parts that *cannot* be serverless because they hold sessions:

It hosts **IB Gateway** as a long-running process (or Client Portal Gateway in a Docker container). The **Saxo streaming consumer** maintains the SSE/WebSocket subscription, refreshes OAuth tokens, and writes normalised quotes to Postgres. The **OMS daemon** owns order lifecycle in memory, persists every transition to Postgres, and listens on Postgres `NOTIFY` for new orders to dispatch. The **strategy runner** consumes quotes (live or replayed) and emits signals. A **backtest worker** processes long-running backtest jobs from a queue.

Each of these is a Python process under systemd, started from the same wheel built from this repo. They share the PgBouncer pool. Total memory footprint at idle is low — comfortably under a 1GB droplet for Phase 1–2.

The droplet **does not expose any public port**. No HTTPS, no auth, no reverse proxy — everything inbound goes through Postgres or the queue. Egress is fine: it talks to broker APIs and to managed Postgres over their respective TLS endpoints. This dramatically reduces the attack surface.

### Cloudflare Workers tier

The HTTP front door. Runs the dashboard's REST API, user auth (sessions in Workers KV, bcrypt against Postgres), webhooks, and any user-initiated action.

When a user places an order through the API, the Worker writes a row to a `pending_commands` table on the managed DB and issues `pg_notify` on a channel the droplet's OMS is `LISTEN`-ing on. The OMS picks it up sub-second, dispatches to the broker, persists results back to Postgres. The Worker, having returned an order id, lets the user poll or subscribes a Durable Object to receive the eventual fill update.

For live updates to the browser, a **Durable Object** holds the per-user WebSocket. The droplet's OMS, when it has a new fill, makes a small authenticated HTTP call to a Cloudflare endpoint that fans out to that Durable Object. This keeps fan-out at the edge and the droplet from needing any kind of socket server.

Cron triggers on Workers handle scheduled UX work (daily digest emails, "your portfolio is down 3% today" notifications) — never anything that places trades.

Scoping rule: **no Worker ever talks to a broker.** Workers talk to Postgres (read) and to PgBouncer's command channel (write). That's it.

### DigitalOcean Functions tier

For Python jobs that don't fit a Worker (no pandas/numpy in Workers' Python) and don't justify always-on (so they shouldn't live on the droplet): generating a report PDF, running the evaluator agent on a universe, exporting an Excel of positions, materialising a one-off backtest with custom params.

These are triggered by HTTP from the Workers tier or by DO Functions cron. They read/write Postgres via PgBouncer. They write outputs to R2 and post a result row back to Postgres. A function never holds a broker session.

The 15-minute execution cap is a real constraint — any backtest that risks blowing it goes onto the droplet's backtest worker queue instead, with the function returning a job id immediately.

### Mode separation across tiers

Three deployment environments live entirely in parallel:

1. **dev/sim** — your laptop. The whole stack runs locally via `docker compose up`. No cloud at all. Mode = `backtest`.
2. **paper** — first cloud deployment. A staging droplet, a staging DB, Workers on a staging subdomain, all wired with `mode: paper` and only paper broker accounts. This is the default once you go online.
3. **live** — separate everything: separate droplet, separate DB cluster (different credentials, different connection string in PgBouncer), separate Workers route, separate Workers secrets. Switching to live is a deploy, not a config flag.

The `mode` tag travels on every order through every tier. PgBouncer points at different Postgres clusters depending on which environment — there's no shared DB between paper and live. This is paranoid and right.

---

## 11. Inter-tier Communication

The droplet runs no public-facing server. All inbound work reaches it through Postgres. This is the single most important deployment decision and worth its own section.

### Workers → trading core: Postgres LISTEN/NOTIFY

A Worker handling "place order" inserts into a `commands` table:

```sql
INSERT INTO commands (id, user_id, kind, payload, mode)
VALUES (..., 'place_order', $1::jsonb, 'paper');
SELECT pg_notify('orders_in', $1::text);  -- the new command id
```

The OMS daemon on the droplet runs `LISTEN orders_in` on a dedicated long-lived connection (not via PgBouncer — PgBouncer in transaction mode breaks LISTEN; the droplet keeps one direct connection for this). When notified, it `SELECT … FOR UPDATE SKIP LOCKED` the row, dispatches, and writes the result. Sub-second latency, no extra infrastructure, naturally durable, no public port.

If the droplet is restarting, the row sits in `commands` and gets picked up on next start — the Worker doesn't need to know the droplet is alive.

### Trading core → browser: webhook → Durable Object → WebSocket

When a fill arrives, the OMS persists it and POSTs a small JSON payload to a Cloudflare endpoint:

```
POST https://api.simtrader.app/internal/events
Authorization: Bearer <shared-secret>
{ "user_id": 123, "kind": "fill", "data": {...} }
```

The Workers route looks up the user's Durable Object and forwards. The Durable Object pushes to any subscribed WebSockets. If no one is subscribed, the event is dropped at the edge — the persistent record is in Postgres, so reconnecting clients backfill via REST.

This pattern means the droplet only needs *outbound* HTTPS. No inbound port, no certificate, no rate-limit middleware.

### DO Functions → trading core: same channel

When a user clicks "run evaluator on this universe", a Worker invokes a DO Function. The function does its Python-heavy work, writes the resulting `Plan` to Postgres, and inserts a `commands` row asking the OMS to consider/dispatch it. Same `NOTIFY` flow.

### Queues, when needed

Postgres `LISTEN/NOTIFY` is ideal until you're handling thousands of commands per minute. When that's the bottleneck, swap in **Cloudflare Queues** (consumed by a small Python process on the droplet via the HTTP pull API) or **Redis Streams** on the existing droplet. The interface to the OMS doesn't change.

---

## 12. Cost Estimate

Running cost during Phase 1–2, single user:

| Item | Provider | Monthly |
| --- | --- | --- |
| Trading-core droplet (Basic 1 vCPU / 1 GB) | DigitalOcean | $6 |
| Managed Postgres (existing) | DigitalOcean | $0 (sunk) |
| PgBouncer on existing droplet | DigitalOcean | $0 (sunk) |
| Cloudflare Workers (paid plan, recommended) | Cloudflare | $5 |
| Cloudflare Workers KV / R2 / Durable Objects | Cloudflare | $0–2 |
| DigitalOcean Functions (low usage) | DigitalOcean | $0–3 |
| Logs/metrics (free tier) | Better Stack / Grafana Cloud | $0 |
| Domain | Cloudflare | $1 |
| **Total** | | **~$12–17/mo** |

Phase 3 (research agent calling Claude API) adds variable LLM cost — budget $20–60/mo depending on universe size and how often the agent runs. Strict per-run token caps belong in the agent config from day one.

When you cross into "many concurrent users," the droplet becomes the bottleneck before anything else. The escape hatch is to break out the most expensive piece (usually the strategy runner or the backtest worker) into its own container on App Platform, and finally into a managed Kubernetes cluster. Postgres + Workers + Functions don't change.

---

## 13. Testing Strategy

**Unit tests** for every core module (`Order`, `Position`, `Risk`, sample `Strategy`). **Property tests** (Hypothesis) for the OMS state machine and PnL math. **Replay tests** record a session against Saxo SIM / IBKR paper to a fixture and replay it against the adapter, detecting regressions without hitting the broker. **Backtest determinism test** asserts that same inputs + same seed produce byte-identical outputs.

**Smoke tests** in CI run against the `SimBroker` only (no external creds). CI is GitHub Actions: runs pytest on every PR, builds a Docker image, pushes to DigitalOcean Container Registry on merge to `main`. The trading-core droplet pulls + restarts the systemd unit on a Watchtower-style trigger or a manual deploy command.

**Preview environments**: Workers preview deploys per branch (built into Wrangler), DO Functions namespaces per branch. The droplet has a single `paper` deployment — there's no need for per-PR droplets.

**Manual paper-trading runbook** — a short checklist for each adapter before any change reaches the live tier.

---

## 14. Security & Operational Safety

Two distinct config profiles — `paper` and `live` — with completely separate credentials, DB clusters, droplets, and Workers routes. Switching to `live` is a deploy, not a flag, and the deploy step requires both an explicit confirmation prompt and `--i-understand-this-is-real-money` on any tool that constructs the deploy.

Every order carries a `mode` tag from end to end and is rejected at the adapter if it doesn't match the broker session. The risk engine enforces this independently of the adapter — defense in depth.

A daily PnL kill-switch — automatic flatten + halt if breached. Implemented in the OMS, not in any of the cloud tiers; the droplet is the source of truth.

**Secrets management**:
- Cloudflare Workers — `wrangler secret put`, scoped per environment.
- DO Functions — `doctl serverless functions invoke` env vars, separate per namespace.
- Droplet — systemd `EnvironmentFile=` pointing at a file that only the service user can read; provisioned at first boot by a Cloud Init script that pulls from DO's user-data secrets.
- Broker tokens (Saxo OAuth refresh tokens, IBKR account creds) only ever live on the droplet.

**IAM**:
- Workers and Functions get a Postgres role limited to the `commands` insert + `audit_log` select. They cannot read broker tokens, cannot insert into `fills` directly, and cannot bypass the OMS.
- The trading-core role can do everything but is only used by the droplet.
- Audit log: every external call (broker request/response, agent decision) is hashed and stored. Retained ≥ 1 year.

Encrypted at rest (managed DB does this; R2 does too). TLS for everything in motion. No PII from broker accounts ever logged in plaintext.

---

## 15. Roadmap & Milestones

| Milestone | Outcome |
| --- | --- |
| **M0 — Skeleton** ✅ | Repo + ARCHITECTURE.md + runnable mock simulator + tests. |
| **M1 — Backtester** | Event-driven backtest engine + 1y of daily bars for a small universe + 2 example strategies (SMA-cross, equal-weight rebal). Local-only. |
| **M2 — Saxo SIM adapter** | End-to-end paper order through Saxo SIM, fill events into OMS, position reconciliation. Still local. |
| **M3 — IBKR paper adapter** | Same as M2 against IBKR via `ib_insync`. Cross-broker reconciliation test. Still local. |
| **M4 — Cloud foundation** | Trading-core droplet provisioned. Managed Postgres + PgBouncer wired. Migrations land. Saxo + IBKR adapters running on the droplet against managed DB. systemd units, deploy pipeline. |
| **M5 — Edge tier** | Cloudflare Workers up: minimal API (auth, "list orders", "place order via NOTIFY", "subscribe to fills"). One Durable Object for live updates. Wrangler-based deploys. |
| **M6 — DO Functions tier** | Report generation, scheduled snapshots, evaluator-agent invocation. Triggered by Workers. |
| **M7 — Risk + OMS hardening** | Full risk gates, kill-switch, replay, observability dashboards. |
| **M8 — Execution Agent** | TWAP/POV slicer, plan→orders translator, smoke-tested in paper for 2 weeks. |
| **M9 — Research Agent** | Signal stack, evaluator, strategy proposal output. Read-only. |
| **M10 — Optional live** | Live trading behind explicit deploy + flag, capped capital, single broker. |

---

## 16. Open Questions

**Data budget** — free sources cover daily bars across most regions but APAC intraday gets thin. Worth scoping a paid feed (EODHD ~$20/mo or Polygon for US-only) before M1.

**AU/ASEAN coverage via Saxo vs IBKR** — both cover ASX, SGX, HKEX. Coverage of smaller ASEAN venues (IDX, Vietnam) is uneven; verify per-symbol before committing a universe.

**LLM choice for the Research Agent** — Claude via Anthropic API is the natural fit; Phase 3 will need a tool-use harness with the broker (read-only) + market data tools. Per-run token caps in the agent config from day one.

**App Platform vs raw droplet** — DO App Platform with a "worker" component is slightly pricier ($5–7/mo basic) but gives zero-downtime deploys and abstracts the VM. Worth trying first; fall back to a raw droplet if the constraints (no native binary, smaller buildpack) bite.

**PgBouncer placement** — your existing PgBouncer is on a separate droplet. Phase 4's trading core could either share that PgBouncer or run its own (since it has a few long-lived connections of its own and needs `LISTEN`-friendly direct connections). I'd run two: PgBouncer for the cloud tiers, and a small in-process pool on the droplet for OMS/adapters. They both point at the same managed cluster.

**Compliance** — depending on your jurisdiction, even paper-driven strategy publication can have implications. Review before sharing outputs externally. If you accept paying users in Phase 2+, KYC/MiCA/AFSL exposure depends on whether the platform takes custody (it doesn't) and whether outputs are personalised advice (avoid; frame as research).
