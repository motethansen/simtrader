from decimal import Decimal

import pytest

from tradingplatform.core import Instrument, Order, OrderSide, OrderType


def _ins() -> Instrument:
    return Instrument(symbol="AAPL", mic="XNAS", currency="USD")


def test_market_order_defaults_are_valid():
    o = Order(instrument=_ins(), side=OrderSide.BUY, qty=Decimal("10"))
    assert o.order_type == OrderType.MARKET
    assert o.remaining_qty == Decimal("10")
    assert not o.is_terminal


def test_limit_order_requires_limit_price():
    with pytest.raises(ValueError):
        Order(
            instrument=_ins(),
            side=OrderSide.BUY,
            qty=Decimal("10"),
            order_type=OrderType.LIMIT,
        )


def test_qty_must_be_positive():
    with pytest.raises(ValueError):
        Order(instrument=_ins(), side=OrderSide.BUY, qty=Decimal("0"))
