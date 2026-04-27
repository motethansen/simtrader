# simtrader

Multi-broker simulation, backtesting, and (eventually) AI-driven execution and research — across US, European, and Australia/ASEAN equities and ETFs.

> Phase 1 (you are here): paper trading via Saxo SIM and IBKR paper accounts, plus a local backtester and an internal mock-fill simulator.
>
> Phase 2: an Execution Agent that routes orders for a curated universe with hard risk limits.
>
> Phase 3: a Research Agent that scores instruments and proposes strategies.

**Deployment topology** is hybrid cloud: a tiny always-on droplet runs broker sessions + OMS (the parts that need a *session*); Cloudflare Workers serves the API/dashboard at the edge; DigitalOcean Functions runs request-shaped Python jobs (reports, on-demand evaluator runs); managed Postgres + PgBouncer is the state of record. See [ARCHITECTURE.md](./ARCHITECTURE.md) §10–12 for the topology diagram, inter-tier communication patterns, and cost estimate (~$12–17/mo to start).

## Quick start

```bash
# 1. Install (Python 3.11+)
python -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]"

# 2. Run the tests
pytest

# 3. Run a self-contained synthetic backtest
tradingplatform backtest --demo

# 4. Inspect config
tradingplatform doctor

# 5. Bring up local infra (Postgres+Timescale, Redis, MinIO, Grafana)
docker compose up -d
```

## Project layout

```
src/tradingplatform/
├── core/          # Domain types (Order, Fill, Position, Instrument, Quote, Bar, Plan, Signal)
├── brokers/       # Adapter protocol + Saxo/IBKR stubs + in-process SimBroker
├── simulation/    # Event-driven backtest engine
├── marketdata/    # CSV + synthetic providers (live providers come in M2/M3)
├── oms/           # Order management (state, dispatch, reconciliation)
├── risk/          # Risk gates — every order passes here
├── portfolio/     # PnL, equity curve, multi-currency cash
├── strategies/    # Strategy protocol + example SMA-cross
├── agents/        # Phase 2 executor + Phase 3 evaluator stubs
├── persistence/   # Postgres-backed event log (M4)
├── config/        # pydantic-settings, env-driven
└── cli/           # `tradingplatform` Typer entrypoint
```

## Phased roadmap

| Milestone | Outcome |
| --- | --- |
| **M0 — Skeleton** ✅ | Repo + ARCHITECTURE.md + runnable mock simulator + tests. |
| **M1 — Backtester** | CSV provider + 1y of daily bars, two example strategies. Local-only. |
| **M2 — Saxo SIM**   | End-to-end paper order through Saxo SIM. Local. |
| **M3 — IBKR paper** | Same against IBKR via `ib_insync`. Local. |
| **M4 — Cloud foundation** | Trading-core droplet provisioned. Managed Postgres + PgBouncer wired. Adapters running on droplet. |
| **M5 — Edge tier**  | Cloudflare Workers: auth + minimal API. Postgres LISTEN/NOTIFY command channel. Durable Object for live updates. |
| **M6 — DO Functions tier** | Reports, scheduled snapshots, evaluator-agent invocation. |
| **M7 — Risk + OMS hardening** | Full risk gates, kill-switch, replay, observability. |
| **M8 — Executor**   | TWAP/POV slicer, plan→orders translator. |
| **M9 — Researcher** | Signal stack + LLM-driven evaluator. |
| **M10 — Optional live** | Separate-everything live deploy, capped capital. |

## Safety model

- The default mode is `paper`. Switching to `live` requires both `TP_MODE=live` *and* an explicit `--i-understand-this-is-real-money` CLI flag.
- Every order carries a `mode` tag; the broker session refuses any order whose mode doesn't match. This kills the "I forgot which environment I was in" class of mistake.
- The `RiskEngine` runs in front of every send. It enforces per-symbol size limits, per-order notional, order-rate caps, and a daily-loss kill-switch.
- The OMS persists every transition (M4). You should always be able to reconstruct *why* a trade happened.

## Where to look first

- `src/tradingplatform/core/` — start here. The domain model is the contract.
- `src/tradingplatform/brokers/sim.py` — the most complete adapter; the Saxo/IBKR ones are scaffolded against the same interface.
- `src/tradingplatform/simulation/backtest.py` — drives bars through a strategy and the same OMS path live trading will use.
- `tests/test_sim_broker.py` and `tests/test_position_pnl.py` — read these to understand the accounting rules.
