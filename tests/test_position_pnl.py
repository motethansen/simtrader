from decimal import Decimal

from tradingplatform.core import Fill, Instrument, OrderSide, Position


def _ins() -> Instrument:
    return Instrument(symbol="AAPL", mic="XNAS", currency="USD")


def _fill(side: OrderSide, qty: str, price: str) -> Fill:
    return Fill(
        order_id="ord-1",
        instrument=_ins(),
        side=side,
        qty=Decimal(qty),
        price=Decimal(price),
    )


def test_open_long_then_close_for_profit():
    pos = Position(instrument=_ins())
    pos.apply(_fill(OrderSide.BUY, "10", "100"))
    assert pos.qty == Decimal("10")
    assert pos.avg_price == Decimal("100")

    pos.apply(_fill(OrderSide.SELL, "10", "110"))
    assert pos.qty == Decimal("0")
    assert pos.realised_pnl == Decimal("100")  # 10 shares * (110-100)


def test_average_in_then_partial_exit():
    pos = Position(instrument=_ins())
    pos.apply(_fill(OrderSide.BUY, "10", "100"))
    pos.apply(_fill(OrderSide.BUY, "10", "120"))
    assert pos.avg_price == Decimal("110")

    pos.apply(_fill(OrderSide.SELL, "5", "130"))
    assert pos.qty == Decimal("15")
    # 5 * (130 - 110) = 100
    assert pos.realised_pnl == Decimal("100")


def test_short_then_cover_for_profit():
    pos = Position(instrument=_ins())
    pos.apply(_fill(OrderSide.SELL, "10", "100"))
    assert pos.qty == Decimal("-10")
    assert pos.avg_price == Decimal("100")

    pos.apply(_fill(OrderSide.BUY, "10", "90"))
    assert pos.qty == Decimal("0")
    assert pos.realised_pnl == Decimal("100")  # short profited 10 per share
