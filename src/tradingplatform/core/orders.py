"""Order objects and their lifecycle states."""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from decimal import Decimal
from enum import Enum

from pydantic import BaseModel, Field, model_validator

from .instruments import Instrument


class OrderSide(str, Enum):
    BUY = "buy"
    SELL = "sell"


class OrderType(str, Enum):
    MARKET = "market"
    LIMIT = "limit"
    STOP = "stop"
    STOP_LIMIT = "stop_limit"


class TimeInForce(str, Enum):
    DAY = "day"
    GTC = "gtc"
    IOC = "ioc"
    FOK = "fok"


class OrderStatus(str, Enum):
    NEW = "new"
    SENT = "sent"
    PARTIALLY_FILLED = "partially_filled"
    FILLED = "filled"
    CANCELLED = "cancelled"
    REJECTED = "rejected"


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


class Order(BaseModel):
    """An order request as it flows through the OMS.

    Quantities are signed-by-side: `side=BUY, qty=10` means a long order for 10
    shares. For shorts, set `side=SELL` against a flat or long position.
    """

    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    client_order_id: str | None = None
    broker_order_id: str | None = None

    instrument: Instrument
    side: OrderSide
    qty: Decimal
    order_type: OrderType = OrderType.MARKET
    limit_price: Decimal | None = None
    stop_price: Decimal | None = None
    tif: TimeInForce = TimeInForce.DAY

    status: OrderStatus = OrderStatus.NEW
    filled_qty: Decimal = Decimal("0")
    avg_fill_price: Decimal | None = None

    # Operational
    mode: str = Field("paper", description="'paper' | 'backtest' | 'live' — must match adapter session.")
    strategy_id: str | None = None
    parent_id: str | None = Field(None, description="For child orders from slicers.")
    created_at: datetime = Field(default_factory=_utcnow)
    updated_at: datetime = Field(default_factory=_utcnow)

    @model_validator(mode="after")
    def _validate_prices(self) -> Order:
        if self.order_type in (OrderType.LIMIT, OrderType.STOP_LIMIT) and self.limit_price is None:
            raise ValueError(f"limit_price required for {self.order_type}")
        if self.order_type in (OrderType.STOP, OrderType.STOP_LIMIT) and self.stop_price is None:
            raise ValueError(f"stop_price required for {self.order_type}")
        if self.qty <= 0:
            raise ValueError("qty must be positive; use `side` for direction")
        return self

    @property
    def remaining_qty(self) -> Decimal:
        return self.qty - self.filled_qty

    @property
    def is_terminal(self) -> bool:
        return self.status in (OrderStatus.FILLED, OrderStatus.CANCELLED, OrderStatus.REJECTED)
