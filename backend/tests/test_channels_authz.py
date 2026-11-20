"""Authorization guards on the IM channel routers.

The three ``/api/channels`` handlers shipped with no ``Request`` parameter at
all, so any authenticated member could read every channel's status, restart a
channel process-wide, or publish an arbitrary message to an arbitrary chat id
on any configured Feishu/Slack/Telegram channel.

The channel-management routes now require ``tenant.channel.manage``, with two
refinements that follow from the channel pool being process-wide rather than
per tenant:

* ``POST /api/channels/{name}/restart`` drops every tenant's connection on the
  worker, so it is platform work and requires ``platform.security.write``.
* ``POST /api/channels/test`` may only address a ``(channel, chat)`` pair the
  caller's own tenant configured, otherwise one tenant admin could publish into
  another tenant's chat.
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
PLATFORM_SECURITY_WRITE = "platform.security.write"


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
        ("POST", "/api/channels/test"),
    ],
)
def test_channel_routes_require_channel_manage(method: str, path: str) -> None:
    assert _route_caps(channels.router, method, path) == {CHANNEL_MANAGE}


def test_restart_requires_a_platform_capability() -> None:
    """Restarting is not tenant-scopable: one pool, every tenant on it."""
    caps = _route_caps(channels.router, "POST", "/api/channels/{name}/restart")
    assert caps == {PLATFORM_SECURITY_WRITE}


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


def test_tenant_admin_cannot_restart_a_channel() -> None:
    """Closes the cross-tenant denial of service: A could restart B's channel."""
    response = _client("tenant_admin").post("/api/channels/feishu/restart")
    assert response.status_code == 403
    assert PLATFORM_SECURITY_WRITE in response.json()["detail"]


def test_platform_admin_can_restart_a_channel() -> None:
    """The service is not running in tests, so the handler answers 503."""
    response = _client(None, user_role="platform_admin").post("/api/channels/feishu/restart")
    assert response.status_code == 503


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


# ---------------------------------------------------------------------------
# Relay targets: the tenant's own configured (channel, chat) pairs
# ---------------------------------------------------------------------------


class _RecordingBus:
    """Stands in for the shared outbound message bus."""

    def __init__(self) -> None:
        self.published: list[Any] = []

    async def publish_outbound(self, msg: Any) -> None:
        self.published.append(msg)


@pytest.fixture
def _running_service(monkeypatch) -> _RecordingBus:
    """A channel service that is up, so the handler gets past the 503 guard."""
    from types import SimpleNamespace

    from app.channels import service as service_module

    bus = _RecordingBus()
    monkeypatch.setattr(
        service_module, "get_channel_service", lambda: SimpleNamespace(bus=bus)
    )
    return bus


@pytest.fixture
def _configured_targets(monkeypatch) -> None:
    """Two tenants, each with its own Feishu chats, as IM settings would store."""
    settings = {
        "tenant-a": {
            "enabled": True,
            "channels": ["feishu"],
            "chat_ids": {"feishu": "oc_a1, oc_a2"},
        },
        "tenant-b": {
            "enabled": True,
            "channels": ["feishu"],
            "chat_ids": {"feishu": "oc_b1"},
        },
    }

    async def _load(tenant_id: str) -> dict:
        return dict(settings.get(tenant_id, {}))

    monkeypatch.setattr(channels, "_load_tenant_notification_config", _load)


def test_relay_reaches_the_bus_for_the_tenants_own_chat(
    _running_service: _RecordingBus,
    _configured_targets: None,
) -> None:
    response = _client("tenant_admin", tenant_id="tenant-a").post(
        "/api/channels/test",
        json={"channel_name": "feishu", "chat_id": "oc_a2"},
    )
    assert response.status_code == 200
    assert response.json()["success"] is True
    assert [(m.channel_name, m.chat_id) for m in _running_service.published] == [
        ("feishu", "oc_a2")
    ]


def test_relay_refuses_another_tenants_chat(
    _running_service: _RecordingBus,
    _configured_targets: None,
) -> None:
    """The hole this closes: tenant A naming tenant B's chat id in the body."""
    response = _client("tenant_admin", tenant_id="tenant-a").post(
        "/api/channels/test",
        json={"channel_name": "feishu", "chat_id": "oc_b1"},
    )
    assert response.status_code == 403
    assert _running_service.published == []


def test_relay_refuses_a_channel_the_tenant_has_not_configured(
    _running_service: _RecordingBus,
    _configured_targets: None,
) -> None:
    response = _client("tenant_admin", tenant_id="tenant-a").post(
        "/api/channels/test",
        json={"channel_name": "slack", "chat_id": "oc_a1"},
    )
    assert response.status_code == 403
    assert "slack" in response.json()["detail"]
    assert _running_service.published == []


def test_relay_refuses_when_the_tenant_has_configured_nothing(
    _running_service: _RecordingBus,
    _configured_targets: None,
) -> None:
    response = _client("tenant_admin", tenant_id="tenant-c").post(
        "/api/channels/test",
        json={"channel_name": "feishu", "chat_id": "oc_a1"},
    )
    assert response.status_code == 403
    assert _running_service.published == []
