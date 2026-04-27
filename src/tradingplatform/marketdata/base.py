"""Market data provider interfaces."""

from __future__ import annotations

from collections.abc import Iterable
from datetime import datetime
from typing import Protocol

from ..core import Bar, Instrument


class HistoricalProvider(Protocol):
    """Provider of historical bars for backtesting / research."""

    def bars(
        self,
        instrument: Instrument,
        start: datetime,
        end: datetime,
        granularity: str = "1d",
    ) -> Iterable[Bar]: ...
