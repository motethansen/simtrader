"""Research / Evaluator Agent — Phase 3 stub.

Given a universe and a brief, the evaluator scores instruments on a configurable
signal stack and proposes a strategy. It NEVER places orders — its output is a
report + a `Plan` config that a human (or the executor, after gating) consumes.

Pluggable signals
-----------------
- Momentum (n-day return, volatility-adjusted)
- Mean-reversion (z-score vs N-day mean)
- Quality / fundamentals (ROE, debt/equity) — needs paid data
- Sentiment / news — needs LLM + news source

Wire to Anthropic API for LLM-driven scoring in M6.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from decimal import Decimal

from ..core import Instrument, Plan


@dataclass
class EvaluatorBrief:
    universe: list[Instrument]
    objective: str = "long-only momentum"
    horizon_days: int = 21
    max_positions: int = 10


@dataclass
class EvaluatorAgent:
    """Skeleton — to be implemented in M6."""

    brief: EvaluatorBrief
    notes: list[str] = field(default_factory=list)

    async def evaluate(self) -> Plan:
        """Return a target plan. Currently equal-weight as a baseline."""
        if not self.brief.universe:
            return Plan(plan_id="empty", mode="weights", targets={})
        weight = Decimal("1") / Decimal(len(self.brief.universe))
        targets = {ins.key: weight for ins in self.brief.universe}
        self.notes.append(
            f"baseline equal-weight across {len(self.brief.universe)} instruments"
        )
        return Plan(
            plan_id="evaluator-baseline",
            mode="weights",
            targets=targets,
            notes="Phase 3 baseline — replace with signal-stack output",
        )
