"""Saxo OpenAPI adapter — STUB.

References
----------
- Environments / SIM:  https://www.developer.saxo/openapi/learn/environments
- Authentication:      https://www.developer.saxo/openapi/learn/security
- Orders / placement:  https://www.developer.saxo/openapi/referencedocs/trade
- Streaming:           https://www.developer.saxo/openapi/learn/streaming

Implementation notes
--------------------
- Use the SIM environment by default; live requires explicit config.
- Saxo identifies instruments by `Uic` — adapters must maintain a symbol→Uic
  cache (refreshed daily) so the rest of the platform stays in `Instrument`.
- Subscriptions over /streaming use a context id; renew before token expiry.
- 24h dev tokens are fine to start; switch to OAuth refresh once unattended.
"""

from __future__ import annotations

from collections.abc import AsyncIterator

from ..config.settings import Settings
from ..core import Account, Fill, Instrument, Order, Position, Quote
from .base import BrokerSession


class SaxoAdapter:
    """Saxo OpenAPI adapter. NOT YET IMPLEMENTED.

    The class shape is real so the rest of the system can wire against it.
    Replace each `NotImplementedError` with the actual REST/WS calls.
    """

    def __init__(self, settings: Settings) -> None:
        self._settings = settings
        self.session = BrokerSession(name="saxo", mode=settings.mode, account_id="SIM-PENDING")
        # TODO: httpx.AsyncClient with bearer auth, base_url=settings.saxo_base_url

    async def connect(self) -> None:
        # TODO: GET /port/v1/users/me, populate account_id, fetch instrument cache
        raise NotImplementedError("SaxoAdapter.connect — pending M2")

    async def disconnect(self) -> None:
        return None

    async def get_account(self) -> Account:
        raise NotImplementedError("SaxoAdapter.get_account — pending M2")

    async def get_positions(self) -> list[Position]:
        raise NotImplementedError("SaxoAdapter.get_positions — pending M2")

    async def place_order(self, order: Order) -> str:
        # TODO: POST /trade/v2/orders, map OrderType / Saxo AssetType, return OrderId
        raise NotImplementedError("SaxoAdapter.place_order — pending M2")

    async def cancel_order(self, broker_order_id: str) -> None:
        raise NotImplementedError("SaxoAdapter.cancel_order — pending M2")

    async def stream_fills(self) -> AsyncIterator[Fill]:
        raise NotImplementedError("SaxoAdapter.stream_fills — pending M2")
        yield  # type: ignore[unreachable]  # makes this an async generator

    async def stream_quotes(self, instruments: list[Instrument]) -> AsyncIterator[Quote]:
        raise NotImplementedError("SaxoAdapter.stream_quotes — pending M2")
        yield  # type: ignore[unreachable]
