"""Authorization guards on the tenant summarization settings router.

Both endpoints sit under ``/api/tenant-admin/`` and the PUT changes agent
runtime behaviour, but only tenant context was required -- any member could
rewrite it. The PUT now requires ``tenant.summarization.write``. The GET stays
readable by members, because the setting governs their own agent runs.
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from typing import Any

import pytest
from fastapi import FastAPI, Request, Response
from fastapi.routing import APIRoute
from fastapi.testclient import TestClient

from app.gateway.permissions import route_capabilities
from app.gateway.routers import summarization
from deerflow.config.summarization_config import (
    get_summarization_config,
    set_summarization_config,
)

SUMMARIZATION_WRITE = "tenant.summarization.write"
SETTINGS_PATH = "/api/tenant-admin/settings/summarization"


def _walk_dependencies(dependant: Any) -> list[Any]:
    found: list[Any] = []
    for dep in getattr(dependant, "dependencies", []) or []:
        if dep.call is not None:
            found.append(dep.call)
        found.extend(_walk_dependencies(dep))
    return found


def _route_caps(method: str, path: str) -> frozenset[str]:
    for route in summarization.router.routes:
        if isinstance(route, APIRoute) and route.path == path and method in route.methods:
            caps: set[str] = set()
            for call in _walk_dependencies(route.dependant):
                caps |= route_capabilities(call)
            return frozenset(caps)
    raise AssertionError(f"no {method} {path} route")


def _client(
    tenant_role: str | None,
    *,
    user_role: str = "user",
    tenant_id: str | None = "tenant-a",
) -> TestClient:
    app = FastAPI()

    @app.middleware("http")
    async def _bind_identity(
        request: Request,
        call_next: Callable[[Request], Awaitable[Response]],
    ) -> Response:
        request.state.user_id = "u-1"
        request.state.user_role = user_role
        request.state.tenant_role = tenant_role
        request.state.tenant_id = tenant_id
        request.state.must_change_password = False
        return await call_next(request)

    app.include_router(summarization.router)
    return TestClient(app)


@pytest.fixture(autouse=True)
def _restore_process_config():
    """The PUT still mutates a process global; keep that out of other tests."""
    saved = get_summarization_config().model_copy(deep=True)
    yield
    set_summarization_config(saved)


# ---------------------------------------------------------------------------
# Declared capabilities
# ---------------------------------------------------------------------------


def test_write_requires_summarization_write() -> None:
    assert _route_caps("PUT", SETTINGS_PATH) == {SUMMARIZATION_WRITE}


def test_read_stays_on_tenant_context() -> None:
    """Members may read a setting that governs their own agent runs."""
    assert _route_caps("GET", SETTINGS_PATH) == frozenset()


# ---------------------------------------------------------------------------
# Enforcement
# ---------------------------------------------------------------------------


def test_member_cannot_change_summarization() -> None:
    response = _client("tenant_member").put(SETTINGS_PATH, json={"enabled": False})
    assert response.status_code == 403
    assert SUMMARIZATION_WRITE in response.json()["detail"]


def test_member_can_still_read_summarization() -> None:
    response = _client("tenant_member").get(SETTINGS_PATH)
    assert response.status_code == 200
    assert "trigger_tokens" in response.json()


def test_tenant_admin_can_change_summarization() -> None:
    client = _client("tenant_admin")
    response = client.put(
        SETTINGS_PATH,
        json={"enabled": True, "trigger_tokens": 4242, "keep_messages": 7},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["enabled"] is True
    assert body["trigger_tokens"] == 4242
    assert body["keep_messages"] == 7

    assert client.get(SETTINGS_PATH).json()["trigger_tokens"] == 4242


def test_platform_admin_without_membership_cannot_change_summarization() -> None:
    response = _client(None, user_role="platform_admin").put(
        SETTINGS_PATH, json={"enabled": False}
    )
    assert response.status_code == 403


def test_missing_tenant_context_is_reported_as_a_bad_request() -> None:
    response = _client(None, tenant_id=None).put(SETTINGS_PATH, json={"enabled": False})
    assert response.status_code == 400


# ---------------------------------------------------------------------------
# Known defect: the write is a process global, not tenant state
# ---------------------------------------------------------------------------


@pytest.mark.xfail(
    reason=(
        "set_summarization_config() assigns a module-level global in "
        "deerflow/config/summarization_config.py, so one tenant's write is "
        "served to every tenant on the same worker. Persisting it per tenant "
        "needs a tenant-shared app-payload row readable by "
        "deerflow/database/user_config_store.py:load_user_config_payload."
    ),
    strict=False,
)
def test_write_does_not_leak_into_another_tenant() -> None:
    _client("tenant_admin", tenant_id="tenant-a").put(
        SETTINGS_PATH, json={"trigger_tokens": 4242}
    )
    other = _client("tenant_member", tenant_id="tenant-b").get(SETTINGS_PATH)
    assert other.json()["trigger_tokens"] != 4242
