"""research_evaluations table

Revision ID: a1b2c3d4e5f7
Revises: f6a1b2c3d4e5
Create Date: 2026-09-20

Ported from src/tradingplatform/persistence/migrations/0013_research_evaluations.sql (M9a landed the SQL but no
runner ever applied it; ST-002 consolidated on Alembic).
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "a1b2c3d4e5f7"
down_revision: Union[str, None] = "f6a1b2c3d4e5"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "research_evaluations",
        sa.Column("id", sa.UUID(), server_default=sa.text("gen_random_uuid()"), primary_key=True),
        sa.Column("signal_id", sa.UUID(), sa.ForeignKey("research_signals.id", ondelete="SET NULL"), nullable=True),
        sa.Column("instrument_key", sa.Text(), nullable=False),
        sa.Column("verdict", sa.Text(), nullable=False),
        # 0.0 (none) .. 1.0 (certain)
        sa.Column("confidence", sa.Numeric(4, 3), nullable=False),
        sa.Column("rationale", sa.Text(), nullable=True),
        sa.Column("model", sa.Text(), nullable=True),
        sa.Column("api_key_id", sa.UUID(), sa.ForeignKey("engine_api_keys.id", ondelete="SET NULL"), nullable=True),
        sa.Column("bridge_sub", sa.Text(), nullable=True),
        sa.Column("created_at", sa.TIMESTAMP(timezone=True), nullable=False, server_default=sa.text("NOW()")),
        sa.CheckConstraint("verdict IN ('buy', 'sell', 'hold', 'watch')", name="ck_research_evaluations_verdict"),
        sa.CheckConstraint("confidence BETWEEN 0 AND 1", name="ck_research_evaluations_confidence"),
    )
    op.create_index("idx_research_evaluations_instrument", "research_evaluations", ["instrument_key", sa.text("created_at DESC")])
    op.create_index("idx_research_evaluations_signal", "research_evaluations", ["signal_id"])
    op.create_index("idx_research_evaluations_created", "research_evaluations", [sa.text("created_at DESC")])


def downgrade() -> None:
    op.drop_table("research_evaluations")
