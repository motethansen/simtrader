"""Synthetic data generator — used by the demo backtest so it works offline."""

from __future__ import annotations

import math
import random
from collections.abc import Iterable
from datetime import datetime, timedelta
from decimal import Decimal

from ..core import Bar, Instrument


class SyntheticProvider:
    """Geometric Brownian motion + a slow sine — enough to make a strategy do something."""

    def __init__(self, seed: int = 42, drift: float = 0.0002, vol: float = 0.012) -> None:
        self._seed = seed
        self._drift = drift
        self._vol = vol

    def bars(
        self,
        instrument: Instrument,
        start: datetime,
        end: datetime,
        granularity: str = "1d",
    ) -> Iterable[Bar]:
        rng = random.Random(self._seed + hash(instrument.key) % 10_000)
        days = max(1, (end - start).days)
        price = 100.0
        ts = start
        for i in range(days):
            shock = rng.gauss(self._drift, self._vol)
            cycle = 0.0008 * math.sin(i / 25.0)
            price = max(1.0, price * (1 + shock + cycle))
            o = price * (1 - 0.001)
            h = price * (1 + abs(rng.gauss(0, 0.004)))
            low = price * (1 - abs(rng.gauss(0, 0.004)))
            c = price
            yield Bar(
                instrument=instrument,
                ts=ts,
                open=Decimal(f"{o:.2f}"),
                high=Decimal(f"{h:.2f}"),
                low=Decimal(f"{low:.2f}"),
                close=Decimal(f"{c:.2f}"),
                volume=Decimal("1000000"),
                granularity=granularity,
            )
            ts += timedelta(days=1)
