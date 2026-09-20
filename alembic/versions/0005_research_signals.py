"""research_signals table

Revision ID: e5f6a1b2c3d4
Revises: d4e5f6a1b2c3
Create Date: 2026-09-20

Ported from src/tradingplatform/persistence/migrations/0011_research_signals.sql (M9a landed the SQL but no
runner ever applied it; ST-002 consolidated on Alembic).
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision: str = "e5f6a1b2c3d4"
down_revision: Union[str, None] = "d4e5f6a1b2c3"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "research_signals",
        sa.Column("id", sa.UUID(), server_default=sa.text("gen_random_uuid()"), primary_key=True),
        # symbol:mic composite key
        sa.Column("instrument_key", sa.Text(), nullable=False),
        sa.Column("symbol", sa.Text(), nullable=False),
        sa.Column("mic", sa.Text(), nullable=False),
        # +1.0 = strong long, -1.0 = strong short, 0 = neutral
        sa.Column("score", sa.Numeric(6, 4), nullable=False),
        sa.Column("horizon", sa.Text(), nullable=False),
        # e.g. 'ai_stock_advisor:v1'
        sa.Column("source", sa.Text(), nullable=False),
        sa.Column("payload", JSONB(), nullable=True),
        sa.Column("api_key_id", sa.UUID(), sa.ForeignKey("engine_api_keys.id", ondelete="SET NULL"), nullable=True),
        # external SSO subject when JWT auth was used
        sa.Column("bridge_sub", sa.Text(), nullable=True),
        sa.Column("expires_at", sa.TIMESTAMP(timezone=True), nullable=True),
        sa.Column("created_at", sa.TIMESTAMP(timezone=True), nullable=False, server_default=sa.text("NOW()")),
        sa.CheckConstraint("score BETWEEN -1 AND 1", name="ck_research_signals_score"),
        sa.CheckConstraint("horizon IN ('1d', '1w', '1m', '3m')", name="ck_research_signals_horizon"),
    )
    op.create_index("idx_research_signals_instrument", "research_signals", ["instrument_key", sa.text("created_at DESC")])
    op.create_index("idx_research_signals_created", "research_signals", [sa.text("created_at DESC")])
    op.create_index("idx_research_signals_source", "research_signals", ["source", sa.text("created_at DESC")])


def downgrade() -> None:
    op.drop_table("research_signals")
