"""CSV-backed historical provider — for fixtures and offline backtests."""

from __future__ import annotations

from collections.abc import Iterable
from datetime import datetime
from decimal import Decimal
from pathlib import Path

import pandas as pd

from ..core import Bar, Instrument


class CSVHistoricalProvider:
    """Reads bars from `<root>/<symbol>.<mic>.csv`.

    Expected columns: ts (UTC ISO), open, high, low, close, volume.
    """

    def __init__(self, root: str | Path) -> None:
        self.root = Path(root)

    def bars(
        self,
        instrument: Instrument,
        start: datetime,
        end: datetime,
        granularity: str = "1d",
    ) -> Iterable[Bar]:
        path = self.root / f"{instrument.key}.csv"
        if not path.exists():
            return []
        df = pd.read_csv(path, parse_dates=["ts"])
        df = df[(df["ts"] >= start) & (df["ts"] <= end)]
        out: list[Bar] = []
        for row in df.itertuples(index=False):
            out.append(
                Bar(
                    instrument=instrument,
                    ts=row.ts.to_pydatetime(),
                    open=Decimal(str(row.open)),
                    high=Decimal(str(row.high)),
                    low=Decimal(str(row.low)),
                    close=Decimal(str(row.close)),
                    volume=Decimal(str(row.volume)),
                    granularity=granularity,
                )
            )
        return out
