"""Broker abstraction.

Every adapter implements `Broker`. Strategies, OMS, agents, and the backtester
talk to this interface only — never to broker SDKs directly.
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from typing import Protocol, runtime_checkable

from ..core import Account, Fill, Instrument, Order, Position, Quote


class BrokerSession:
    """Identifies which environment an adapter is running against.

    Used by the OMS to refuse cross-mode orders (e.g. a paper-tagged order hitting
    a live session is rejected before the network call).
    """

    def __init__(self, name: str, mode: str, account_id: str) -> None:
        if mode not in ("paper", "backtest", "live"):
            raise ValueError(f"unknown mode {mode!r}")
        self.name = name
        self.mode = mode
        self.account_id = account_id

    def __repr__(self) -> str:
        return f"BrokerSession(name={self.name!r}, mode={self.mode!r}, account={self.account_id!r})"


@runtime_checkable
class Broker(Protocol):
    """Protocol every broker adapter implements."""

    session: BrokerSession

    async def connect(self) -> None: ...
    async def disconnect(self) -> None: ...

    async def get_account(self) -> Account: ...
    async def get_positions(self) -> list[Position]: ...

    async def place_order(self, order: Order) -> str:
        """Send an order, return the broker order id."""

    async def cancel_order(self, broker_order_id: str) -> None: ...

    async def stream_fills(self) -> AsyncIterator[Fill]:
        """Yield fills as they arrive. Implementations should reconnect transparently."""
        ...

    async def stream_quotes(self, instruments: list[Instrument]) -> AsyncIterator[Quote]:
        """Yield top-of-book updates for the requested instruments."""
        ...
