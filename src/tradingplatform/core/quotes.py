"""Market data — top-of-book quotes and OHLCV bars."""

from __future__ import annotations

from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel

from .instruments import Instrument


class Quote(BaseModel):
    """Top-of-book snapshot. All times UTC."""

    instrument: Instrument
    ts: datetime
    bid: Decimal | None = None
    ask: Decimal | None = None
    last: Decimal | None = None
    bid_size: Decimal | None = None
    ask_size: Decimal | None = None

    @property
    def mid(self) -> Decimal | None:
        if self.bid is not None and self.ask is not None:
            return (self.bid + self.ask) / Decimal("2")
        return self.last


class Bar(BaseModel):
    """OHLCV bar at a fixed granularity.

    `granularity` is a free-form label like '1m', '5m', '1d' — the convention
    is set per data provider but normalised by the marketdata layer.
    """

    instrument: Instrument
    ts: datetime
    open: Decimal
    high: Decimal
    low: Decimal
    close: Decimal
    volume: Decimal = Decimal("0")
    granularity: str = "1d"
