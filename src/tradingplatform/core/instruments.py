"""Canonical instrument identity used everywhere in the platform.

Brokers have their own ids (Saxo `Uic`, IBKR `conId`). Adapters are responsible
for mapping to/from this canonical type.
"""

from __future__ import annotations

from enum import Enum

from pydantic import BaseModel, Field


class AssetClass(str, Enum):
    EQUITY = "equity"
    ETF = "etf"
    OPTION = "option"
    FUTURE = "future"
    FX = "fx"
    CRYPTO = "crypto"


class Instrument(BaseModel):
    """A canonical, broker-agnostic instrument identity.

    Identity is `(symbol, mic)` for listed instruments. ISIN is preferred when
    available — it's globally unique and survives ticker changes.
    """

    symbol: str = Field(..., description="Exchange ticker, e.g. 'AAPL', 'NOVO B', 'BHP'")
    mic: str = Field(..., description="ISO 10383 MIC, e.g. 'XNAS', 'XNYS', 'XCSE', 'XASX'")
    isin: str | None = None
    currency: str = Field(..., description="ISO 4217 currency, e.g. 'USD', 'EUR', 'AUD'")
    asset_class: AssetClass = AssetClass.EQUITY
    name: str | None = None

    @property
    def key(self) -> str:
        """Stable identity string for caches and logs."""
        return f"{self.symbol}.{self.mic}"

    def __str__(self) -> str:
        return self.key
