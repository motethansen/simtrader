"""Tests for research scoring utilities (M9a)."""

from decimal import Decimal
import pytest

from tradingplatform.research.scoring import momentum_score, zscore_mean_reversion


# --- momentum_score ---

def test_momentum_empty_returns_zero():
    assert momentum_score([]) == Decimal("0")


def test_momentum_single_positive_return():
    score = momentum_score([0.05], vol_adjust=False)
    assert score > Decimal("0")


def test_momentum_single_negative_return():
    score = momentum_score([-0.05], vol_adjust=False)
    assert score < Decimal("0")


def test_momentum_score_clamped_to_one():
    # Extreme positive returns should clamp to +1
    score = momentum_score([1.0, 1.0, 1.0, 1.0, 1.0], vol_adjust=False)
    assert score == Decimal("1.0")


def test_momentum_score_clamped_to_minus_one():
    score = momentum_score([-1.0, -1.0, -1.0, -1.0, -1.0], vol_adjust=False)
    assert score == Decimal("-1.0")


def test_momentum_vol_adjust_mixed():
    # High-vol series should produce a lower absolute score than low-vol same mean.
    # Both series have a positive total, but the stable one has much lower vol,
    # so its vol-adjusted score (Sharpe-like) is higher.
    returns_stable = [0.01, 0.011, 0.009, 0.010, 0.012]      # ~0.052 total, very low vol
    returns_volatile = [0.05, -0.03, 0.04, -0.02, 0.012]     # ~0.052 total, high vol

    score_stable = momentum_score(returns_stable, vol_adjust=True)
    score_volatile = momentum_score(returns_volatile, vol_adjust=True)
    # Same total return, higher vol → lower score
    assert score_stable > score_volatile


def test_momentum_score_range():
    import random
    rng = random.Random(42)
    for _ in range(50):
        returns = [rng.gauss(0, 0.02) for _ in range(20)]
        score = momentum_score(returns, vol_adjust=True)
        assert Decimal("-1") <= score <= Decimal("1"), f"out of range: {score}"


# --- zscore_mean_reversion ---

def test_zscore_empty_series():
    assert zscore_mean_reversion([]) == Decimal("0")


def test_zscore_single_price():
    assert zscore_mean_reversion([100.0]) == Decimal("0")


def test_zscore_flat_series_returns_zero():
    prices = [100.0] * 20
    assert zscore_mean_reversion(prices) == Decimal("0")


def test_zscore_price_above_mean_negative_score():
    # Price well above its rolling mean → bearish → negative score
    prices = [100.0] * 19 + [130.0]
    score = zscore_mean_reversion(prices)
    assert score < Decimal("0")


def test_zscore_price_below_mean_positive_score():
    # Price well below its rolling mean → bullish mean-reversion → positive score
    prices = [100.0] * 19 + [70.0]
    score = zscore_mean_reversion(prices)
    assert score > Decimal("0")


def test_zscore_range():
    import random
    rng = random.Random(99)
    prices = [100 + rng.gauss(0, 5) for _ in range(50)]
    score = zscore_mean_reversion(prices, window=20)
    assert Decimal("-1") <= score <= Decimal("1"), f"out of range: {score}"
