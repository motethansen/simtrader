"""Simple moving-average crossover — a sanity check, not advice."""

from __future__ import annotations

from collections import defaultdict, deque
from dataclasses import dataclass, field
from decimal import Decimal

from ...core import Bar, Fill, Signal
from ..base import Context


@dataclass
class SmaCrossStrategy:
    fast: int = 10
    slow: int = 30
    id: str = "sma-cross"
    _history: dict[str, deque[Decimal]] = field(default_factory=lambda: defaultdict(lambda: deque(maxlen=200)))
    _last_signal: dict[str, int] = field(default_factory=dict)

    def on_bar(self, bar: Bar, ctx: Context) -> list[Signal]:
        history = self._history[bar.instrument.key]
        history.append(bar.close)
        if len(history) < self.slow:
            return []

        fast_avg = sum(list(history)[-self.fast :]) / Decimal(self.fast)
        slow_avg = sum(list(history)[-self.slow :]) / Decimal(self.slow)

        direction = 1 if fast_avg > slow_avg else -1
        if self._last_signal.get(bar.instrument.key) == direction:
            return []
        self._last_signal[bar.instrument.key] = direction

        return [
            Signal(
                instrument=bar.instrument,
                score=float(direction),
                horizon_days=5,
                strategy_id=self.id,
                metadata={"fast": str(fast_avg), "slow": str(slow_avg)},
            )
        ]

    def on_fill(self, fill: Fill, ctx: Context) -> None:
        return None
