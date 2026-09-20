"""drop password_hash and the unique index on users.email

Revision ID: f6a1b2c3d4e6
Revises: e5f6a1b2c3d5
Create Date: 2026-09-20

ST-008/ST-d. simtrader has no password login, so there is no hash to store — one less
credential to protect.

The unique index goes because email stops being an identity key. Identity is (iss, sub).
simtrader only learns of an address change at the next sign-in, so its copy can be stale: if A
changes address and B later registers A's old one, B's first sign-in would either hit a unique
violation on a stale row, or attach to A's account. BudgetApp still enforces uniqueness at the
source. A plain index is kept for admin lookups.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "f6a1b2c3d4e6"
down_revision: Union[str, None] = "e5f6a1b2c3d5"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.drop_column("users", "password_hash")
    op.drop_index("ix_users_email", table_name="users")
    op.create_index("ix_users_email", "users", ["email"])


def downgrade() -> None:
    op.drop_index("ix_users_email", table_name="users")
    # Duplicate emails may exist by now, so the unique index can legitimately fail to rebuild.
    op.create_index("ix_users_email", "users", ["email"], unique=True)
    op.add_column(
        "users",
        sa.Column("password_hash", sa.Text(), nullable=False, server_default="disabled"),
    )
