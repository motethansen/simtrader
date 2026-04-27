# Progress Tracker

Last updated: 2026-04-27

---

## Product direction (updated 2026-04-27)

Building a **web-based trading simulation platform** where users sign up, submit their Saxo 24h API token (stored AES-256-GCM encrypted), upload their portfolio, and run simulations that mirror their live Saxo account. Later: historical replay simulations with hypothetical trade actions.

Two milestone tracks:
- **W-series** (web product): user-facing features, priority path
- **M-series** (engine + infra): prerequisites for W-series features

---

## Overall milestone status

| Milestone | Track | Status | Notes |
| --- | --- | --- | --- |
| M0 — Skeleton | Engine | ✅ Complete | 13/13 tests passing |
| W1 — Web foundation + Admin | Web | 🔲 Not started | Sprint 02 |
| W2 — Saxo token vault | Web | 🔲 Not started | Sprint 02, needs M4 |
| W3 — Portfolio input | Web | 🔲 Not started | Sprint 03 |
| W4 — Live portfolio view | Web | 🔲 Not started | Sprint 03, needs W2 |
| W5 — Simulation v1 (rebalancing) | Web | 🔲 Not started | Sprint 04, needs M1 |
| W6 — Historical simulation | Web | 🔲 Not started | Sprint 05, needs M1 |
| M1 — Backtester engine | Engine | 🔲 Not started | Sprint 01, needed by W5/W6 |
| M2 — Saxo SIM adapter | Engine | 🔲 Not started | Needed by W4 (live prices) |
| M3 — IBKR paper adapter | Engine | 🔲 Not started | Awaiting M2 |
| M4 — Cloud foundation | Infra | 🔲 Not started | Needed by W2 |
| M5 — Edge tier (Workers) | Infra | 🔲 Not started | Part of W1 |
| M6 — DO Functions tier | Infra | 🔲 Not started | Part of W2 |
| M7 — Risk + OMS hardening | Engine | 🔲 Not started | Awaiting M5 |
| M8 — Execution Agent | Engine | 🔲 Not started | Awaiting M7 |
| M9 — Research Agent | Engine | 🔲 Not started | Awaiting M8 |
| M10 — Optional live trading | Engine | 🔲 Not started | Awaiting M9 |
| M10 — Optional live | 🔲 Not started | Awaiting M9 |

---

## M0 — What's implemented

### Core domain (`src/tradingplatform/core/`)
- `Order` — full lifecycle states, mode tag, price validators, `remaining_qty`, `is_terminal`
- `Fill` — execution record with fees
- `Position` — signed qty, avg cost, realised + unrealised PnL, `apply(fill)` method
- `Quote` / `Bar` — UTC-timestamped market data
- `Instrument` — ISIN-or-symbol + MIC + currency + asset class; `key` property
- `Signal` — score-based (-ve/+ve), horizon, metadata
- `Account` — multi-currency cash, equity, buying power

### Brokers (`src/tradingplatform/brokers/`)
- `BrokerSession` — (broker_id, mode, account_id) tuple; travels with every order
- `Broker` Protocol — defines the 7-method interface all adapters implement
- `SimBroker` — full in-process mock-fill engine
  - Market orders with configurable slippage bps
  - Limit orders (intrabar approximation)
  - Latency model (N-bar delay)
  - Partial fill model (max_qty_per_bar)
  - Cash and position bookkeeping
- `SaxoAdapter` — scaffolded (connect/disconnect/place_order stubs)
- `IBKRAdapter` — scaffolded (ib_insync import guarded)

### Simulation (`src/tradingplatform/simulation/`)
- `BacktestEngine` — event-driven, interleaves multi-instrument bars, runs through OMS
- `BacktestResult` — equity curve, n_orders, n_fills, final_equity, total_return
- Known gap: Planner is a hardcoded `qty=10` placeholder — M1 replaces this

### Market data (`src/tradingplatform/marketdata/`)
- `SyntheticProvider` — seeded GBM, configurable mu/sigma/freq; used by tests + demo
- `CsvProvider` — scaffolded, reads `date,open,high,low,close,volume` CSVs; implementation minimal
- `DataProvider` Protocol

### OMS (`src/tradingplatform/oms/`)
- `OMS` — wraps broker, tracks open orders, calls `on_fill` to update state
- Submits through `RiskEngine` before sending to broker

### Risk (`src/tradingplatform/risk/`)
- `RiskEngine.check()` chain:
  - Mode mismatch guard (order.mode ≠ session.mode → reject)
  - Max qty per symbol
  - Max notional per order (limit orders only)
  - Order rate cap (max N per minute, sliding window)
  - Daily loss kill-switch

### Portfolio (`src/tradingplatform/portfolio/`)
- `PortfolioTracker` — applies fills, marks to market, tracks equity curve
- `EquitySnapshot` — ts + equity value

### Strategies (`src/tradingplatform/strategies/`)
- `Strategy` Protocol — `on_bar`, `on_fill`, `id`
- `Context` — shared mutable state across strategy calls
- `SmaCrossStrategy` — configurable fast/slow EMA windows, emits +1/-1 signals

### Agents (`src/tradingplatform/agents/`)
- `EvaluatorAgent` stub
- `ExecutorAgent` stub

### Persistence (`src/tradingplatform/persistence/`)
- Module created, implementation deferred to M4

### Config (`src/tradingplatform/config/`)
- `Settings` — pydantic-settings, `TP_*` env vars, `mode`, `db_url`, broker credentials

### CLI (`src/tradingplatform/cli/`)
- `tradingplatform backtest --demo` — runs SyntheticProvider + SmaCross + prints result
- `tradingplatform doctor` — prints config and environment check

---

## Test suite status (as of M0)

Tests require the package installed: `pip install -e ".[dev]"` then `pytest`.

| Test file | Tests | Coverage |
| --- | --- | --- |
| `test_orders.py` | 3 | Order creation, validation |
| `test_position_pnl.py` | 4 | Position PnL math, multi-fill averaging |
| `test_risk.py` | 2 | Mode guard, qty limit |
| `test_sim_broker.py` | 3 | Market fill, limit fill, mode guard |
| `test_backtest_demo.py` | 1 | End-to-end backtest smoke test |
| **Total** | **13** | |

---

## Sprint log

### Sprint 01 — M1 Backtester (planned)
- Planned: see `.scrum/sprint-01.md`
- Started: —
- Completed: —

---

## Known issues / tech debt

| Item | Priority | Notes |
| --- | --- | --- |
| `asyncio.get_event_loop().run_until_complete()` in `backtest.py:107` | Low | Deprecated in 3.12+; replace with `asyncio.run()` at top-level entry points when refactoring |
| `Planner` is hardcoded `qty=10` in `BacktestEngine` | High | M1 task — replace with fraction-of-equity sizing |
| `SimBroker` doesn't model STOP/STOP_LIMIT orders | Medium | Add in M7 hardening |
| No `max_notional_per_order` check for market orders | Medium | Currently only fires for limit orders (needs last price context) |
| `CsvProvider` implementation is minimal | High | M1 task |
| Saxo / IBKR adapters are stubs | — | M2/M3 tasks |

---

## Open architectural questions

See ARCHITECTURE.md §16 for full list. Summary:
1. **Data budget**: free sources OK for daily bars; APAC intraday needs paid feed (EODHD ~$20/mo)
2. **AU/ASEAN coverage**: verify per-symbol availability on Saxo/IBKR before committing universe
3. **LLM for Research Agent**: Claude API via Anthropic SDK (Phase 3)
4. **App Platform vs raw droplet**: try App Platform first (M4)
5. **PgBouncer placement**: two PgBouncers — one for cloud tiers (transaction mode), one direct on droplet for OMS LISTEN
6. **Compliance**: review before sharing outputs externally or taking paying users
