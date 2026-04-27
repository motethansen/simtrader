# simtrader — Claude Code Guide

## What this project is

A **web-based trading simulation platform** where users sign up, connect their Saxo account via a 24h API token, upload their portfolio, and run simulations — seeing their portfolio perform exactly as it would in their live Saxo account, then exploring rebalancing suggestions and historical "what if" scenarios.

Later: AI-driven execution and research agents across US, EU, AU/ASEAN equities and ETFs.

**Deployment**: hybrid cloud. Cloudflare Workers serves the web app + API (edge). DO Functions runs Python simulation work. A DigitalOcean droplet holds persistent broker sessions + OMS daemon. Managed Postgres + PgBouncer is the state of record. See ARCHITECTURE.md §10–12 for the topology diagram.

**Product phases**:
- W1: User sign-up/login + dashboard (Cloudflare Workers)
- W2: Saxo token vault — encrypted storage, proxy, TTL cleanup
- W3: Portfolio upload + manual entry
- W4: Live portfolio view — real prices via Saxo, trend chart
- W5: Simulation v1 — rebalancing suggestions (buy/sell)
- W6: Historical simulation — set date, define trades, replay

**Engine phases** (prerequisites for product phases):
- M1: Backtester with real market data (needed by W5/W6)
- M2: Saxo SIM adapter (needed by W4)
- M4+: Cloud infra (needed by W2)

---

## Quick dev setup

```bash
python -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]"
pytest                        # full suite
tradingplatform backtest --demo   # self-contained synthetic backtest
tradingplatform doctor            # config sanity check
docker compose up -d          # local Postgres+Timescale, Redis, MinIO, Grafana
```

Tests run in ~1s with no external services required.

---

## Project layout

```
src/tradingplatform/
├── core/          # Domain types — Order, Fill, Position, Instrument, Quote, Bar, Signal, Plan
├── brokers/       # Broker protocol + Saxo/IBKR stubs + SimBroker (in-process mock)
├── simulation/    # Event-driven backtest engine (BacktestEngine)
├── marketdata/    # CSVProvider, SyntheticProvider (live providers come in M2/M3)
├── oms/           # OMS state machine — order lifecycle, dispatch, reconciliation
├── risk/          # RiskEngine + RiskLimits — every order passes here
├── portfolio/     # PortfolioTracker — PnL, equity curve, multi-currency cash
├── strategies/    # Strategy protocol + SmaCrossStrategy example
├── agents/        # Stubs for Phase 2 executor + Phase 3 evaluator
├── persistence/   # Postgres-backed event log (implemented in M4)
├── config/        # pydantic-settings, env-driven
└── cli/           # `tradingplatform` Typer entrypoint
```

---

## Domain model (core/)

All objects are pydantic v2 `BaseModel`. No broker types leak into the core.

| Object | Key fields |
| --- | --- |
| `Instrument` | `symbol`, `mic` (ISO 10383 exchange code), `currency`, `asset_class` |
| `Order` | `side`, `qty` (always positive), `order_type`, `mode`, `status` |
| `Fill` | `order_id`, `qty`, `price`, `fees`, `ts` |
| `Position` | `qty` (signed net), `avg_cost`, `realised_pnl`, `unrealised_pnl` |
| `Quote` / `Bar` | UTC-timestamped; `last`, `bid`, `ask` / OHLCV |
| `Signal` | `instrument`, `score` (+ve=long, -ve=short), `horizon` |

`Order.mode` must equal the broker session mode. This is enforced in `SimBroker.place_order` AND in `RiskEngine.check`. Defence in depth.

---

## Broker interface (brokers/base.py)

```python
class Broker(Protocol):
    async def connect(self) -> None: ...
    async def get_account(self) -> Account: ...
    async def get_positions(self) -> list[Position]: ...
    async def place_order(self, order: Order) -> str: ...
    async def cancel_order(self, order_id: str) -> None: ...
    async def stream_fills(self) -> AsyncIterator[Fill]: ...
    async def stream_quotes(self, instruments: list[Instrument]) -> AsyncIterator[Quote]: ...
```

`SimBroker` is the reference implementation. Saxo/IBKR adapters match this protocol — no business logic in adapters.

---

## Key invariants

- **Mode tag travels everywhere.** `Order.mode` ∈ `{'paper', 'backtest', 'live'}`. Adapters reject mismatches. Risk engine checks independently.
- **No business logic in adapters.** PnL, position math, and risk rules live in core so they're reproducible across brokers and the backtester.
- **Workers never talk to brokers.** Command flow: Worker → `commands` table + `pg_notify` → OMS daemon (LISTEN) → broker. No public port on droplet.
- **paper ≠ live at the infra level.** Separate droplet, separate DB cluster, separate Workers route. Switching to live is a deploy, not a flag.
- **Every order through the risk engine.** Even Phase 2 agents don't bypass it.

---

## Testing conventions

- `pytest` — run with `pytest` or `make test`
- Tests in `tests/` mirror module structure
- `SimBroker` only in CI — no external creds needed
- Property tests (Hypothesis) for OMS state machine and PnL math
- Replay tests record Saxo/IBKR sessions to fixtures for regression testing (M2+)
- `asyncio_mode = "auto"` in pytest config — async tests don't need `@pytest.mark.asyncio`

---

## CLI

```
tradingplatform backtest [--demo] [--config CONFIG]
tradingplatform paper --config CONFIG
tradingplatform doctor
```

`paper` mode requires `TP_MODE=paper` env var. `live` requires `TP_MODE=live` AND `--i-understand-this-is-real-money` flag.

---

## Config (config/settings.py)

Pydantic-settings, env-driven. Key env vars:
- `TP_MODE` — `backtest` | `paper` | `live`
- `TP_DB_URL` — Postgres DSN (routed through PgBouncer in cloud)
- `TP_SAXO_*` — Saxo OAuth credentials (droplet only)
- `TP_IBKR_*` — IBKR gateway settings (droplet only)

Copy `.env.example` to `.env` for local dev.

---

## Multi-user + roles

`users.role` ∈ `{'user', 'admin'}`. `users.status` ∈ `{'active', 'suspended', 'pending'}`.

Every request goes through auth middleware that attaches `{ userId, role }` to context. Admin routes are wrapped with `requireRole('admin')` — hard 403 otherwise. Admin sessions have a shorter TTL (24h) than user sessions (7 days).

`audit_log` is append-only. **Every admin action must write a row** — enforced in a wrapper function, not left to individual endpoint authors. The table has no UPDATE or DELETE at the DB role level. Retained ≥ 1 year.

Suspended users: their sessions are invalidated immediately on suspension (KV keys deleted). The middleware checks `status === 'active'` on every request — a suspended user's existing cookie stops working within seconds.

---

## Saxo token security rules

These are non-negotiable. Any code that violates them must be rejected:

1. **Raw token never stored in plaintext** — encrypt with AES-256-GCM before writing to DB
2. **Decryption only inside DO Functions** — never in Workers JS, never in the browser
3. **Master key in env vars only** — `TOKEN_ENCRYPTION_KEY` in DO Function secrets; never in DB, source, or logs
4. **AAD binds ciphertext to user** — use `user_id.bytes` as Additional Authenticated Data; prevents transplant attacks
5. **Token never echoed back** — `POST /saxo/token` stores and discards; no endpoint returns the plaintext
6. **Logs contain no token values** — log `user_id` + endpoint + status code only
7. **TTL enforced at two levels** — DB `expires_at` column AND Worker middleware check before any proxy call

```python
# DO Function encryption pattern
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
import os, uuid

key = bytes.fromhex(os.environ["TOKEN_ENCRYPTION_KEY"])  # 32 bytes
iv = os.urandom(12)                                       # fresh per encryption
aad = user_id.bytes                                       # binds to this user
ct = AESGCM(key).encrypt(iv, token.encode(), aad)
# store: iv + ct (last 16 bytes of ct are the GCM tag)
```

---

## Milestones (current state)

See `.scrum/progress.md` for the full status table.

| Track | Next milestone | Sprint |
| --- | --- | --- |
| Web product | W1 — Web foundation (sign-up, auth, dashboard) | sprint-02 |
| Engine | M1 — Backtester with real market data | sprint-01 |

Sprints 01 and 02 can run in parallel — M1 is backend-only, W1 is Workers/frontend-only.

---

## Common gotchas

- `asyncio.get_event_loop().run_until_complete(...)` in `backtest.py` — the backtester is sync at the outer loop, async calls are run directly. When refactoring, use `asyncio.run()` for top-level entry points.
- `Position.qty` is signed (positive = long, negative = short). `Order.qty` is always positive — direction from `side`.
- `Decimal` throughout for prices and quantities. Don't mix with `float`.
- `Instrument.key` is `f"{symbol}:{mic}"` — use this as dict keys, not just `symbol`.
