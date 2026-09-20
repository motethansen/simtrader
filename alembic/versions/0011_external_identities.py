"""rename bridge_jwt_identities to external_identities

Revision ID: e5f6a1b2c3d5
Revises: d4e5f6a1b2c4
Create Date: 2026-09-20

ST-008/ST-b. The table is no longer about one bridge from urbanlife: it maps an external
identity provider's (iss, sub) onto a simtrader user, and BudgetApp is now the only one.
`provider` names the provider in a stable way that survives an issuer URL change; `name` holds
the display name the ID token carries, so the UI has something to show besides an email.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "e5f6a1b2c3d5"
down_revision: Union[str, None] = "d4e5f6a1b2c4"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.rename_table("bridge_jwt_identities", "external_identities")
    op.execute("ALTER INDEX idx_bridge_jwt_identities_user RENAME TO idx_external_identities_user")
    op.execute(
        "ALTER TABLE external_identities "
        "RENAME CONSTRAINT uq_bridge_jwt_identities_iss_sub TO uq_external_identities_iss_sub"
    )
    op.add_column(
        "external_identities",
        sa.Column("provider", sa.Text(), nullable=False, server_default="budgetapp"),
    )
    op.add_column("external_identities", sa.Column("name", sa.Text(), nullable=True))
    op.create_index("idx_external_identities_provider", "external_identities", ["provider"])


def downgrade() -> None:
    op.drop_index("idx_external_identities_provider", table_name="external_identities")
    op.drop_column("external_identities", "name")
    op.drop_column("external_identities", "provider")
    op.execute(
        "ALTER TABLE external_identities "
        "RENAME CONSTRAINT uq_external_identities_iss_sub TO uq_bridge_jwt_identities_iss_sub"
    )
    op.execute("ALTER INDEX idx_external_identities_user RENAME TO idx_bridge_jwt_identities_user")
    op.rename_table("external_identities", "bridge_jwt_identities")
