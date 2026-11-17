"""Role -> capability matrix invariants and guard behaviour."""

from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.gateway.permissions import (
    CAPABILITIES,
    MEMBER_CAPS,
    PLATFORM_CAPS,
    ROLE_CAPS,
    ROLE_PLATFORM_ADMIN,
    ROLE_TENANT_ADMIN,
    ROLE_TENANT_MEMBER,
    SELF_CAPS,
    TENANT_ADMIN_CAPS,
    effective_caps,
    has_cap,
    is_platform_admin,
    require_any_cap,
    require_cap,
    tenant_role,
)


def _request(
    *,
    user_role: str | None = None,
    tenant_role_value: str | None = None,
    tenant_id: str | None = "tenant-a",
    must_change_password: bool = False,
) -> SimpleNamespace:
    return SimpleNamespace(
        state=SimpleNamespace(
            user_id="u-1",
            user_role=user_role,
            tenant_role=tenant_role_value,
            tenant_id=tenant_id,
            must_change_password=must_change_password,
        )
    )


# ---------------------------------------------------------------------------
# Catalogue invariants
# ---------------------------------------------------------------------------


def test_every_granted_capability_is_in_the_catalogue() -> None:
    for role, caps in ROLE_CAPS.items():
        unknown = caps - CAPABILITIES
        assert not unknown, f"{role} grants capabilities outside the catalogue: {unknown}"


def test_exactly_three_roles() -> None:
    assert set(ROLE_CAPS) == {
        ROLE_PLATFORM_ADMIN,
        ROLE_TENANT_ADMIN,
        ROLE_TENANT_MEMBER,
    }


def test_capability_groups_do_not_overlap() -> None:
    groups = [PLATFORM_CAPS, TENANT_ADMIN_CAPS, MEMBER_CAPS, SELF_CAPS]
    for i, left in enumerate(groups):
        for right in groups[i + 1 :]:
            assert not left & right


def test_tenant_admin_can_do_everyday_work() -> None:
    assert MEMBER_CAPS.issubset(ROLE_CAPS[ROLE_TENANT_ADMIN])


def test_member_holds_no_governance_capability() -> None:
    member = ROLE_CAPS[ROLE_TENANT_MEMBER]
    assert "self.password.change" not in member  # granted to everyone instead
    assert not member & PLATFORM_CAPS
    assert not member & TENANT_ADMIN_CAPS


def test_capability_names_are_dotted_lowercase() -> None:
    for cap in CAPABILITIES:
        assert cap == cap.lower(), cap
        assert "." in cap, cap
        assert " " not in cap, cap


# ---------------------------------------------------------------------------
# Role resolution
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("role", ["platform_admin", "admin", "PLATFORM_ADMIN", " admin "])
def test_platform_admin_aliases(role: str) -> None:
    assert is_platform_admin(_request(user_role=role))


@pytest.mark.parametrize("role", ["tenant_admin", "tenant_member", "user", None, ""])
def test_non_platform_roles(role: str | None) -> None:
    assert not is_platform_admin(_request(user_role=role))


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("tenant_admin", ROLE_TENANT_ADMIN),
        ("admin", ROLE_TENANT_ADMIN),
        ("owner", ROLE_TENANT_ADMIN),
        ("tenant_member", ROLE_TENANT_MEMBER),
        ("member", ROLE_TENANT_MEMBER),
        ("nonsense", None),
        (None, None),
    ],
)
def test_tenant_role_normalization(raw: str | None, expected: str | None) -> None:
    assert tenant_role(_request(tenant_role_value=raw)) == expected


def test_platform_admin_without_membership_gets_only_platform_and_self_caps() -> None:
    caps = effective_caps(_request(user_role="platform_admin", tenant_role_value=None))
    assert caps == PLATFORM_CAPS | SELF_CAPS
    assert not caps & MEMBER_CAPS


def test_platform_admin_with_membership_unions_both() -> None:
    caps = effective_caps(
        _request(user_role="platform_admin", tenant_role_value="tenant_admin")
    )
    assert PLATFORM_CAPS.issubset(caps)
    assert TENANT_ADMIN_CAPS.issubset(caps)
    assert MEMBER_CAPS.issubset(caps)


def test_member_capabilities() -> None:
    caps = effective_caps(_request(user_role="user", tenant_role_value="tenant_member"))
    assert caps == MEMBER_CAPS | SELF_CAPS


def test_self_capabilities_need_no_role_at_all() -> None:
    caps = effective_caps(_request(user_role=None, tenant_role_value=None, tenant_id=None))
    assert caps == SELF_CAPS


def test_unknown_capability_is_a_programming_error() -> None:
    with pytest.raises(ValueError, match="Unknown capability"):
        require_cap("tenant.does_not_exist")
    with pytest.raises(ValueError, match="Unknown capability"):
        has_cap(_request(), "nope.nope")


# ---------------------------------------------------------------------------
# Guards
# ---------------------------------------------------------------------------


def test_require_cap_allows_holder() -> None:
    guard = require_cap("tenant.channel.manage")
    guard(_request(tenant_role_value="tenant_admin"))


def test_require_cap_rejects_member() -> None:
    guard = require_cap("tenant.channel.manage")
    with pytest.raises(HTTPException) as exc:
        guard(_request(tenant_role_value="tenant_member"))
    assert exc.value.status_code == 403
    assert "tenant.channel.manage" in exc.value.detail


def test_require_cap_rejects_platform_admin_without_membership() -> None:
    """Platform admin is not a tenant superuser; it needs a membership."""
    guard = require_cap("tenant.channel.manage")
    with pytest.raises(HTTPException) as exc:
        guard(_request(user_role="platform_admin", tenant_role_value=None))
    assert exc.value.status_code == 403
    assert "tenant.channel.manage" in exc.value.detail


def test_require_cap_reports_missing_tenant_context() -> None:
    guard = require_cap("kb.own.write")
    with pytest.raises(HTTPException) as exc:
        guard(_request(tenant_role_value=None, tenant_id=None))
    assert exc.value.status_code == 400


def test_tenant_context_is_asserted_even_for_a_capability_holder() -> None:
    """A handler may drop its own require_tenant_context and rely on this.

    Without the up-front check, a tenant-scoped guard would pass a caller whose
    tenant_id is blank and leave the handler to fail further in.
    """
    guard = require_cap("tenant.summarization.write")
    with pytest.raises(HTTPException) as exc:
        guard(_request(tenant_role_value="tenant_admin", tenant_id="   "))
    assert exc.value.status_code == 400
    assert exc.value.detail == "Tenant context is required"


def test_require_cap_requires_all_listed_capabilities() -> None:
    guard = require_cap("incident.read", "incident.suppress")
    guard(_request(tenant_role_value="tenant_admin"))
    with pytest.raises(HTTPException) as exc:
        guard(_request(tenant_role_value="tenant_member"))
    assert "incident.suppress" in exc.value.detail
    assert "incident.read" not in exc.value.detail


def test_require_any_cap_needs_only_one() -> None:
    guard = require_any_cap("tenant.kb.write", "kb.own.write")
    guard(_request(tenant_role_value="tenant_member"))
    guard(_request(tenant_role_value="tenant_admin"))
    with pytest.raises(HTTPException):
        guard(_request(tenant_role_value=None, tenant_id=None))


def test_platform_capability_needs_no_tenant_context() -> None:
    guard = require_cap("platform.user.write")
    guard(_request(user_role="platform_admin", tenant_id=None))


# ---------------------------------------------------------------------------
# Forced password rotation
# ---------------------------------------------------------------------------


def test_must_change_password_blocks_governance() -> None:
    guard = require_cap("tenant.member.write")
    with pytest.raises(HTTPException) as exc:
        guard(_request(tenant_role_value="tenant_admin", must_change_password=True))
    assert exc.value.status_code == 403
    assert exc.value.headers == {"X-Must-Change-Password": "true"}


def test_must_change_password_still_allows_changing_the_password() -> None:
    """A freshly created member must be able to complete the rotation flow."""
    guard = require_cap("self.password.change")
    guard(_request(tenant_role_value="tenant_member", must_change_password=True))
    guard(_request(user_role="platform_admin", tenant_role_value=None, must_change_password=True))


def test_must_change_password_allows_everyday_member_capabilities() -> None:
    guard = require_cap("incident.read")
    guard(_request(tenant_role_value="tenant_member", must_change_password=True))
