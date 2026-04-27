"""Order management.

The OMS owns the lifecycle of every order, runs orders through the risk engine,
and dispatches to the configured broker adapter. Today it's an in-memory store —
M4 swaps in Postgres-backed persistence with the same interface.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import TYPE_CHECKING

from ..core import Fill, Order, OrderStatus, Position
from ..risk import RiskEngine

if TYPE_CHECKING:  # pragma: no cover
    from ..brokers.base import Broker


@dataclass
class OMS:
    broker: "Broker"
    risk: RiskEngine = field(default_factory=RiskEngine)
    orders: dict[str, Order] = field(default_factory=dict)
    positions: dict[str, Position] = field(default_factory=dict)

    async def submit(self, order: Order) -> Order:
        check = self.risk.check(order, self.broker.session, self.positions)
        if not check.ok:
            order.status = OrderStatus.REJECTED
            self.orders[order.id] = order
            return order

        broker_id = await self.broker.place_order(order)
        order.broker_order_id = broker_id
        if order.status == OrderStatus.NEW:
            order.status = OrderStatus.SENT
        self.orders[order.id] = order
        return order

    def on_fill(self, fill: Fill) -> None:
        order = self.orders.get(fill.order_id)
        if order is not None:
            order.filled_qty += fill.qty
            if order.avg_fill_price is None:
                order.avg_fill_price = fill.price
            else:
                order.avg_fill_price = (
                    order.avg_fill_price * (order.filled_qty - fill.qty) + fill.price * fill.qty
                ) / order.filled_qty
            order.status = (
                OrderStatus.FILLED if order.remaining_qty == 0 else OrderStatus.PARTIALLY_FILLED
            )

        pos = self.positions.setdefault(
            fill.instrument.key, Position(instrument=fill.instrument)
        )
        pos.apply(fill)
        self.risk.daily_realised_pnl = sum(
            (p.realised_pnl for p in self.positions.values()), start=type(pos.realised_pnl)("0")
        )
