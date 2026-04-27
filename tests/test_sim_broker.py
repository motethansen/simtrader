from datetime import datetime, timezone
from decimal import Decimal

import pytest

from tradingplatform.brokers.sim import SimBroker, SimConfig
from tradingplatform.core import Instrument, Order, OrderSide, OrderStatus, OrderType, Quote


def _ins() -> Instrument:
    return Instrument(symbol="AAPL", mic="XNAS", currency="USD")


@pytest.mark.asyncio
async def test_market_order_fills_at_next_tick_with_slippage():
    sim = SimBroker(config=SimConfig(slippage_bps=Decimal("10"), starting_cash=Decimal("100000")))
    order = Order(
        instrument=_ins(),
        side=OrderSide.BUY,
        qty=Decimal("100"),
        order_type=OrderType.MARKET,
        mode="backtest",
    )
    await sim.place_order(order)
    fills = sim.tick(
        Quote(instrument=_ins(), ts=datetime.now(timezone.utc), last=Decimal("100"))
    )
    assert len(fills) == 1
    f = fills[0]
    # 10bps slippage on a buy => fill at 100.10
    assert f.price == Decimal("100.10")
    assert order.status == OrderStatus.FILLED
    # Cash debited by qty * fill_price
    acct = await sim.get_account()
    assert acct.cash["USD"] == Decimal("100000") - Decimal("100") * Decimal("100.10")


@pytest.mark.asyncio
async def test_limit_order_does_not_fill_above_limit():
    sim = SimBroker(config=SimConfig(slippage_bps=Decimal("0")))
    order = Order(
        instrument=_ins(),
        side=OrderSide.BUY,
        qty=Decimal("10"),
        order_type=OrderType.LIMIT,
        limit_price=Decimal("99"),
        mode="backtest",
    )
    await sim.place_order(order)
    fills = sim.tick(
        Quote(instrument=_ins(), ts=datetime.now(timezone.utc), last=Decimal("100"))
    )
    assert fills == []
    assert order.status == OrderStatus.SENT

    fills = sim.tick(
        Quote(instrument=_ins(), ts=datetime.now(timezone.utc), last=Decimal("98"))
    )
    assert len(fills) == 1
    assert fills[0].price == Decimal("99")


@pytest.mark.asyncio
async def test_partial_fills_with_max_qty_per_bar():
    sim = SimBroker(
        config=SimConfig(slippage_bps=Decimal("0"), max_qty_per_bar=Decimal("3"))
    )
    order = Order(
        instrument=_ins(),
        side=OrderSide.BUY,
        qty=Decimal("10"),
        order_type=OrderType.MARKET,
        mode="backtest",
    )
    await sim.place_order(order)

    qtys = []
    for _ in range(5):
        fills = sim.tick(
            Quote(instrument=_ins(), ts=datetime.now(timezone.utc), last=Decimal("100"))
        )
        if fills:
            qtys.append(fills[0].qty)
    assert sum(qtys) == Decimal("10")
    assert order.status == OrderStatus.FILLED


@pytest.mark.asyncio
async def test_mode_mismatch_rejected():
    sim = SimBroker()  # mode=backtest by default
    order = Order(
        instrument=_ins(),
        side=OrderSide.BUY,
        qty=Decimal("1"),
        mode="paper",  # mismatch
    )
    with pytest.raises(ValueError):
        await sim.place_order(order)
