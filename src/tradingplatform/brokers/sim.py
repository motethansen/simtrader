"""SimBroker — an in-process broker that fills against a configurable model.

Used by:
- The historical backtester (where bars drive the price stream).
- Unit tests (deterministic, seeded).

Behaviour:
- Market orders fill at the next observed price + configurable bps slippage.
- Limit orders fill when `last` crosses the limit (intrabar approximation).
- Latency is modelled as N-bar delay before the fill is emitted.
- Partial fills can be enabled with `max_qty_per_bar`.
"""

from __future__ import annotations

import asyncio
import uuid
from collections.abc import AsyncIterator
from dataclasses import dataclass, field
from decimal import Decimal

from ..core import (
    Account,
    Fill,
    Instrument,
    Order,
    OrderSide,
    OrderStatus,
    OrderType,
    Position,
    Quote,
)
from .base import BrokerSession


@dataclass
class SimConfig:
    slippage_bps: Decimal = Decimal("1")  # 1 bps = 0.01%
    fee_per_share: Decimal = Decimal("0")
    fee_min: Decimal = Decimal("0")
    latency_bars: int = 0
    max_qty_per_bar: Decimal | None = None
    starting_cash: Decimal = Decimal("100000")
    base_currency: str = "USD"


@dataclass
class _PendingOrder:
    order: Order
    bars_remaining: int


@dataclass
class SimBroker:
    """In-process broker driven by externally-pushed quotes/bars.

    The host (backtester or test) calls `tick(quote)` to advance the world; the
    sim emits fills via the queue exposed by `stream_fills()`.
    """

    config: SimConfig = field(default_factory=SimConfig)
    session: BrokerSession = field(
        default_factory=lambda: BrokerSession("sim", "backtest", "SIM-LOCAL")
    )

    _pending: list[_PendingOrder] = field(default_factory=list, init=False)
    _positions: dict[str, Position] = field(default_factory=dict, init=False)
    _account: Account = field(init=False)
    _fill_queue: asyncio.Queue[Fill] = field(default_factory=asyncio.Queue, init=False)
    _last_price: dict[str, Decimal] = field(default_factory=dict, init=False)

    def __post_init__(self) -> None:
        self._account = Account(
            account_id=self.session.account_id,
            base_currency=self.config.base_currency,
            cash={self.config.base_currency: self.config.starting_cash},
            equity=self.config.starting_cash,
            buying_power=self.config.starting_cash,
        )

    # ---- Broker interface ----

    async def connect(self) -> None:
        return None

    async def disconnect(self) -> None:
        return None

    async def get_account(self) -> Account:
        return self._account

    async def get_positions(self) -> list[Position]:
        return [p for p in self._positions.values() if p.qty != 0]

    async def place_order(self, order: Order) -> str:
        if order.mode != self.session.mode:
            raise ValueError(
                f"order.mode={order.mode!r} does not match broker session mode={self.session.mode!r}"
            )
        order.broker_order_id = f"sim-{uuid.uuid4()}"
        order.status = OrderStatus.SENT
        self._pending.append(_PendingOrder(order=order, bars_remaining=self.config.latency_bars))
        return order.broker_order_id

    async def cancel_order(self, broker_order_id: str) -> None:
        self._pending = [
            p for p in self._pending if p.order.broker_order_id != broker_order_id
        ]

    async def stream_fills(self) -> AsyncIterator[Fill]:
        while True:
            fill = await self._fill_queue.get()
            yield fill

    async def stream_quotes(self, instruments: list[Instrument]) -> AsyncIterator[Quote]:
        # Sim doesn't push quotes — host is the source. Yield nothing.
        if False:  # pragma: no cover
            yield  # type: ignore[unreachable]

    # ---- Host-driven simulation ----

    def tick(self, quote: Quote) -> list[Fill]:
        """Advance the simulated world by one quote/bar; emit any matched fills."""
        price = quote.last or quote.mid
        if price is None:
            return []
        self._last_price[quote.instrument.key] = price

        emitted: list[Fill] = []
        still_pending: list[_PendingOrder] = []

        for p in self._pending:
            if p.order.instrument.key != quote.instrument.key:
                still_pending.append(p)
                continue
            if p.bars_remaining > 0:
                p.bars_remaining -= 1
                still_pending.append(p)
                continue

            fill = self._try_match(p.order, price, quote)
            if fill is None:
                still_pending.append(p)
                continue
            emitted.append(fill)
            self._apply_fill(p.order, fill)
            if p.order.status != OrderStatus.FILLED:
                still_pending.append(p)

        self._pending = still_pending
        for f in emitted:
            self._fill_queue.put_nowait(f)
        return emitted

    # ---- Internals ----

    def _try_match(self, order: Order, price: Decimal, quote: Quote) -> Fill | None:
        if order.order_type == OrderType.MARKET:
            fill_price = self._apply_slippage(order, price)
        elif order.order_type == OrderType.LIMIT:
            assert order.limit_price is not None
            if order.side == OrderSide.BUY and price <= order.limit_price:
                fill_price = order.limit_price
            elif order.side == OrderSide.SELL and price >= order.limit_price:
                fill_price = order.limit_price
            else:
                return None
        else:
            # STOP/STOP_LIMIT not yet modelled in sim
            return None

        fill_qty = order.remaining_qty
        if self.config.max_qty_per_bar is not None:
            fill_qty = min(fill_qty, self.config.max_qty_per_bar)

        fees = max(self.config.fee_min, self.config.fee_per_share * fill_qty)
        return Fill(
            order_id=order.id,
            instrument=order.instrument,
            side=order.side,
            qty=fill_qty,
            price=fill_price,
            fees=fees,
            venue=quote.instrument.mic,
            ts=quote.ts,
        )

    def _apply_slippage(self, order: Order, price: Decimal) -> Decimal:
        bps = self.config.slippage_bps / Decimal("10000")
        if order.side == OrderSide.BUY:
            return price * (Decimal("1") + bps)
        return price * (Decimal("1") - bps)

    def _apply_fill(self, order: Order, fill: Fill) -> None:
        # Update order
        new_filled = order.filled_qty + fill.qty
        if order.avg_fill_price is None:
            order.avg_fill_price = fill.price
        else:
            order.avg_fill_price = (
                order.avg_fill_price * order.filled_qty + fill.price * fill.qty
            ) / new_filled
        order.filled_qty = new_filled
        order.status = (
            OrderStatus.FILLED if order.remaining_qty == 0 else OrderStatus.PARTIALLY_FILLED
        )

        # Update position
        pos = self._positions.setdefault(fill.instrument.key, Position(instrument=fill.instrument))
        pos.apply(fill)

        # Update cash (single-currency; multi-ccy needs FX)
        ccy = fill.instrument.currency
        cash = self._account.cash.setdefault(ccy, Decimal("0"))
        notional = fill.price * fill.qty
        if fill.side == OrderSide.BUY:
            self._account.cash[ccy] = cash - notional - fill.fees
        else:
            self._account.cash[ccy] = cash + notional - fill.fees
