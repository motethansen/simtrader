"""Execution Agent — Phase 2.

Consumes a `Plan` (target portfolio) + current positions, and emits a stream
of orders that move toward the target subject to risk limits, market hours,
and slicing policies (TWAP / POV).

Implementation is intentionally deterministic — an LLM may *configure* this
agent's parameters, but the agent itself is rule-based for safety/auditability.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from decimal import Decimal

from ..core import Order, OrderSide, OrderType, Plan, Position
from ..oms import OMS


@dataclass
class ExecutorPolicy:
    max_child_qty: Decimal = Decimal("100")
    use_limits: bool = False
    limit_offset_bps: Decimal = Decimal("5")


@dataclass
class ExecutorAgent:
    """Skeleton — wire in scheduling + slicing in M5."""

    oms: OMS
    policy: ExecutorPolicy = field(default_factory=ExecutorPolicy)

    async def reconcile(
        self,
        plan: Plan,
        marks: dict[str, Decimal],
        equity: Decimal,
        positions: dict[str, Position],
    ) -> list[Order]:
        """Compute orders to move from `positions` toward `plan` at given `marks`.

        Currently weight-mode only; a real implementation would also handle
        qty-mode plans, partial market access, and execution scheduling.
        """
        if plan.mode != "weights":
            raise NotImplementedError("qty-mode plans not yet supported")

        orders: list[Order] = []
        for key, target_w in plan.targets.items():
            mark = marks.get(key)
            if mark is None:
                continue
            target_notional = equity * target_w
            target_qty = target_notional / mark
            cur_qty = positions[key].qty if key in positions else Decimal("0")
            delta = target_qty - cur_qty
            if abs(delta) < Decimal("1"):
                continue
            instrument = (
                positions[key].instrument
                if key in positions
                else None
            )
            if instrument is None:
                # Without a known Instrument we can't construct an Order; the
                # caller is expected to enrich the plan with instruments.
                continue

            side = OrderSide.BUY if delta > 0 else OrderSide.SELL
            qty = abs(delta)
            for chunk in _split(qty, self.policy.max_child_qty):
                orders.append(
                    Order(
                        instrument=instrument,
                        side=side,
                        qty=chunk,
                        order_type=OrderType.MARKET,
                        mode=self.oms.broker.session.mode,
                        strategy_id="executor",
                    )
                )
        for o in orders:
            await self.oms.submit(o)
        return orders


def _split(total: Decimal, chunk: Decimal) -> list[Decimal]:
    out: list[Decimal] = []
    remaining = total
    while remaining > 0:
        take = min(remaining, chunk)
        out.append(take)
        remaining -= take
    return out
