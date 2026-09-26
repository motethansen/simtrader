"""portfolios and holdings

Revision ID: a1b2c3d4e5f8
Revises: f6a1b2c3d4e6
Create Date: 2026-09-26

W3 / ST-015. The first thing a member can do in simtrader on their own: record a portfolio and
what is in it. No prices and no simulation yet — W4 reads prices through the Saxo proxy, W5 and W6
simulate — so this is deliberately just state.

Two decisions worth keeping:

**Numeric, never float.** `units` and `avg_cost` are NUMERIC and the Worker passes them as
strings. A holding of 0.1 units at 33.33 is exact here and is not after one round trip through an
IEEE double, and money that drifts in the third decimal is money nobody can reconcile against
their broker.

**Cascades from `users`, on purpose.** ST-f erases a member with `DELETE FROM users` and BudgetApp
refuses the account deletion until simtrader acknowledges it. A portfolio row that outlived its
owner would make that acknowledgement a lie, so `portfolios.user_id` and `holdings.portfolio_id`
both cascade. Anything added later that hangs off a member must do the same.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "a1b2c3d4e5f8"
down_revision: Union[str, None] = "f6a1b2c3d4e6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "portfolios",
        sa.Column("id", sa.UUID(), server_default=sa.text("gen_random_uuid()"), primary_key=True),
        sa.Column(
            "user_id",
            sa.UUID(),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("base_currency", sa.Text(), nullable=False, server_default="USD"),
        sa.Column("starting_cash", sa.Numeric(18, 2), nullable=False, server_default="0"),
        sa.Column(
            "created_at",
            sa.TIMESTAMP(timezone=True),
            nullable=False,
            server_default=sa.text("NOW()"),
        ),
        sa.Column(
            "updated_at",
            sa.TIMESTAMP(timezone=True),
            nullable=False,
            server_default=sa.text("NOW()"),
        ),
    )
    op.create_check_constraint(
        "ck_portfolios_name_not_blank", "portfolios", "length(btrim(name)) > 0"
    )
    op.create_check_constraint(
        "ck_portfolios_base_currency", "portfolios", "base_currency ~ '^[A-Z]{3}$'"
    )
    op.create_check_constraint("ck_portfolios_starting_cash", "portfolios", "starting_cash >= 0")
    # One member cannot have two portfolios of the same name — they would be indistinguishable in
    # every list. Case-insensitive, because "Retirement" and "retirement" are the same mistake.
    op.create_index(
        "uq_portfolios_user_name",
        "portfolios",
        ["user_id", sa.text("lower(name)")],
        unique=True,
    )

    op.create_table(
        "holdings",
        sa.Column("id", sa.UUID(), server_default=sa.text("gen_random_uuid()"), primary_key=True),
        sa.Column(
            "portfolio_id",
            sa.UUID(),
            sa.ForeignKey("portfolios.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("symbol", sa.Text(), nullable=False),
        # ISO 10383 market identifier code. `Instrument.key` is f"{symbol}:{mic}" in the engine,
        # so a holding is only identified by the pair — AAPL on XNAS is not AAPL on XFRA.
        sa.Column("mic", sa.Text(), nullable=False),
        sa.Column("units", sa.Numeric(24, 8), nullable=False),
        sa.Column("avg_cost", sa.Numeric(24, 8), nullable=False),
        sa.Column("currency", sa.Text(), nullable=False),
        sa.Column(
            "created_at",
            sa.TIMESTAMP(timezone=True),
            nullable=False,
            server_default=sa.text("NOW()"),
        ),
        sa.Column(
            "updated_at",
            sa.TIMESTAMP(timezone=True),
            nullable=False,
            server_default=sa.text("NOW()"),
        ),
    )
    op.create_check_constraint("ck_holdings_symbol", "holdings", "symbol ~ '^[A-Z0-9.\\-]{1,20}$'")
    op.create_check_constraint("ck_holdings_mic", "holdings", "mic ~ '^[A-Z0-9]{4}$'")
    op.create_check_constraint("ck_holdings_currency", "holdings", "currency ~ '^[A-Z]{3}$'")
    # Long-only for now: the engine carries signed Position.qty, but a member typing a negative
    # number into an upload is far more likely to have made a mistake than to be short.
    op.create_check_constraint("ck_holdings_units_positive", "holdings", "units > 0")
    op.create_check_constraint("ck_holdings_avg_cost", "holdings", "avg_cost >= 0")
    # One row per instrument per portfolio, so a re-upload updates rather than duplicates.
    op.create_index(
        "uq_holdings_portfolio_instrument",
        "holdings",
        ["portfolio_id", "symbol", "mic"],
        unique=True,
    )
    op.create_index("ix_holdings_portfolio", "holdings", ["portfolio_id"])


def downgrade() -> None:
    op.drop_table("holdings")
    op.drop_table("portfolios")
