"""Account / cash state."""

from __future__ import annotations

from decimal import Decimal

from pydantic import BaseModel, Field


class Account(BaseModel):
    """Multi-currency account state.

    `cash` is keyed by ISO 4217 currency. `equity` is the broker-reported total
    in `base_currency`; we don't compute FX conversions in core (broker does).
    """

    account_id: str
    base_currency: str = "USD"
    cash: dict[str, Decimal] = Field(default_factory=dict)
    equity: Decimal = Decimal("0")
    buying_power: Decimal = Decimal("0")
    margin_used: Decimal = Decimal("0")

    def get_cash(self, currency: str) -> Decimal:
        return self.cash.get(currency, Decimal("0"))
