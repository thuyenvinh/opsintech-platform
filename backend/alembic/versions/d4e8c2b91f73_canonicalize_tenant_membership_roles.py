"""canonicalize_tenant_membership_roles

``tenant_memberships.role`` stored "admin", "member" and "owner" while every
API, model and capability check spoke tenant_admin / tenant_member -- the same
role had one name in a request and another in the row.

"owner" marked whoever created a tenant, but nothing ever branched on it: every
reader ran the value through normalize_tenant_role, which folds owner into
tenant_admin. The distinction carried no behaviour, so it collapses here.

Readers still accept the legacy spellings, so a row this migration misses --
one written by an older node mid-deploy, say -- keeps resolving correctly.

Revision ID: d4e8c2b91f73
Revises: c3f1a7b85d42
Create Date: 2026-11-17 17:05:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'd4e8c2b91f73'
down_revision: Union[str, Sequence[str], None] = 'c3f1a7b85d42'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

#: legacy stored value -> canonical value
UPGRADE_MAP = {
    "admin": "tenant_admin",
    "owner": "tenant_admin",
    "member": "tenant_member",
}

#: Canonical -> the value storage used to write. "owner" is not restored: which
#: admin happened to be the creator is not recorded anywhere else, so a
#: downgrade cannot reconstruct it, and nothing reads it.
DOWNGRADE_MAP = {
    "tenant_admin": "admin",
    "tenant_member": "member",
}

_memberships = sa.table(
    "tenant_memberships",
    sa.column("role", sa.String),
)


def _remap(mapping: dict[str, str]) -> None:
    bind = op.get_bind()
    for source, target in mapping.items():
        bind.execute(
            _memberships.update()
            .where(sa.func.lower(_memberships.c.role) == source)
            .values(role=target)
        )


def upgrade() -> None:
    _remap(UPGRADE_MAP)


def downgrade() -> None:
    _remap(DOWNGRADE_MAP)
