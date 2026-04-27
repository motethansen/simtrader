"""Event-driven historical backtester.

Drives bars through a strategy and routes its signals as orders into the
SimBroker — exercising the same OMS, risk, and order plumbing the live
adapters will use.
"""

from __future__ import annotations

import asyncio
from collections.abc import Iterable
from dataclasses import dataclass, field
from datetime import datetime
from decimal import Decimal

from ..brokers.sim import SimBroker, SimConfig
from ..core import Bar, Instrument, Order, OrderSide, OrderType, Quote
from ..oms import OMS
from ..portfolio import PortfolioTracker
from ..strategies.base import Context, Strategy


@dataclass
class BacktestResult:
    starting_cash: Decimal
    final_equity: Decimal
    total_return: Decimal
    n_orders: int
    n_fills: int
    equity_curve: list[tuple[datetime, Decimal]] = field(default_factory=list)


class BacktestEngine:
    """Synchronously consumes a stream of bars per instrument and runs the strategy."""

    def __init__(
        self,
        strategy: Strategy,
        instruments: list[Instrument],
        sim_config: SimConfig | None = None,
    ) -> None:
        self.strategy = strategy
        self.instruments = instruments
        self.sim_config = sim_config or SimConfig()
        self.sim = SimBroker(config=self.sim_config)
        self.oms = OMS(broker=self.sim)
        self.portfolio = PortfolioTracker(starting_cash=self.sim_config.starting_cash)
        self.n_orders = 0
        self.n_fills = 0

    def run(self, bars_by_instrument: dict[str, Iterable[Bar]]) -> BacktestResult:
        # Interleave bars by timestamp.
        merged: list[Bar] = []
        for series in bars_by_instrument.values():
            merged.extend(series)
        merged.sort(key=lambda b: b.ts)

        ctx = Context()

        for bar in merged:
            quote = Quote(
                instrument=bar.instrument,
                ts=bar.ts,
                last=bar.close,
                bid=bar.close,
                ask=bar.close,
            )
            # Resolve any pending orders against this bar.
            fills = self.sim.tick(quote)
            for f in fills:
                self.oms.on_fill(f)
                self.portfolio.apply_fill(f)
                self.n_fills += 1
                self.strategy.on_fill(f, ctx)

            # Generate new signals.
            signals = self.strategy.on_bar(bar, ctx)
            for sig in signals:
                # Trivial signal→order rule: 1 unit per signal direction.
                # A real Planner would size against equity.
                qty = Decimal("10")
                cur_qty = (
                    self.portfolio.positions[sig.instrument.key].qty
                    if sig.instrument.key in self.portfolio.positions
                    else Decimal("0")
                )
                if sig.score > 0 and cur_qty <= 0:
                    order = Order(
                        instrument=sig.instrument,
                        side=OrderSide.BUY,
                        qty=qty + abs(cur_qty),
                        order_type=OrderType.MARKET,
                        mode="backtest",
                        strategy_id=self.strategy.id,
                    )
                elif sig.score < 0 and cur_qty > 0:
                    order = Order(
                        instrument=sig.instrument,
                        side=OrderSide.SELL,
                        qty=cur_qty,
                        order_type=OrderType.MARKET,
                        mode="backtest",
                        strategy_id=self.strategy.id,
                    )
                else:
                    continue
                asyncio.get_event_loop().run_until_complete(self.oms.submit(order))
                self.n_orders += 1

            # Mark-to-market.
            marks = {bar.instrument.key: bar.close}
            self.portfolio.mark(bar.ts, marks)

        final_equity = (
            self.portfolio.history[-1].equity
            if self.portfolio.history
            else self.sim_config.starting_cash
        )
        return BacktestResult(
            starting_cash=self.sim_config.starting_cash,
            final_equity=final_equity,
            total_return=self.portfolio.total_return,
            n_orders=self.n_orders,
            n_fills=self.n_fills,
            equity_curve=[(p.ts, p.equity) for p in self.portfolio.history],
        )
