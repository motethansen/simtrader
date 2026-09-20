"""signal_actions table

Revision ID: b2c3d4e5f6a2
Revises: a1b2c3d4e5f7
Create Date: 2026-09-20

Ported from src/tradingplatform/persistence/migrations/0014_signal_actions.sql (M9a landed the SQL but no
runner ever applied it; ST-002 consolidated on Alembic).
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision: str = "b2c3d4e5f6a2"
down_revision: Union[str, None] = "a1b2c3d4e5f7"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "signal_actions",
        sa.Column("id", sa.UUID(), server_default=sa.text("gen_random_uuid()"), primary_key=True),
        sa.Column("signal_id", sa.UUID(), sa.ForeignKey("research_signals.id", ondelete="CASCADE"), nullable=False),
        sa.Column("user_id", sa.UUID(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("action", sa.Text(), nullable=False),
        sa.Column("detail", JSONB(), nullable=True),
        sa.Column("created_at", sa.TIMESTAMP(timezone=True), nullable=False, server_default=sa.text("NOW()")),
        sa.CheckConstraint(
            "action IN ('acknowledged', 'dismissed', 'queued', 'executed')",
            name="ck_signal_actions_action",
        ),
    )
    op.create_index("idx_signal_actions_signal", "signal_actions", ["signal_id"])
    op.create_index("idx_signal_actions_user", "signal_actions", ["user_id", sa.text("created_at DESC")])


def downgrade() -> None:
    op.drop_table("signal_actions")
