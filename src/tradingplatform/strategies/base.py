"""Strategy protocol + execution context."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Protocol

from ..core import Bar, Fill, Position, Signal


@dataclass
class Context:
    """Read-only-ish view passed to strategies.

    Strategies should treat `positions` as a snapshot — mutating it has no
    effect; positions are owned by the OMS / portfolio tracker.
    """

    positions: dict[str, Position] = field(default_factory=dict)
    metadata: dict[str, str] = field(default_factory=dict)


class Strategy(Protocol):
    id: str

    def on_bar(self, bar: Bar, ctx: Context) -> list[Signal]: ...
    def on_fill(self, fill: Fill, ctx: Context) -> None: ...
