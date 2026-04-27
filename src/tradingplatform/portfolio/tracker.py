"""Portfolio tracking — equity curve, simple metrics."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from decimal import Decimal

from ..core import Fill, Position


@dataclass
class EquityPoint:
    ts: datetime
    equity: Decimal


@dataclass
class PortfolioTracker:
    starting_cash: Decimal
    cash: Decimal = field(init=False)
    positions: dict[str, Position] = field(default_factory=dict)
    history: list[EquityPoint] = field(default_factory=list)

    def __post_init__(self) -> None:
        self.cash = self.starting_cash

    def apply_fill(self, fill: Fill) -> None:
        pos = self.positions.setdefault(fill.instrument.key, Position(instrument=fill.instrument))
        pos.apply(fill)
        notional = fill.price * fill.qty
        if fill.side.value == "buy":
            self.cash -= notional + fill.fees
        else:
            self.cash += notional - fill.fees

    def mark(self, ts: datetime, marks: dict[str, Decimal]) -> None:
        equity = self.cash
        for key, pos in self.positions.items():
            mark = marks.get(key)
            if mark is None:
                continue
            equity += pos.market_value(mark)
        self.history.append(EquityPoint(ts=ts, equity=equity))

    @property
    def total_return(self) -> Decimal:
        if not self.history:
            return Decimal("0")
        last = self.history[-1].equity
        return (last - self.starting_cash) / self.starting_cash
