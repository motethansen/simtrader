"""engine_api_keys table

Revision ID: d4e5f6a1b2c3
Revises: c3d4e5f6a1b2
Create Date: 2026-09-20

Ported from src/tradingplatform/persistence/migrations/0010_engine_api_keys.sql (M9a landed the SQL but no
runner ever applied it; ST-002 consolidated on Alembic).
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import ARRAY

revision: str = "d4e5f6a1b2c3"
down_revision: Union[str, None] = "c3d4e5f6a1b2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "engine_api_keys",
        sa.Column("id", sa.UUID(), server_default=sa.text("gen_random_uuid()"), primary_key=True),
        sa.Column("name", sa.Text(), nullable=False),
        # SHA-256 hex of the raw key; the raw key is never stored
        sa.Column("key_hash", sa.Text(), nullable=False),
        # first 8 chars of the raw key, for display and lookup only
        sa.Column("key_prefix", sa.Text(), nullable=False),
        sa.Column("scopes", ARRAY(sa.Text()), nullable=False, server_default=sa.text("'{}'")),
        sa.Column("last_used_at", sa.TIMESTAMP(timezone=True), nullable=True),
        sa.Column("expires_at", sa.TIMESTAMP(timezone=True), nullable=True),
        sa.Column("created_at", sa.TIMESTAMP(timezone=True), nullable=False, server_default=sa.text("NOW()")),
        sa.Column("revoked_at", sa.TIMESTAMP(timezone=True), nullable=True),
    )
    op.create_index("idx_engine_api_keys_hash", "engine_api_keys", ["key_hash"], unique=True)
    op.create_index("idx_engine_api_keys_prefix", "engine_api_keys", ["key_prefix"])


def downgrade() -> None:
    op.drop_table("engine_api_keys")
