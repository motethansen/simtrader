"""End-to-end smoke test — the same path the `tradingplatform backtest --demo` CLI uses."""

from datetime import datetime, timedelta, timezone

from tradingplatform.core import AssetClass, Instrument
from tradingplatform.marketdata import SyntheticProvider
from tradingplatform.simulation import BacktestEngine
from tradingplatform.strategies import SmaCrossStrategy


def test_backtest_runs_and_produces_an_equity_curve():
    instrument = Instrument(symbol="DEMO", mic="XNAS", currency="USD", asset_class=AssetClass.ETF)
    provider = SyntheticProvider(seed=11)
    end = datetime.now(timezone.utc).replace(tzinfo=None)
    start = end - timedelta(days=200)
    bars = list(provider.bars(instrument, start, end))

    engine = BacktestEngine(strategy=SmaCrossStrategy(fast=5, slow=20), instruments=[instrument])
    result = engine.run({instrument.key: bars})

    assert len(result.equity_curve) == len(bars)
    # The synthetic data + strategy should cause at least a couple of orders.
    assert result.n_orders >= 1
    assert result.n_fills >= 1
    # No catastrophic blowup.
    assert result.final_equity > 0
