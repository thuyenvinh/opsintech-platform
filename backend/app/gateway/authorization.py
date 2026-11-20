"""Pre-capability guards for routers not yet migrated to ``require_cap``.

:mod:`app.gateway.permissions` is the single source of truth for the three
roles and for what each may do. Nothing here re-derives a role: every predicate
below resolves through that module. These names survive only because call sites
outside the capability model still import them.
"""

from fastapi import HTTPException, Request

from app.gateway.permissions import ROLE_TENANT_ADMIN, is_platform_admin, tenant_role


def _is_tenant_admin(request: Request) -> bool:
    return tenant_role(request) == ROLE_TENANT_ADMIN


def require_platform_admin(request: Request) -> None:
    if not is_platform_admin(request):
        raise HTTPException(status_code=403, detail="Platform admin access required")
    if getattr(request.state, "must_change_password", False):
        raise HTTPException(
            status_code=403,
            detail="Must change initial password before accessing admin routes",
            headers={"X-Must-Change-Password": "true"}
        )


def require_tenant_context(request: Request) -> str:
    """Require tenant context for tenant-scoped endpoints."""
    tenant_id = getattr(request.state, "tenant_id", None)
    if not isinstance(tenant_id, str) or not tenant_id.strip():
        raise HTTPException(status_code=400, detail="Tenant context is required")
    return tenant_id

def require_user_context(request: Request) -> str:
    """Require an authenticated user id.

    Separate from :func:`require_tenant_context` because a tenant alone does not
    identify a person, and some resources are keyed per user rather than per
    tenant -- a terminal PTY most of all. Those keys reject a blank id, so a
    caller that substitutes a non-blank placeholder ("system", "unknown") when
    the real id is missing defeats that check instead of tripping it: every such
    caller lands on one shared key. Fail here, where the identity is still
    recoverable, rather than handing a placeholder downstream.
    """
    user_id = getattr(request.state, "user_id", None)
    if not isinstance(user_id, str) or not user_id.strip():
        raise HTTPException(status_code=401, detail="Authenticated user is required")
    return user_id


def require_tenant_admin(request: Request) -> str:
    """Require tenant-admin membership for tenant-governance endpoints."""
    tenant_id = getattr(request.state, "tenant_id", None)
    if not isinstance(tenant_id, str) or not tenant_id.strip():
        raise HTTPException(status_code=400, detail="Tenant context is required")
    if not _is_tenant_admin(request):
        raise HTTPException(status_code=403, detail="Tenant admin access required")
    return tenant_id
