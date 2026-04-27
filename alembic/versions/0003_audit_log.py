"""audit_log table

Revision ID: c3d4e5f6a1b2
Revises: b2c3d4e5f6a1
Create Date: 2026-04-27

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import INET, JSONB

revision: str = "c3d4e5f6a1b2"
down_revision: Union[str, None] = "b2c3d4e5f6a1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "audit_log",
        sa.Column("id", sa.UUID(), server_default=sa.text("gen_random_uuid()"), primary_key=True),
        # actor_id is NULL for system/cron actions
        sa.Column("actor_id", sa.UUID(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("target_user_id", sa.UUID(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("action", sa.Text(), nullable=False),
        sa.Column("detail", JSONB(), nullable=True),
        sa.Column("ip_address", INET(), nullable=True),
        sa.Column("ts", sa.TIMESTAMP(timezone=True), nullable=False, server_default=sa.text("NOW()")),
    )
    op.create_index("ix_audit_actor_ts", "audit_log", ["actor_id", sa.text("ts DESC")])
    op.create_index("ix_audit_target_ts", "audit_log", ["target_user_id", sa.text("ts DESC")])
    op.create_index("ix_audit_action_ts", "audit_log", ["action", sa.text("ts DESC")])
    op.create_index("ix_audit_ts", "audit_log", [sa.text("ts DESC")])

    # Enforce append-only: revoke UPDATE and DELETE from the application role.
    # Run these manually if the tp_worker role exists, or add to your provisioning script.
    # op.execute("REVOKE UPDATE, DELETE ON audit_log FROM tp_worker")


def downgrade() -> None:
    op.drop_table("audit_log")
