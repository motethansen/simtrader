"""Interactive Brokers adapter — STUB.

Two viable transports — pick one per deployment:

1. `ib_insync` over TWS / IB Gateway (recommended for desktop/dev).
   - Paper port 7497, live port 7496.
   - Requires a running TWS or IB Gateway process.

2. Client Portal Gateway (REST + websocket) — better for headless servers.

This stub is shaped for transport (1). Swap with the CP Gateway when M3 hardens.
"""

from __future__ import annotations

from collections.abc import AsyncIterator

from ..config.settings import Settings
from ..core import Account, Fill, Instrument, Order, Position, Quote
from .base import BrokerSession


class IBKRAdapter:
    """Interactive Brokers adapter via ib_insync. NOT YET IMPLEMENTED."""

    def __init__(self, settings: Settings) -> None:
        self._settings = settings
        self.session = BrokerSession(name="ibkr", mode=settings.mode, account_id="DUH-PENDING")
        # TODO: from ib_insync import IB; self._ib = IB()

    async def connect(self) -> None:
        # TODO: await self._ib.connectAsync(host, port, clientId)
        raise NotImplementedError("IBKRAdapter.connect — pending M3")

    async def disconnect(self) -> None:
        return None

    async def get_account(self) -> Account:
        raise NotImplementedError("IBKRAdapter.get_account — pending M3")

    async def get_positions(self) -> list[Position]:
        raise NotImplementedError("IBKRAdapter.get_positions — pending M3")

    async def place_order(self, order: Order) -> str:
        raise NotImplementedError("IBKRAdapter.place_order — pending M3")

    async def cancel_order(self, broker_order_id: str) -> None:
        raise NotImplementedError("IBKRAdapter.cancel_order — pending M3")

    async def stream_fills(self) -> AsyncIterator[Fill]:
        raise NotImplementedError("IBKRAdapter.stream_fills — pending M3")
        yield  # type: ignore[unreachable]

    async def stream_quotes(self, instruments: list[Instrument]) -> AsyncIterator[Quote]:
        raise NotImplementedError("IBKRAdapter.stream_quotes — pending M3")
        yield  # type: ignore[unreachable]
