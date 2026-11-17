"""add_tenant_terminal_policies

Revision ID: b7d2e9f4a318
Revises: a8c9d0e1f2a3
Create Date: 2026-11-17 14:40:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
import sqlmodel


# revision identifiers, used by Alembic.
revision: str = 'b7d2e9f4a318'
down_revision: Union[str, Sequence[str], None] = 'a8c9d0e1f2a3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        'tenant_terminal_policies',
        sa.Column('tenant_id', sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column('config', sa.JSON(), nullable=True),
        sa.Column('updated_by', sqlmodel.sql.sqltypes.AutoString(), nullable=True),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('(CURRENT_TIMESTAMP)'), nullable=False),
        sa.PrimaryKeyConstraint('tenant_id'),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_table('tenant_terminal_policies')
