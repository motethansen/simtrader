"""Risk gates — every order passes through these before reaching a broker.

Adding new checks is intentionally cheap: implement a function that takes the
order + current state and returns a `RiskCheckResult`. Wire it into `RiskEngine`.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from decimal import Decimal

from ..brokers.base import BrokerSession
from ..core import Order, Position


@dataclass
class RiskCheckResult:
    ok: bool
    reason: str = ""

    @classmethod
    def passed(cls) -> RiskCheckResult:
        return cls(ok=True)

    @classmethod
    def failed(cls, reason: str) -> RiskCheckResult:
        return cls(ok=False, reason=reason)


@dataclass
class RiskLimits:
    max_qty_per_symbol: Decimal | None = None
    max_notional_per_order: Decimal | None = None
    max_orders_per_minute: int = 60
    max_daily_loss: Decimal | None = None


@dataclass
class RiskEngine:
    """Owns the canonical risk state and runs the check chain.

    The engine is deliberately stateful — order-rate windows and daily PnL must
    be tracked across calls.
    """

    limits: RiskLimits = field(default_factory=RiskLimits)
    _order_timestamps: list[datetime] = field(default_factory=list, init=False)
    daily_realised_pnl: Decimal = Decimal("0")

    def check(
        self,
        order: Order,
        session: BrokerSession,
        positions: dict[str, Position],
    ) -> RiskCheckResult:
        if order.mode != session.mode:
            return RiskCheckResult.failed(
                f"mode mismatch: order={order.mode} session={session.mode}"
            )

        if self.limits.max_qty_per_symbol is not None:
            cur = positions.get(order.instrument.key)
            cur_qty = cur.qty if cur else Decimal("0")
            new_qty = cur_qty + (order.qty if order.side.value == "buy" else -order.qty)
            if abs(new_qty) > self.limits.max_qty_per_symbol:
                return RiskCheckResult.failed(
                    f"max_qty_per_symbol breached: {abs(new_qty)} > {self.limits.max_qty_per_symbol}"
                )

        if (
            self.limits.max_notional_per_order is not None
            and order.limit_price is not None
            and order.qty * order.limit_price > self.limits.max_notional_per_order
        ):
            return RiskCheckResult.failed("max_notional_per_order breached")

        # Order rate
        now = datetime.now(timezone.utc)
        cutoff = now.timestamp() - 60.0
        self._order_timestamps = [t for t in self._order_timestamps if t.timestamp() > cutoff]
        if len(self._order_timestamps) >= self.limits.max_orders_per_minute:
            return RiskCheckResult.failed("max_orders_per_minute breached")
        self._order_timestamps.append(now)

        # Daily kill-switch
        if (
            self.limits.max_daily_loss is not None
            and self.daily_realised_pnl <= -abs(self.limits.max_daily_loss)
        ):
            return RiskCheckResult.failed(
                f"daily kill-switch: realised PnL {self.daily_realised_pnl}"
            )

        return RiskCheckResult.passed()
