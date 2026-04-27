"""Fills and net-of-trades positions."""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from decimal import Decimal

from pydantic import BaseModel, Field

from .instruments import Instrument
from .orders import OrderSide


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


class Fill(BaseModel):
    """A single execution slice."""

    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    order_id: str
    instrument: Instrument
    side: OrderSide
    qty: Decimal
    price: Decimal
    fees: Decimal = Decimal("0")
    venue: str | None = None
    ts: datetime = Field(default_factory=_utcnow)


class Position(BaseModel):
    """Net position in a single instrument.

    `qty` is signed: positive = long, negative = short.
    Realised PnL accumulates as positions are reduced.
    """

    instrument: Instrument
    qty: Decimal = Decimal("0")
    avg_price: Decimal = Decimal("0")
    realised_pnl: Decimal = Decimal("0")

    def apply(self, fill: Fill) -> None:
        """Update the position with a new fill, accumulating realised PnL.

        This is the canonical accounting routine — broker-side numbers should
        always reconcile against this.
        """
        signed_fill_qty = fill.qty if fill.side == OrderSide.BUY else -fill.qty

        if self.qty == 0 or (self.qty > 0) == (signed_fill_qty > 0):
            # Opening or adding to position — weighted avg.
            new_qty = self.qty + signed_fill_qty
            self.avg_price = (
                (self.avg_price * abs(self.qty) + fill.price * abs(signed_fill_qty)) / abs(new_qty)
                if new_qty != 0
                else Decimal("0")
            )
            self.qty = new_qty
        else:
            # Reducing or flipping — realise PnL on the closed portion.
            closing_qty = min(abs(signed_fill_qty), abs(self.qty))
            direction = Decimal("1") if self.qty > 0 else Decimal("-1")
            self.realised_pnl += direction * closing_qty * (fill.price - self.avg_price)

            new_qty = self.qty + signed_fill_qty
            if new_qty == 0:
                self.qty = Decimal("0")
                self.avg_price = Decimal("0")
            elif (new_qty > 0) != (self.qty > 0):
                # Flipped: any leftover opens at fill price.
                self.qty = new_qty
                self.avg_price = fill.price
            else:
                self.qty = new_qty
                # avg_price unchanged when reducing without flipping

    def market_value(self, mark: Decimal) -> Decimal:
        return self.qty * mark

    def unrealised_pnl(self, mark: Decimal) -> Decimal:
        return self.qty * (mark - self.avg_price)
