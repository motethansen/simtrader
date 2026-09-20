"""bridge_jwt_identities table

Revision ID: c3d4e5f6a1b3
Revises: b2c3d4e5f6a2
Create Date: 2026-09-20

Ported from src/tradingplatform/persistence/migrations/0015_bridge_jwt_identities.sql (M9a landed the SQL but no
runner ever applied it; ST-002 consolidated on Alembic).
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "c3d4e5f6a1b3"
down_revision: Union[str, None] = "b2c3d4e5f6a2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "bridge_jwt_identities",
        sa.Column("id", sa.UUID(), server_default=sa.text("gen_random_uuid()"), primary_key=True),
        sa.Column("user_id", sa.UUID(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        # JWT issuer URL
        sa.Column("iss", sa.Text(), nullable=False),
        # JWT subject — the identity provider's user id
        sa.Column("sub", sa.Text(), nullable=False),
        # from JWT claims, informational only — never an account key
        sa.Column("email", sa.Text(), nullable=True),
        sa.Column("created_at", sa.TIMESTAMP(timezone=True), nullable=False, server_default=sa.text("NOW()")),
        sa.Column("last_seen_at", sa.TIMESTAMP(timezone=True), nullable=False, server_default=sa.text("NOW()")),
        sa.UniqueConstraint("iss", "sub", name="uq_bridge_jwt_identities_iss_sub"),
    )
    op.create_index("idx_bridge_jwt_identities_user", "bridge_jwt_identities", ["user_id"])


def downgrade() -> None:
    op.drop_table("bridge_jwt_identities")
