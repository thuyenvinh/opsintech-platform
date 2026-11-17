"""Authorization guards on the IM channel routers.

The three ``/api/channels`` handlers shipped with no ``Request`` parameter at
all, so any authenticated member could read every channel's status, restart a
channel process-wide, or publish an arbitrary message to an arbitrary chat id
on any configured Feishu/Slack/Telegram channel. All four channel-management
routes now require ``tenant.channel.manage``.
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from typing import Any

import pytest
from fastapi import FastAPI, Request, Response
from fastapi.routing import APIRoute
from fastapi.testclient import TestClient

from app.gateway.permissions import route_capabilities
from app.gateway.routers import channels

CHANNEL_MANAGE = "tenant.channel.manage"


def _walk_dependencies(dependant: Any) -> list[Any]:
    found: list[Any] = []
    for dep in getattr(dependant, "dependencies", []) or []:
        if dep.call is not None:
            found.append(dep.call)
        found.extend(_walk_dependencies(dep))
    return found


def _route_caps(router: Any, method: str, path: str) -> frozenset[str]:
    for route in router.routes:
        if isinstance(route, APIRoute) and route.path == path and method in route.methods:
            caps: set[str] = set()
            for call in _walk_dependencies(route.dependant):
                caps |= route_capabilities(call)
            return frozenset(caps)
    raise AssertionError(f"no {method} {path} route on {router}")


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

    app.include_router(channels.router)
    app.include_router(channels.im_settings_router)
    return TestClient(app)


# ---------------------------------------------------------------------------
# Declared capabilities
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("method", "path"),
    [
        ("GET", "/api/channels/"),
        ("POST", "/api/channels/{name}/restart"),
        ("POST", "/api/channels/test"),
    ],
)
def test_channel_routes_require_channel_manage(method: str, path: str) -> None:
    assert _route_caps(channels.router, method, path) == {CHANNEL_MANAGE}


def test_im_settings_write_requires_channel_manage() -> None:
    caps = _route_caps(channels.im_settings_router, "PUT", "/api/tenant-im/settings")
    assert caps == {CHANNEL_MANAGE}


def test_im_settings_read_stays_on_tenant_context() -> None:
    """Reading the tenant's own channel settings is not governance."""
    caps = _route_caps(channels.im_settings_router, "GET", "/api/tenant-im/settings")
    assert caps == frozenset()


# ---------------------------------------------------------------------------
# Enforcement
# ---------------------------------------------------------------------------


def test_member_cannot_read_channel_status() -> None:
    response = _client("tenant_member").get("/api/channels/")
    assert response.status_code == 403
    assert CHANNEL_MANAGE in response.json()["detail"]


def test_member_cannot_restart_a_channel() -> None:
    response = _client("tenant_member").post("/api/channels/feishu/restart")
    assert response.status_code == 403


def test_member_cannot_relay_a_test_notification() -> None:
    """The relay path: a member must not reach the outbound message bus."""
    response = _client("tenant_member").post(
        "/api/channels/test",
        json={"channel_name": "feishu", "chat_id": "oc_victim"},
    )
    assert response.status_code == 403


def test_member_cannot_write_im_settings() -> None:
    """403 before the session dependency is solved, so the DB is never touched."""
    response = _client("tenant_member").put(
        "/api/tenant-im/settings",
        json={"enabled": True, "channels": ["feishu"], "chat_ids": {"feishu": "oc_1"}},
    )
    assert response.status_code == 403


def test_tenant_admin_reaches_the_handler() -> None:
    """The channel service is not running in tests, so the handler answers 503/empty."""
    client = _client("tenant_admin")

    status = client.get("/api/channels/")
    assert status.status_code == 200
    assert status.json() == {"service_running": False, "channels": {}}

    restart = client.post("/api/channels/feishu/restart")
    assert restart.status_code == 503

    notify = client.post(
        "/api/channels/test",
        json={"channel_name": "feishu", "chat_id": "oc_1"},
    )
    assert notify.status_code == 503


def test_platform_admin_without_membership_is_not_a_channel_admin() -> None:
    response = _client(None, user_role="platform_admin").get("/api/channels/")
    assert response.status_code == 403


def test_missing_tenant_context_is_reported_as_a_bad_request() -> None:
    response = _client(None, tenant_id=None).get("/api/channels/")
    assert response.status_code == 400
