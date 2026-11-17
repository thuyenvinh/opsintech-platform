"""Storage and the API must call a tenant role by the same name.

``tenant_memberships.role`` used to hold "admin"/"member"/"owner" while every
request, model and capability check spoke tenant_admin/tenant_member. Readers
folded the legacy spellings back, so nothing was broken -- it just meant the
row never said what the API said, and the "owner" value looked like a fourth
role that did not exist.
"""

from __future__ import annotations

import pytest

from deerflow.database.tenant_service import (
    TENANT_ROLE_ADMIN,
    TENANT_ROLE_MEMBER,
    normalize_tenant_role,
    normalize_tenant_role_for_storage,
    tenant_role_has_admin_capability,
)


@pytest.mark.parametrize(
    ("given", "expected"),
    [
        ("tenant_admin", TENANT_ROLE_ADMIN),
        ("admin", TENANT_ROLE_ADMIN),
        ("owner", TENANT_ROLE_ADMIN),
        ("tenant_member", TENANT_ROLE_MEMBER),
        ("member", TENANT_ROLE_MEMBER),
    ],
)
def test_storage_writes_the_canonical_name(given: str, expected: str) -> None:
    assert normalize_tenant_role_for_storage(given) == expected


def test_storage_never_writes_a_legacy_spelling() -> None:
    written = {
        normalize_tenant_role_for_storage(role)
        for role in ("tenant_admin", "admin", "owner", "tenant_member", "member")
    }
    assert written == {TENANT_ROLE_ADMIN, TENANT_ROLE_MEMBER}
    assert "owner" not in written


def test_storage_round_trips_through_the_reader() -> None:
    """What we write must read back as the same role, or the two drift again."""
    for role in (TENANT_ROLE_ADMIN, TENANT_ROLE_MEMBER):
        assert normalize_tenant_role(normalize_tenant_role_for_storage(role)) == role


@pytest.mark.parametrize("legacy", ["admin", "owner", "member"])
def test_legacy_rows_still_read_correctly(legacy: str) -> None:
    """Rows written before the migration, or by an older node mid-deploy."""
    assert normalize_tenant_role(legacy) in {TENANT_ROLE_ADMIN, TENANT_ROLE_MEMBER}


def test_owner_still_counts_as_admin_when_read() -> None:
    assert tenant_role_has_admin_capability("owner")
    assert tenant_role_has_admin_capability("admin")
    assert tenant_role_has_admin_capability(TENANT_ROLE_ADMIN)
    assert not tenant_role_has_admin_capability("member")
    assert not tenant_role_has_admin_capability(None)


@pytest.mark.parametrize("bad", ["", "   ", "superuser", "Tenant Admin"])
def test_unknown_roles_are_rejected(bad: str) -> None:
    with pytest.raises(ValueError):
        normalize_tenant_role_for_storage(bad)


def test_the_capability_model_agrees_with_storage() -> None:
    """permissions.py and tenant_service must not disagree on the role names."""
    from app.gateway.permissions import ROLE_TENANT_ADMIN, ROLE_TENANT_MEMBER

    assert TENANT_ROLE_ADMIN == ROLE_TENANT_ADMIN
    assert TENANT_ROLE_MEMBER == ROLE_TENANT_MEMBER
