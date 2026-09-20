"""audit_log append-only grants

Revision ID: d4e5f6a1b2c4
Revises: c3d4e5f6a1b3
Create Date: 2026-09-20

Ported from src/tradingplatform/persistence/migrations/(new) (M9a landed the SQL but no
runner ever applied it; ST-002 consolidated on Alembic).
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "d4e5f6a1b2c4"
down_revision: Union[str, None] = "c3d4e5f6a1b3"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# CLAUDE.md: audit_log is append-only — the application role may INSERT and SELECT, never
# UPDATE or DELETE. 0003 left this as a comment naming a role that was never created.
APP_ROLE = "simtrader_app"


def upgrade() -> None:
    op.execute(
        f"""
        DO $$
        BEGIN
            IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '{APP_ROLE}') THEN
                REVOKE UPDATE, DELETE ON audit_log FROM {APP_ROLE};
                GRANT SELECT, INSERT ON audit_log TO {APP_ROLE};
            END IF;
        END
        $$;
        """
    )


def downgrade() -> None:
    op.execute(
        f"""
        DO $$
        BEGIN
            IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '{APP_ROLE}') THEN
                GRANT UPDATE, DELETE ON audit_log TO {APP_ROLE};
            END IF;
        END
        $$;
        """
    )
