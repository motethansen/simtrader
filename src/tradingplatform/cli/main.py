"""Typer CLI entrypoint — `tradingplatform <command>`."""

from __future__ import annotations

import hashlib
import os
from datetime import datetime, timedelta, timezone
from decimal import Decimal

import typer
from rich.console import Console
from rich.table import Table

from ..core import AssetClass, Instrument
from ..marketdata import SyntheticProvider
from ..simulation import BacktestEngine
from ..strategies import SmaCrossStrategy

app = typer.Typer(help="Trading platform CLI.")
console = Console()


@app.command()
def backtest(
    demo: bool = typer.Option(False, "--demo", help="Run a self-contained synthetic-data demo."),
    fast: int = 10,
    slow: int = 30,
) -> None:
    """Run a backtest. Without --demo this would load real bars (M1)."""
    if not demo:
        console.print(
            "[yellow]Non-demo backtest needs a CSV provider configured (M1). "
            "Use --demo for a self-contained smoke test.[/yellow]"
        )
        raise typer.Exit(code=1)

    instrument = Instrument(symbol="DEMO", mic="XNAS", currency="USD", asset_class=AssetClass.ETF)
    provider = SyntheticProvider(seed=7)
    end = datetime.now(timezone.utc).replace(tzinfo=None)
    start = end - timedelta(days=365)
    bars = list(provider.bars(instrument, start, end))

    engine = BacktestEngine(strategy=SmaCrossStrategy(fast=fast, slow=slow), instruments=[instrument])
    result = engine.run({instrument.key: bars})

    table = Table(title="Backtest result")
    table.add_column("Metric")
    table.add_column("Value", justify="right")
    table.add_row("Starting cash", f"{result.starting_cash:,.2f}")
    table.add_row("Final equity", f"{result.final_equity:,.2f}")
    table.add_row("Total return", f"{result.total_return * Decimal('100'):.2f}%")
    table.add_row("Orders", str(result.n_orders))
    table.add_row("Fills", str(result.n_fills))
    console.print(table)


@app.command()
def doctor() -> None:
    """Print env / config diagnostics. Useful before connecting to a broker."""
    from ..config import get_settings

    s = get_settings()
    console.print(f"mode: [bold]{s.mode}[/bold]")
    console.print(f"db: {s.db_url}")
    console.print(f"redis: {s.redis_url}")
    console.print(f"saxo base: {s.saxo_base_url}")
    console.print(f"ibkr: {s.ibkr_host}:{s.ibkr_port}")
    if s.mode == "live":
        console.print(
            "[red]MODE=live — orders will hit the real broker. "
            "You also need --i-understand-this-is-real-money on trade commands.[/red]"
        )


@app.command(name="seed-admin")
def seed_admin(
    budgetapp_id: str = typer.Option(
        ..., "--budgetapp-id", "-b", help="BudgetApp user id (the `sub` in its ID token)."
    ),
) -> None:
    """Promote an existing simtrader user to admin, by BudgetApp identity.

    simtrader has no passwords: every account is created by signing in through BudgetApp
    (ST-008). So this promotes rather than creates, and the person must have signed in at
    least once. Safe to run repeatedly. Refuses to run when TP_MODE=live.

    Admin pages additionally require that BudgetApp 2FA was used for the sign-in, so the
    promoted account needs 2FA turned on in BudgetApp before /admin will open.
    """
    from ..config import get_settings

    s = get_settings()
    if s.mode == "live":
        console.print("[red]Refusing to seed admin against a live database (TP_MODE=live).[/red]")
        raise typer.Exit(code=1)

    try:
        import psycopg  # type: ignore[import]
    except ImportError:
        console.print("[red]psycopg not installed. Run: pip install 'psycopg[binary]'[/red]")
        raise typer.Exit(code=1)

    # Convert SQLAlchemy URL to plain libpq URL
    db_url = s.db_url.replace("postgresql+psycopg://", "postgresql://")

    with psycopg.connect(db_url) as conn:
        row = conn.execute(
            """
            SELECT u.id, u.email, u.role
            FROM external_identities e
            JOIN users u ON u.id = e.user_id
            WHERE e.sub = %s
            """,
            (budgetapp_id,),
        ).fetchone()

        if row is None:
            console.print(
                f"[red]No simtrader user is linked to BudgetApp id {budgetapp_id!r}.[/red]"
            )
            console.print(
                "[dim]Ask them to open simtrader and sign in with BudgetApp once, then re-run.[/dim]"
            )
            raise typer.Exit(code=1)

        user_id, email, role = row
        if role == "admin":
            console.print(f"[yellow]{email} is already an admin — nothing to do.[/yellow]")
            return

        conn.execute(
            "UPDATE users SET role = 'admin', updated_at = NOW() WHERE id = %s", (user_id,)
        )
        conn.execute(
            """
            INSERT INTO audit_log (actor_id, target_user_id, action, detail)
            VALUES (NULL, %s, 'user.role_change', %s)
            """,
            (user_id, '{"to": "admin", "via": "seed-admin"}'),
        )
        conn.commit()

    console.print(f"[green]{email} is now an admin.[/green]")
    console.print("[dim]They must have 2FA enabled in BudgetApp to open /admin.[/dim]")


if __name__ == "__main__":
    app()
