"""Research engine — push/pull surface for AI_stock_advisor (M9a).

Provides:
- Pydantic models for signals, evaluations, and instruments
- ResearchClient: async HTTP client for the Worker research API
- Pure scoring utilities (momentum, z-score) used by the evaluator agent
"""

from .models import Signal, Evaluation, ResearchInstrument, SignalActionRecord
from .client import ResearchClient
from .scoring import momentum_score, zscore_mean_reversion

__all__ = [
    "Signal",
    "Evaluation",
    "ResearchInstrument",
    "SignalActionRecord",
    "ResearchClient",
    "momentum_score",
    "zscore_mean_reversion",
]
