# Sprint 01 — M1 Backtester

**Sprint goal**: Deliver a working historical backtester against real market data with two concrete strategies, so the first non-synthetic performance numbers exist before any cloud work starts.

**Milestone**: M1
**Status**: Planning
**Period**: TBD (target ~2 weeks)

---

## Deliverables

### 1. CSV market data — real bars
- [ ] Decide universe: ~10 ETFs spanning US / EU / APAC (e.g. SPY, QQQ, EWA, VGK, EWJ, EWS, EWT, EWM, GLD, TLT)
- [ ] Source 1 year of daily OHLCV per symbol (Stooq or Yahoo via `yfinance`)
- [ ] Store as `data/historical/<SYMBOL>_<MIC>_1d.csv` with columns `date,open,high,low,close,volume`
- [ ] Wire `CsvProvider` to read these files and return `list[Bar]`
- [ ] Add a `make fetch-data` target that downloads fresh data

### 2. CsvProvider implementation
- [ ] `CsvProvider(data_dir: Path)` — already scaffolded at `marketdata/csv_provider.py`, needs real implementation
- [ ] Validates column schema on load, raises clear error on bad data
- [ ] Returns bars in ascending timestamp order
- [ ] Unit test: round-trip write/read, verify bar count and OHLC types

### 3. EqualWeightRebalStrategy
- [ ] New strategy at `strategies/examples/equal_weight.py`
- [ ] Rebalances to equal weight across universe monthly (configurable cadence)
- [ ] Respects existing positions to minimise unnecessary trades
- [ ] Unit test against SyntheticProvider

### 4. Planner (signal → order sizing)
- [ ] Replace the hardcoded `qty=10` in `BacktestEngine` with a `Planner` class
- [ ] `Planner.plan(signals, portfolio, cash) -> list[Order]` — sizes to a fraction of equity
- [ ] Default: 10% equity per position, configurable
- [ ] Unit test with known equity/signal inputs

### 5. Backtest result reporting
- [ ] Extend `BacktestResult` with: `sharpe`, `max_drawdown`, `win_rate`, `avg_hold_days`
- [ ] Add `tradingplatform backtest --config configs/backtest.example.yaml --report` that prints a table
- [ ] CSV export of equity curve to `outputs/`

### 6. Backtest config wired to real data
- [ ] Update `configs/backtest.example.yaml` with the real universe + date range
- [ ] `tradingplatform backtest --demo` still works (uses `SyntheticProvider` — no data files required)
- [ ] `tradingplatform backtest --config configs/backtest.example.yaml` uses CsvProvider

---

## Definition of done

- All tasks checked off
- `pytest` passes (all existing tests green, new tests written for each deliverable)
- `tradingplatform backtest --config configs/backtest.example.yaml` runs end-to-end on real data and prints a Sharpe + drawdown summary
- No hardcoded `qty=10` left in production code paths
- `make fetch-data` downloads the universe from scratch on a clean machine
