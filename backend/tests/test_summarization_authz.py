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
    clear_summarization_config,
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
    """Keep each test's writes out of the next one.

    The PUT binds the new config to the caller's tenant in the process config
    registry; the module-level fallback is only restored defensively.
    """
    saved = get_summarization_config().model_copy(deep=True)
    clear_summarization_config()
    yield
    clear_summarization_config()
    set_summarization_config(saved)


@pytest.fixture
def _fake_store(monkeypatch) -> dict[str, dict[str, Any]]:
    """Stand in for the tenant-shared app payload row, keyed by tenant id.

    These tests run without a database; the persistence contract still has to
    be exercised, so the two store calls the router makes are replaced with an
    in-memory equivalent.
    """
    store: dict[str, dict[str, Any]] = {}

    async def _get(tenant_id: str) -> dict[str, Any]:
        return dict(store.get(tenant_id, {}))

    async def _set(tenant_id: str, patch: dict[str, Any]) -> None:
        store.setdefault(tenant_id, {}).update(patch)

    monkeypatch.setattr(summarization, "get_tenant_shared_app_payload", _get)
    monkeypatch.setattr(summarization, "set_tenant_shared_app_payload", _set)
    return store


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


def test_tenant_admin_can_change_summarization(_fake_store) -> None:
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
# Tenant scoping of the write
# ---------------------------------------------------------------------------


def test_write_does_not_leak_into_another_tenant(_fake_store) -> None:
    """The write binds to the caller's tenant, not to the worker.

    It used to assign a module-level global in
    ``deerflow/config/summarization_config.py``, so one tenant's write was
    served to every tenant on the same worker. The config is now held per
    tenant and persisted in the tenant-shared ``user_configs`` row.
    """
    _client("tenant_admin", tenant_id="tenant-a").put(
        SETTINGS_PATH, json={"trigger_tokens": 4242}
    )
    other = _client("tenant_member", tenant_id="tenant-b").get(SETTINGS_PATH)
    assert other.json()["trigger_tokens"] != 4242


def test_write_replaces_the_config_instead_of_mutating_it(_fake_store) -> None:
    """A write must not edit the object an in-flight agent run is reading.

    The handler used to mutate the object returned by
    ``get_summarization_config()`` in place before storing it, so the new value
    was already live even if the request failed afterwards.
    """
    client = _client("tenant_admin", tenant_id="tenant-a")

    client.put(SETTINGS_PATH, json={"trigger_tokens": 1111})
    held_by_a_reader = get_summarization_config("tenant-a")

    client.put(SETTINGS_PATH, json={"trigger_tokens": 2222})

    assert get_summarization_config("tenant-a") is not held_by_a_reader
    assert summarization._build_response(held_by_a_reader).trigger_tokens == 1111


def test_write_is_persisted_for_the_tenant(_fake_store) -> None:
    """The value lands in the tenant-shared app payload, not in a global."""
    _client("tenant_admin", tenant_id="tenant-a").put(
        SETTINGS_PATH, json={"trigger_tokens": 4242, "keep_messages": 7}
    )

    assert set(_fake_store) == {"tenant-a"}
    stored = _fake_store["tenant-a"]["summarization"]
    assert ("tokens", 4242) in [(t["type"], t["value"]) for t in stored["trigger"]]
    assert stored["keep"] == {"type": "messages", "value": 7}

    # A fresh worker (empty registry) serves the persisted value back.
    clear_summarization_config()
    reread = _client("tenant_member", tenant_id="tenant-a").get(SETTINGS_PATH)
    assert reread.json()["trigger_tokens"] == 4242
    assert reread.json()["keep_messages"] == 7


def test_write_that_cannot_be_persisted_is_reported(_fake_store, monkeypatch) -> None:
    """A settings write the store rejects must not come back as 200.

    The handler used to log the failure and return the new config anyway, so
    the admin saw their change accepted while no worker but this one had it and
    a restart dropped it entirely.

    ``_fake_store`` stands in for the read as well as the write; only the write
    is then made to fail, so this exercises the store rejecting a write rather
    than the whole database being absent.
    """
    async def _unavailable(tenant_id: str, patch: dict[str, Any]) -> None:
        raise OSError("config store is down")

    monkeypatch.setattr(summarization, "set_tenant_shared_app_payload", _unavailable)

    tenant = "tenant-persist-fail"
    response = _client("tenant_admin", tenant_id=tenant).put(
        SETTINGS_PATH, json={"trigger_tokens": 4242}
    )
    assert response.status_code == 503

    # and the rejected value must not be live on this worker either
    live = summarization._build_response(get_summarization_config(tenant))
    assert live.trigger_tokens != 4242
    assert tenant not in _fake_store
