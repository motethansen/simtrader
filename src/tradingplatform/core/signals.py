"""Strategy outputs and target portfolio plans."""

from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal

from pydantic import BaseModel, Field

from .instruments import Instrument


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


class Signal(BaseModel):
    """A directional view emitted by a strategy.

    `score` is a [-1, 1] conviction (negative = short bias). `horizon_days` is
    a hint for the executor on how aggressively to work the order.
    """

    instrument: Instrument
    score: float = Field(..., ge=-1.0, le=1.0)
    horizon_days: int = 1
    strategy_id: str
    ts: datetime = Field(default_factory=_utcnow)
    metadata: dict[str, str] = Field(default_factory=dict)


class Plan(BaseModel):
    """A target portfolio.

    `targets` maps an instrument key (`"AAPL.XNAS"`) to either a target weight
    in [-1, 1] or a target absolute quantity, depending on `mode`.
    """

    plan_id: str
    mode: str = Field("weights", description="'weights' | 'qty'")
    targets: dict[str, Decimal] = Field(default_factory=dict)
    cash_buffer_pct: Decimal = Decimal("0.02")
    notes: str | None = None
    ts: datetime = Field(default_factory=_utcnow)
