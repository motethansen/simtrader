from decimal import Decimal

from tradingplatform.brokers.base import BrokerSession
from tradingplatform.core import Instrument, Order, OrderSide
from tradingplatform.risk import RiskEngine, RiskLimits


def _ins() -> Instrument:
    return Instrument(symbol="AAPL", mic="XNAS", currency="USD")


def test_mode_mismatch_blocked():
    eng = RiskEngine(limits=RiskLimits())
    order = Order(instrument=_ins(), side=OrderSide.BUY, qty=Decimal("1"), mode="live")
    res = eng.check(order, BrokerSession("sim", "backtest", "X"), positions={})
    assert not res.ok
    assert "mode mismatch" in res.reason


def test_max_qty_per_symbol_blocks_oversize():
    eng = RiskEngine(limits=RiskLimits(max_qty_per_symbol=Decimal("100")))
    order = Order(
        instrument=_ins(), side=OrderSide.BUY, qty=Decimal("101"), mode="backtest"
    )
    res = eng.check(order, BrokerSession("sim", "backtest", "X"), positions={})
    assert not res.ok
