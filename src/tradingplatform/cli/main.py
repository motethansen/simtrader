"""Typer CLI entrypoint — `tradingplatform <command>`."""

from __future__ import annotations

import hashlib
import os
import secrets
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
    email: str = typer.Option(..., "--email", "-e", help="Admin email address."),
    password: str = typer.Option(..., "--password", "-p", help="Admin password (min 12 chars)."),
) -> None:
    """Create the first admin user in the database.

    Safe to run multiple times — skips if the email already exists.
    Refuses to run when TP_MODE=live.
    """
    from ..config import get_settings

    s = get_settings()
    if s.mode == "live":
        console.print("[red]Refusing to seed admin against a live database (TP_MODE=live).[/red]")
        raise typer.Exit(code=1)

    if len(password) < 12:
        console.print("[red]Password must be at least 12 characters.[/red]")
        raise typer.Exit(code=1)

    password_hash = _hash_password(password)

    # Use plain psycopg3 (no SQLAlchemy ORM) to keep this self-contained.
    try:
        import psycopg  # type: ignore[import]
    except ImportError:
        console.print("[red]psycopg not installed. Run: pip install 'psycopg[binary]'[/red]")
        raise typer.Exit(code=1)

    # Convert SQLAlchemy URL to plain libpq URL
    db_url = s.db_url.replace("postgresql+psycopg://", "postgresql://")

    with psycopg.connect(db_url) as conn:
        existing = conn.execute("SELECT id FROM users WHERE email = %s", (email,)).fetchone()
        if existing:
            console.print(f"[yellow]User {email!r} already exists — skipping.[/yellow]")
            return

        conn.execute(
            """
            INSERT INTO users (email, password_hash, role, status, email_verified)
            VALUES (%s, %s, 'admin', 'active', true)
            """,
            (email, password_hash),
        )
        conn.commit()

    console.print(f"[green]Admin user created: {email}[/green]")
    console.print("[dim]Log in at /admin/login[/dim]")


def _hash_password(password: str) -> str:
    """PBKDF2-SHA256, 600k iterations. Compatible with the Workers implementation."""
    salt = secrets.token_bytes(16)
    dk = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, 600_000)
    return f"pbkdf2:{salt.hex()}:{dk.hex()}"


if __name__ == "__main__":
    app()
