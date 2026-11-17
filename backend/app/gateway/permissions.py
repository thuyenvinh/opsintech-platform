"""Capability-based authorization for the three platform roles.

The platform has exactly three roles, stored in two places:

* ``platform_admin`` -- ``user.role`` in the auth DB, global scope.
* ``tenant_admin`` / ``tenant_member`` -- ``tenant_memberships.role``, per tenant.

This module is the single source of truth for what each role may do. A closed
capability catalogue is mapped to roles here, and routers depend on
:func:`require_cap` rather than re-deriving role checks. Adding a route means
picking a capability from the catalogue, not writing a new role predicate.

Capability names are ``domain.action``. The ``own`` segment (``kb.own.write``)
marks a capability over the caller's own rows -- the handler still filters by
``user_id``; the capability only says the caller may act on their own data.
"""

from collections.abc import Callable

from fastapi import HTTPException, Request

ROLE_PLATFORM_ADMIN = "platform_admin"
ROLE_TENANT_ADMIN = "tenant_admin"
ROLE_TENANT_MEMBER = "tenant_member"

# "admin" is a legacy spelling of "platform_admin" still present in the auth DB.
PLATFORM_ADMIN_ROLE_ALIASES = frozenset({"platform_admin", "admin"})
TENANT_ADMIN_ROLE_ALIASES = frozenset({"tenant_admin", "admin", "owner"})
TENANT_MEMBER_ROLE_ALIASES = frozenset({"tenant_member", "member"})

# ---------------------------------------------------------------------------
# Capability catalogue
# ---------------------------------------------------------------------------

#: Platform-wide governance. Only platform_admin ever holds these.
PLATFORM_CAPS = frozenset(
    {
        "platform.user.read",
        "platform.user.write",
        "platform.tenant.read",
        "platform.tenant.write",
        "platform.model_template.write",
        "platform.announcement.write",
        "platform.audit.read",
        "platform.security.write",
    }
)

#: Governance inside one tenant. Held by the tenant_admin of that tenant.
TENANT_ADMIN_CAPS = frozenset(
    {
        "tenant.member.read",
        "tenant.member.write",
        "tenant.model.write",
        "tenant.mcp.write",
        "tenant.skill.write",
        "tenant.agent.write",
        "tenant.tool_group.write",
        "tenant.channel.manage",
        "tenant.terminal_policy.write",
        "tenant.summarization.write",
        "tenant.audit.read",
        "tenant.kb.write",
        "tenant.file.write_shared",
        "tenant.alert_source.write",
        "tenant.alert_rule.write",
        "tenant.alerting_settings.write",
        # Governance actions on incidents: hiding one, or handing it to someone else.
        "incident.assign",
        "incident.suppress",
    }
)

#: Acting on your own account. Held by every authenticated caller, including a
#: bootstrap platform admin who has no tenant membership yet.
SELF_CAPS = frozenset(
    {
        "self.password.change",
        "self.profile.write",
    }
)

#: Everyday work inside a tenant. Held by every member, admins included.
MEMBER_CAPS = frozenset(
    {
        "incident.read",
        "incident.claim",
        "incident.resolve",
        "incident.diagnose",
        "kb.read",
        "kb.own.write",
        "file.read",
        "file.own.write",
        "agent.own.write",
        "keychain.own.write",
        "asset.own.write",
        "skill.own.write",
        "terminal.execute",
        "terminal.settings.own.write",
        "memory.own.read",
        "memory.own.write",
        "upload.own.write",
        "thread.own.write",
        "artifact.own.read",
        "template.own.write",
        "suggestion.use",
    }
)

#: Every capability the platform knows about. Nothing outside this set is valid.
CAPABILITIES = PLATFORM_CAPS | TENANT_ADMIN_CAPS | MEMBER_CAPS | SELF_CAPS

#: Role -> capabilities. A tenant admin also does everyday work. ``SELF_CAPS``
#: is not listed here: it is granted to every authenticated caller by
#: :func:`effective_caps`, regardless of role or tenant membership.
ROLE_CAPS: dict[str, frozenset[str]] = {
    ROLE_PLATFORM_ADMIN: PLATFORM_CAPS,
    ROLE_TENANT_ADMIN: TENANT_ADMIN_CAPS | MEMBER_CAPS,
    ROLE_TENANT_MEMBER: MEMBER_CAPS,
}


# ---------------------------------------------------------------------------
# Role resolution
# ---------------------------------------------------------------------------


def _state(request: Request, name: str, default=None):
    return getattr(getattr(request, "state", None), name, default)


def is_platform_admin(request: Request) -> bool:
    """Whether the caller holds the global platform-admin role."""
    role = _state(request, "user_role")
    if not isinstance(role, str):
        return False
    return role.strip().lower() in PLATFORM_ADMIN_ROLE_ALIASES


def tenant_role(request: Request) -> str | None:
    """Normalized tenant membership role for the active tenant, if any."""
    role = _state(request, "tenant_role")
    if not isinstance(role, str):
        return None
    normalized = role.strip().lower()
    if normalized in TENANT_ADMIN_ROLE_ALIASES:
        return ROLE_TENANT_ADMIN
    if normalized in TENANT_MEMBER_ROLE_ALIASES:
        return ROLE_TENANT_MEMBER
    return None


def effective_caps(request: Request) -> frozenset[str]:
    """Capabilities the caller holds on this request.

    Platform capabilities and tenant capabilities are unioned, not substituted:
    a platform admin does not silently gain access to tenant business data. To
    act inside a tenant they must hold a membership in it, which is an audited
    operation.
    """
    caps: frozenset[str] = SELF_CAPS
    if is_platform_admin(request):
        caps |= ROLE_CAPS[ROLE_PLATFORM_ADMIN]
    role = tenant_role(request)
    if role is not None:
        caps |= ROLE_CAPS[role]
    return caps


def has_cap(request: Request, *caps: str) -> bool:
    """Whether the caller holds every capability in ``caps``."""
    _assert_known(caps)
    return set(caps).issubset(effective_caps(request))


# ---------------------------------------------------------------------------
# Enforcement
# ---------------------------------------------------------------------------


def _assert_known(caps: tuple[str, ...]) -> None:
    unknown = set(caps) - CAPABILITIES
    if unknown:
        raise ValueError(f"Unknown capability: {', '.join(sorted(unknown))}")


def _blocked_by_password_change(request: Request, caps: tuple[str, ...]) -> bool:
    """Governance work is blocked until the initial password is rotated.

    Everyday member capabilities stay open so the user can reach the
    change-password flow and the pages around it.
    """
    if not bool(_state(request, "must_change_password", False)):
        return False
    return bool(set(caps) - MEMBER_CAPS - SELF_CAPS)


def require_cap(*caps: str) -> Callable[[Request], None]:
    """FastAPI dependency asserting the caller holds every capability in ``caps``.

    Usage::

        @router.put(
            "/alert-rules/{rule_id}",
            dependencies=[Depends(require_cap("tenant.alert_rule.write"))],
        )

    Raises 403 when a capability is missing, and 400 when a tenant-scoped
    capability is requested without tenant context.
    """
    _assert_known(caps)
    needs_tenant = any(
        not cap.startswith("platform.") and cap not in SELF_CAPS for cap in caps
    )

    def dependency(request: Request) -> None:
        if _blocked_by_password_change(request, caps):
            raise HTTPException(
                status_code=403,
                detail="Must change initial password before this operation",
                headers={"X-Must-Change-Password": "true"},
            )

        # Checked before the capability itself, and on the success path too, so
        # a handler that drops its own require_tenant_context can still rely on
        # request.state.tenant_id being usable.
        if needs_tenant:
            tenant_id = _state(request, "tenant_id")
            if not isinstance(tenant_id, str) or not tenant_id.strip():
                raise HTTPException(status_code=400, detail="Tenant context is required")

        granted = effective_caps(request)
        missing = set(caps) - granted
        if not missing:
            return

        raise HTTPException(
            status_code=403,
            detail=f"Missing permission: {', '.join(sorted(missing))}",
        )

    # Lets the route inventory test see which capability guards which route.
    dependency.__capabilities__ = frozenset(caps)  # type: ignore[attr-defined]
    dependency.__capability_mode__ = "all"  # type: ignore[attr-defined]
    return dependency


def require_any_cap(*caps: str) -> Callable[[Request], None]:
    """FastAPI dependency asserting the caller holds at least one of ``caps``."""
    _assert_known(caps)

    def dependency(request: Request) -> None:
        if _blocked_by_password_change(request, caps):
            raise HTTPException(
                status_code=403,
                detail="Must change initial password before this operation",
                headers={"X-Must-Change-Password": "true"},
            )
        if effective_caps(request) & set(caps):
            return
        raise HTTPException(
            status_code=403,
            detail=f"Missing permission: one of {', '.join(sorted(caps))}",
        )

    dependency.__capabilities__ = frozenset(caps)  # type: ignore[attr-defined]
    dependency.__capability_mode__ = "any"  # type: ignore[attr-defined]
    return dependency


def route_capabilities(dependency: object) -> frozenset[str]:
    """Capabilities a dependency enforces, or an empty set if it enforces none.

    Used by the route inventory test to tell a guarded route from an open one.
    """
    caps = getattr(dependency, "__capabilities__", None)
    return caps if isinstance(caps, frozenset) else frozenset()
