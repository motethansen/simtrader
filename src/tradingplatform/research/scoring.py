"""Pure scoring utilities for the research engine (M9a).

These are stateless functions used by the evaluator agent to compute signal
scores from price history. No DB or HTTP calls — fully testable in isolation.
"""

from __future__ import annotations

from decimal import Decimal


def momentum_score(returns: list[float], vol_adjust: bool = True) -> Decimal:
    """Compute a momentum signal score in [-1, 1] from a series of returns.

    Args:
        returns: Sequence of period returns (e.g. daily log returns), most recent last.
        vol_adjust: If True, divide raw momentum by realised volatility.

    Returns:
        Score clamped to [-1, 1]; positive = bullish momentum.
    """
    if not returns:
        return Decimal("0")

    total = sum(returns)

    if vol_adjust and len(returns) > 1:
        mean = total / len(returns)
        variance = sum((r - mean) ** 2 for r in returns) / (len(returns) - 1)
        vol = variance ** 0.5
        if vol == 0:
            return Decimal("0")
        raw = total / (vol * (len(returns) ** 0.5))
    else:
        raw = total

    # Sigmoid-style clamp to [-1, 1]
    clamped = max(-1.0, min(1.0, raw))
    # Round to 4 decimal places to match DB NUMERIC(6,4)
    return Decimal(str(round(clamped, 4)))


def zscore_mean_reversion(prices: list[float], window: int = 20) -> Decimal:
    """Compute a mean-reversion score from a price series.

    A high z-score means the price is above its rolling mean → bearish (sell signal).
    The score is sign-flipped so that positive = bullish (price below mean → expect reversion up).

    Args:
        prices: Price series, most recent last.
        window: Rolling window for mean and std computation.

    Returns:
        Score in [-1, 1].
    """
    if len(prices) < 2:
        return Decimal("0")

    lookback = prices[-window:] if len(prices) >= window else prices
    mean = sum(lookback) / len(lookback)
    variance = sum((p - mean) ** 2 for p in lookback) / len(lookback)
    std = variance ** 0.5

    if std == 0:
        return Decimal("0")

    last_price = prices[-1]
    z = (last_price - mean) / std

    # Invert: price far above mean → negative score (reversion down expected)
    raw = -z / 3.0  # /3 so ±3σ maps to ±1
    clamped = max(-1.0, min(1.0, raw))
    return Decimal(str(round(clamped, 4)))
