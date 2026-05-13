"""Async HTTP client for the simtrader Worker research API (M9a).

Used by AI_stock_advisor and DO Functions to push/pull research data.
Requires `httpx` (optional dep — install with `pip install httpx`).
"""

from __future__ import annotations

import json
from decimal import Decimal
from typing import Any
from datetime import datetime

from .models import (
    Signal,
    SignalResponse,
    Evaluation,
    EvaluationResponse,
    ResearchInstrument,
    SignalActionRecord,
    SignalActionType,
)


class ResearchClientError(Exception):
    def __init__(self, status: int, body: str) -> None:
        self.status = status
        self.body = body
        super().__init__(f"Research API error {status}: {body}")


class ResearchClient:
    """Async client for the /research/* Worker API.

    Authenticates with either an engine API key or a bridge JWT.

    Example::

        async with ResearchClient(base_url="https://trading.urbanlife.works",
                                   api_key="sk_...") as client:
            sig_id = await client.push_signal(signal)
    """

    def __init__(
        self,
        base_url: str,
        *,
        api_key: str | None = None,
        jwt: str | None = None,
    ) -> None:
        if not api_key and not jwt:
            raise ValueError("Either api_key or jwt must be provided")
        self._base_url = base_url.rstrip("/")
        self._api_key = api_key
        self._jwt = jwt
        self._client: Any = None

    async def __aenter__(self) -> ResearchClient:
        try:
            import httpx
        except ImportError as exc:
            raise ImportError("httpx is required: pip install httpx") from exc
        self._client = httpx.AsyncClient(
            base_url=self._base_url,
            headers={"Authorization": f"Bearer {self._api_key or self._jwt}"},
            timeout=10.0,
        )
        return self

    async def __aexit__(self, *_: object) -> None:
        if self._client:
            await self._client.aclose()

    async def _request(self, method: str, path: str, **kwargs: Any) -> Any:
        resp = await self._client.request(method, path, **kwargs)
        if resp.status_code >= 400:
            raise ResearchClientError(resp.status_code, resp.text)
        return resp.json()

    async def health(self) -> dict[str, Any]:
        return await self._request("GET", "/research/health")

    async def push_signal(self, signal: Signal) -> str:
        """Push a signal. Returns the created signal ID."""
        payload: dict[str, Any] = {
            "instrument_key": signal.instrument_key,
            "score": float(signal.score),
            "horizon": signal.horizon.value,
            "source": signal.source,
        }
        if signal.payload:
            payload["payload"] = signal.payload
        if signal.expires_at:
            payload["expires_at"] = signal.expires_at.isoformat()
        data = await self._request("POST", "/research/signals", json=payload)
        return data["id"]

    async def list_signals(
        self,
        *,
        instrument_key: str | None = None,
        source: str | None = None,
        horizon: str | None = None,
        limit: int = 50,
    ) -> list[dict[str, Any]]:
        params: dict[str, Any] = {"limit": limit}
        if instrument_key:
            params["instrument_key"] = instrument_key
        if source:
            params["source"] = source
        if horizon:
            params["horizon"] = horizon
        return await self._request("GET", "/research/signals", params=params)

    async def push_evaluation(self, evaluation: Evaluation) -> str:
        """Push an evaluation. Returns the created evaluation ID."""
        payload: dict[str, Any] = {
            "instrument_key": evaluation.instrument_key,
            "verdict": evaluation.verdict.value,
            "confidence": float(evaluation.confidence),
        }
        if evaluation.rationale:
            payload["rationale"] = evaluation.rationale
        if evaluation.model:
            payload["model"] = evaluation.model
        if evaluation.signal_id:
            payload["signal_id"] = evaluation.signal_id
        data = await self._request("POST", "/research/evaluations", json=payload)
        return data["id"]

    async def list_evaluations(
        self,
        *,
        instrument_key: str | None = None,
        verdict: str | None = None,
        limit: int = 50,
    ) -> list[dict[str, Any]]:
        params: dict[str, Any] = {"limit": limit}
        if instrument_key:
            params["instrument_key"] = instrument_key
        if verdict:
            params["verdict"] = verdict
        return await self._request("GET", "/research/evaluations", params=params)

    async def upsert_instrument(self, instrument: ResearchInstrument) -> dict[str, Any]:
        payload = {
            "symbol": instrument.symbol,
            "mic": instrument.mic,
            "asset_class": instrument.asset_class,
            "currency": instrument.currency,
        }
        if instrument.name:
            payload["name"] = instrument.name
        return await self._request("POST", "/research/instruments", json=payload)

    async def list_instruments(self, *, tracked: bool = True) -> list[dict[str, Any]]:
        params = {"tracked": "true" if tracked else "false"}
        return await self._request("GET", "/research/instruments", params=params)

    async def portfolio_context(self) -> dict[str, Any]:
        return await self._request("GET", "/research/portfolio-context")
