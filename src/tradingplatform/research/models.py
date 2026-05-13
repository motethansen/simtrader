"""Pydantic v2 models for the research push/pull surface (M9a)."""

from __future__ import annotations

from decimal import Decimal
from enum import Enum
from typing import Any
from datetime import datetime

from pydantic import BaseModel, Field, field_validator


class SignalHorizon(str, Enum):
    ONE_DAY = "1d"
    ONE_WEEK = "1w"
    ONE_MONTH = "1m"
    THREE_MONTHS = "3m"


class EvaluationVerdict(str, Enum):
    BUY = "buy"
    SELL = "sell"
    HOLD = "hold"
    WATCH = "watch"


class SignalActionType(str, Enum):
    ACKNOWLEDGED = "acknowledged"
    DISMISSED = "dismissed"
    QUEUED = "queued"
    EXECUTED = "executed"


class Signal(BaseModel):
    """A research signal pushed by the AI engine."""

    instrument_key: str = Field(..., description="symbol:mic composite key")
    score: Decimal = Field(..., description="Signal strength: -1.0 (strong short) to +1.0 (strong long)")
    horizon: SignalHorizon
    source: str = Field(..., min_length=1, description="Engine identifier, e.g. 'ai_stock_advisor:v1'")
    payload: dict[str, Any] | None = None
    expires_at: datetime | None = None

    @field_validator("score")
    @classmethod
    def score_in_range(cls, v: Decimal) -> Decimal:
        if v < Decimal("-1") or v > Decimal("1"):
            raise ValueError("score must be between -1 and 1")
        return v

    @field_validator("instrument_key")
    @classmethod
    def instrument_key_format(cls, v: str) -> str:
        if ":" not in v:
            raise ValueError("instrument_key must be symbol:mic (e.g. AAPL:XNAS)")
        return v

    @property
    def symbol(self) -> str:
        return self.instrument_key.split(":")[0]

    @property
    def mic(self) -> str:
        return self.instrument_key.split(":")[1]


class SignalResponse(Signal):
    """Signal as returned from the API (includes server-assigned fields)."""

    id: str
    api_key_id: str | None = None
    bridge_sub: str | None = None
    created_at: datetime


class Evaluation(BaseModel):
    """An AI-driven evaluation of an instrument."""

    instrument_key: str
    verdict: EvaluationVerdict
    confidence: Decimal = Field(..., description="Confidence level: 0.0 to 1.0")
    rationale: str | None = None
    model: str | None = None
    signal_id: str | None = None

    @field_validator("confidence")
    @classmethod
    def confidence_in_range(cls, v: Decimal) -> Decimal:
        if v < Decimal("0") or v > Decimal("1"):
            raise ValueError("confidence must be between 0 and 1")
        return v


class EvaluationResponse(Evaluation):
    """Evaluation as returned from the API."""

    id: str
    api_key_id: str | None = None
    bridge_sub: str | None = None
    created_at: datetime


class ResearchInstrument(BaseModel):
    """An instrument registered in the research tracker."""

    symbol: str
    mic: str
    name: str | None = None
    asset_class: str = "equity"
    currency: str = "USD"
    tracked: bool = True

    @property
    def key(self) -> str:
        return f"{self.symbol}:{self.mic}"


class SignalActionRecord(BaseModel):
    """A user action taken on a signal."""

    signal_id: str
    action: SignalActionType
    detail: dict[str, Any] | None = None
