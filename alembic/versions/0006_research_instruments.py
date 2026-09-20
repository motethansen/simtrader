"""research_instruments table

Revision ID: f6a1b2c3d4e5
Revises: e5f6a1b2c3d4
Create Date: 2026-09-20

Ported from src/tradingplatform/persistence/migrations/0012_research_instruments.sql (M9a landed the SQL but no
runner ever applied it; ST-002 consolidated on Alembic).
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "f6a1b2c3d4e5"
down_revision: Union[str, None] = "e5f6a1b2c3d4"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "research_instruments",
        sa.Column("id", sa.UUID(), server_default=sa.text("gen_random_uuid()"), primary_key=True),
        sa.Column("symbol", sa.Text(), nullable=False),
        sa.Column("mic", sa.Text(), nullable=False),
        sa.Column("name", sa.Text(), nullable=True),
        sa.Column("asset_class", sa.Text(), nullable=False, server_default="equity"),
        sa.Column("currency", sa.Text(), nullable=False, server_default="USD"),
        sa.Column("tracked", sa.Boolean(), nullable=False, server_default=sa.text("TRUE")),
        sa.Column("created_at", sa.TIMESTAMP(timezone=True), nullable=False, server_default=sa.text("NOW()")),
        sa.Column("updated_at", sa.TIMESTAMP(timezone=True), nullable=False, server_default=sa.text("NOW()")),
        sa.UniqueConstraint("symbol", "mic", name="uq_research_instruments_key"),
    )
    op.create_index("idx_research_instruments_tracked", "research_instruments", ["tracked", "symbol"])


def downgrade() -> None:
    op.drop_table("research_instruments")
