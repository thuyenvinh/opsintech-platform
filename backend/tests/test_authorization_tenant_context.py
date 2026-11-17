"""Behaviour of the pre-capability guards still exported by ``authorization.py``.

``require_admin`` and ``require_admin_base`` are gone, together with the
``DEERFLOW_ADMIN_REQUIRE_TENANT_ROLE`` switch that moved the admin boundary at
runtime. What survives resolves roles through ``permissions.py``; the capability
model itself is covered by ``test_permissions_matrix.py``.
"""

from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.gateway.authorization import (
    require_platform_admin,
    require_tenant_admin,
    require_tenant_context,
)


def test_require_tenant_context_returns_tenant_id() -> None:
    request = SimpleNamespace(state=SimpleNamespace(tenant_id="tenant-a"))
    assert require_tenant_context(request) == "tenant-a"


def test_require_tenant_context_raises_when_missing() -> None:
    request = SimpleNamespace(state=SimpleNamespace())
    with pytest.raises(HTTPException) as exc:
        require_tenant_context(request)
    assert exc.value.status_code == 400
    assert exc.value.detail == "Tenant context is required"


def test_require_tenant_context_raises_when_blank() -> None:
    request = SimpleNamespace(state=SimpleNamespace(tenant_id="   "))
    with pytest.raises(HTTPException) as exc:
        require_tenant_context(request)
    assert exc.value.status_code == 400


@pytest.mark.parametrize("tenant_role", ["tenant_admin", "admin", "owner"])
def test_require_tenant_admin_allows_tenant_admin(tenant_role: str) -> None:
    request = SimpleNamespace(
        state=SimpleNamespace(
            tenant_id="tenant-a",
            user_role="user",
            tenant_role=tenant_role,
        )
    )
    assert require_tenant_admin(request) == "tenant-a"


def test_require_tenant_admin_rejects_tenant_member() -> None:
    request = SimpleNamespace(
        state=SimpleNamespace(
            tenant_id="tenant-a",
            user_role="user",
            tenant_role="member",
        )
    )
    with pytest.raises(HTTPException) as exc:
        require_tenant_admin(request)
    assert exc.value.status_code == 403


def test_require_tenant_admin_rejects_platform_admin_without_tenant_admin() -> None:
    request = SimpleNamespace(
        state=SimpleNamespace(
            tenant_id="tenant-a",
            user_role="admin",
            tenant_role="member",
        )
    )
    with pytest.raises(HTTPException) as exc:
        require_tenant_admin(request)
    assert exc.value.status_code == 403


def test_require_tenant_admin_requires_tenant_context() -> None:
    request = SimpleNamespace(state=SimpleNamespace(user_role="user", tenant_role="admin"))
    with pytest.raises(HTTPException) as exc:
        require_tenant_admin(request)
    assert exc.value.status_code == 400


@pytest.mark.parametrize("user_role", ["platform_admin", "admin", "ADMIN"])
def test_require_platform_admin_allows_platform_admin(user_role: str) -> None:
    request = SimpleNamespace(
        state=SimpleNamespace(user_role=user_role, tenant_role=None, must_change_password=False)
    )
    require_platform_admin(request)


def test_require_platform_admin_rejects_tenant_admin() -> None:
    request = SimpleNamespace(
        state=SimpleNamespace(user_role="user", tenant_role="tenant_admin", must_change_password=False)
    )
    with pytest.raises(HTTPException) as exc:
        require_platform_admin(request)
    assert exc.value.status_code == 403
    assert exc.value.detail == "Platform admin access required"


def test_require_platform_admin_blocks_until_initial_password_is_rotated() -> None:
    request = SimpleNamespace(
        state=SimpleNamespace(user_role="admin", tenant_role=None, must_change_password=True)
    )
    with pytest.raises(HTTPException) as exc:
        require_platform_admin(request)
    assert exc.value.status_code == 403
    assert exc.value.headers == {"X-Must-Change-Password": "true"}
