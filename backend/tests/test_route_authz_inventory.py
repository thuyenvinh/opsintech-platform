"""Every gateway route must be deliberately guarded, scoped, or deliberately open.

This test exists because of a class of bug it would have caught: three IM
channel endpoints shipped without even a ``Request`` parameter, so any
authenticated member could restart a channel process-wide or relay a message to
any chat the bot could reach. Nothing failed, because nothing was checking.

Each route is classified into exactly one bucket:

``capability``
    Depends on :func:`app.gateway.permissions.require_cap` — the target state.
``legacy``
    Depends on a pre-capability guard from ``authorization.py``. Still a real
    check; migrate when the router is next touched.
``scoped``
    No role check, but the handler establishes tenant context or filters by
    ``user_id``, so the caller only reaches their own rows. Correct for
    member-level work; a capability makes the intent explicit and is preferred.
``open``
    Nothing at all. Must appear in :data:`EXPECTED_OPEN` with a reason.
"""

from __future__ import annotations

import inspect
from typing import Any

from fastapi.routing import APIRoute, APIWebSocketRoute

from app.gateway.app import create_app
from app.gateway.permissions import route_capabilities

#: Pre-capability guards from ``authorization.py``, declared as route
#: dependencies. They enforce a real check but carry no capability marker, so
#: they are recognised by name until every route is migrated to ``require_cap``.
LEGACY_GUARDS = frozenset(
    {
        "require_platform_admin",
        "require_tenant_admin",
    }
)

#: Guards called inside the handler body rather than declared as a dependency.
BODY_GUARD_CALLS = (
    "require_cap(",
    "require_any_cap(",
    "require_tenant_admin(",
    "require_platform_admin(",
    # Still used for scope branching in agents.py and knowledge.py.
    "_is_tenant_admin(",
    "_enforce_suggestions_access(",
)

#: Evidence that a handler confines the caller to their own tenant or rows.
#: ``require_tenant_context`` proves a tenant is present, not that the caller
#: may act -- which is why it counts as scoping and never as a guard.
SCOPING_MARKERS = (
    "require_tenant_context",
    "request.state.user_id",
    '"user_id"',
    # Per-router helpers that resolve the caller and 401 when absent.
    "_require_user_id(",
    "_get_user_id(",
)

#: Routes that legitimately have no role check and no scoping, with the reason.
#: Anything else failing this test is either a bug or a decision to write down.
EXPECTED_OPEN: dict[str, str] = {
    # Unauthenticated by design; also excluded from AuthMiddleware.
    "GET /health": "liveness probe",
    "POST /api/auth/login": "establishes the session",
    "POST /api/auth/signup": "establishes the session",
    "POST /api/auth/logout": "ends the session",
    "GET /api/auth/session": "returns nulls when anonymous",
    "GET /api/auth/bootstrap-status": "first-run setup, before any identity exists",
    "POST /api/auth/setup-bootstrap-admin": "first-run setup, before any identity exists",
    # Authenticated per source token, not per user session.
    "POST /api/alerts/ingest/{source_id}": "alert source token auth",
    "POST /api/alerts/ingest/webhook/{source_id}": "alert source token auth",
    "POST /api/changes/ingest/{source_id}": "CI/CD source token auth",
    # Authenticates itself: AuthMiddleware does not run for websockets, so the
    # handler resolves the session token, user and tenant inline.
    "WS /api/v1/terminal/ws": "websocket authenticates inline",
}


def _walk_dependencies(dependant: Any) -> list[Any]:
    """Flatten a Dependant tree into the list of callables it depends on."""
    found: list[Any] = []
    for dep in getattr(dependant, "dependencies", []) or []:
        if dep.call is not None:
            found.append(dep.call)
        found.extend(_walk_dependencies(dep))
    return found


def _source_of(endpoint: Any) -> str:
    try:
        return inspect.getsource(endpoint)
    except (OSError, TypeError):
        return ""


def _route_key(path: str, methods: set[str] | None) -> str:
    if not methods:
        return f"WS {path}"
    remaining = sorted(methods - {"HEAD", "OPTIONS"})
    return f"{remaining[0] if remaining else 'ANY'} {path}"


def classify(route: APIRoute | APIWebSocketRoute) -> dict[str, Any]:
    caps: set[str] = set()
    legacy: set[str] = set()
    dependency_names: set[str] = set()
    for call in _walk_dependencies(route.dependant):
        caps |= route_capabilities(call)
        name = getattr(call, "__name__", "")
        dependency_names.add(name)
        if name in LEGACY_GUARDS:
            legacy.add(name)

    source = _source_of(route.endpoint)

    if caps:
        bucket = "capability"
    elif legacy or any(call in source for call in BODY_GUARD_CALLS):
        bucket = "legacy"
    elif "require_tenant_context" in dependency_names or any(
        marker in source for marker in SCOPING_MARKERS
    ):
        bucket = "scoped"
    else:
        bucket = "open"

    return {"bucket": bucket, "capabilities": sorted(caps), "legacy_guards": sorted(legacy)}


def collect_inventory() -> dict[str, dict[str, Any]]:
    """Classify every gateway route."""
    app = create_app()
    inventory: dict[str, dict[str, Any]] = {}
    for route in app.routes:
        if isinstance(route, APIRoute):
            methods = route.methods
        elif isinstance(route, APIWebSocketRoute):
            methods = None
        else:
            continue
        inventory[_route_key(route.path, methods)] = classify(route)
    return inventory


def test_no_route_is_accidentally_open() -> None:
    inventory = collect_inventory()
    unexpected = sorted(
        key
        for key, info in inventory.items()
        if info["bucket"] == "open" and key not in EXPECTED_OPEN
    )
    assert not unexpected, (
        "These routes have no role check and no tenant/user scoping. Guard them, "
        "or add them to EXPECTED_OPEN with a reason:\n  " + "\n  ".join(unexpected)
    )


def test_declared_capabilities_are_real() -> None:
    """A route cannot depend on a capability outside the catalogue."""
    from app.gateway.permissions import CAPABILITIES

    for key, info in collect_inventory().items():
        unknown = set(info["capabilities"]) - CAPABILITIES
        assert not unknown, f"{key} requires unknown capabilities: {sorted(unknown)}"


def test_expected_open_entries_all_carry_a_reason() -> None:
    for key, reason in EXPECTED_OPEN.items():
        assert reason.strip(), f"{key} is listed as open with no reason"


def test_every_route_is_classified() -> None:
    inventory = collect_inventory()
    assert inventory, "no routes discovered -- the classifier is broken"
    for key, info in inventory.items():
        assert info["bucket"] in {"capability", "legacy", "scoped", "open"}, key


if __name__ == "__main__":  # pragma: no cover - inventory dump for maintenance
    counts: dict[str, int] = {}
    for key, info in sorted(collect_inventory().items()):
        counts[info["bucket"]] = counts.get(info["bucket"], 0) + 1
        label = info["bucket"]
        if info["capabilities"]:
            label += ":" + ",".join(info["capabilities"])
        elif info["legacy_guards"]:
            label += ":" + ",".join(info["legacy_guards"])
        print(f"{label:62} {key}")
    print()
    for bucket in ("capability", "legacy", "scoped", "open"):
        print(f"{bucket:12} {counts.get(bucket, 0)}")
