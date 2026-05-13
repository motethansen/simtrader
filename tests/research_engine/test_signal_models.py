"""Tests for research Signal and Evaluation Pydantic models (M9a)."""

import pytest
from decimal import Decimal
from pydantic import ValidationError

from tradingplatform.research.models import (
    Signal,
    Evaluation,
    ResearchInstrument,
    SignalHorizon,
    EvaluationVerdict,
    SignalActionRecord,
    SignalActionType,
)


# --- Signal ---

def test_signal_valid():
    s = Signal(instrument_key="AAPL:XNAS", score=Decimal("0.75"), horizon=SignalHorizon.ONE_WEEK, source="test:v1")
    assert s.symbol == "AAPL"
    assert s.mic == "XNAS"
    assert s.score == Decimal("0.75")


def test_signal_score_boundary_positive_one():
    s = Signal(instrument_key="SPY:ARCX", score=Decimal("1.0"), horizon=SignalHorizon.ONE_DAY, source="x")
    assert s.score == Decimal("1.0")


def test_signal_score_boundary_negative_one():
    s = Signal(instrument_key="SPY:ARCX", score=Decimal("-1.0"), horizon=SignalHorizon.ONE_DAY, source="x")
    assert s.score == Decimal("-1.0")


def test_signal_score_out_of_range_rejects():
    with pytest.raises(ValidationError):
        Signal(instrument_key="AAPL:XNAS", score=Decimal("1.5"), horizon=SignalHorizon.ONE_DAY, source="x")


def test_signal_score_below_minus_one_rejects():
    with pytest.raises(ValidationError):
        Signal(instrument_key="AAPL:XNAS", score=Decimal("-2.0"), horizon=SignalHorizon.ONE_DAY, source="x")


def test_signal_instrument_key_missing_colon_rejects():
    with pytest.raises(ValidationError):
        Signal(instrument_key="AAPL", score=Decimal("0.5"), horizon=SignalHorizon.ONE_DAY, source="x")


def test_signal_payload_optional():
    s = Signal(
        instrument_key="NVDA:XNAS",
        score=Decimal("0.3"),
        horizon=SignalHorizon.ONE_MONTH,
        source="test",
        payload={"pe_ratio": 45.2, "analyst_count": 30},
    )
    assert s.payload is not None
    assert s.payload["pe_ratio"] == 45.2


# --- Evaluation ---

def test_evaluation_valid():
    e = Evaluation(instrument_key="AAPL:XNAS", verdict=EvaluationVerdict.BUY, confidence=Decimal("0.85"))
    assert e.verdict == EvaluationVerdict.BUY


def test_evaluation_confidence_zero_allowed():
    e = Evaluation(instrument_key="X:Y", verdict=EvaluationVerdict.HOLD, confidence=Decimal("0.0"))
    assert e.confidence == Decimal("0.0")


def test_evaluation_confidence_above_one_rejects():
    with pytest.raises(ValidationError):
        Evaluation(instrument_key="X:Y", verdict=EvaluationVerdict.BUY, confidence=Decimal("1.1"))


def test_evaluation_invalid_verdict_rejects():
    with pytest.raises(ValidationError):
        Evaluation(instrument_key="X:Y", verdict="strong_buy", confidence=Decimal("0.5"))  # type: ignore


# --- ResearchInstrument ---

def test_research_instrument_key():
    ri = ResearchInstrument(symbol="EWA", mic="ARCX", currency="USD")
    assert ri.key == "EWA:ARCX"


# --- SignalActionRecord ---

def test_signal_action_record():
    a = SignalActionRecord(signal_id="abc-123", action=SignalActionType.ACKNOWLEDGED)
    assert a.action == SignalActionType.ACKNOWLEDGED


def test_signal_action_invalid_type():
    with pytest.raises(ValidationError):
        SignalActionRecord(signal_id="abc", action="maybe")  # type: ignore
