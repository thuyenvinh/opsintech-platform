"""A live SSH PTY belongs to one caller, and the session key has to say so.

``TerminalSessionManager`` used to key its sessions on ``(session_id, asset_id)``
alone. ``session_id`` is the browser's taskId, so two users who presented the
same value were handed the same logged-in shell on a production host, and the
prefix scan behind ``get_session`` let a short or guessed id resolve onto a
stranger's session.

The key now carries the authenticated tenant and user, resolved server-side by
every caller — the same identity triple ``_graph_thread_id`` derives the
LangGraph thread id from, so the two keys agree about who owns a session.
"""

from __future__ import annotations

import asyncio
from types import SimpleNamespace

import pytest

from app.services.terminal.session import TerminalSessionManager


@pytest.fixture()
def manager() -> TerminalSessionManager:
    """A private manager, so a test never depends on the process-wide one."""
    return TerminalSessionManager()


# ---------------------------------------------------------------------------
# The key
# ---------------------------------------------------------------------------


def test_same_session_id_from_two_users_gives_two_shells(manager: TerminalSessionManager) -> None:
    victim = manager.get_or_create_session("tenant-a", "u-victim", "task-123", "host-A")
    attacker = manager.get_or_create_session("tenant-a", "u-attacker", "task-123", "host-A")
    assert victim is not attacker
    assert len(manager.sessions) == 2


def test_same_session_id_across_tenants_gives_two_shells(manager: TerminalSessionManager) -> None:
    a = manager.get_or_create_session("tenant-a", "u-1", "task-123", "host-A")
    b = manager.get_or_create_session("tenant-b", "u-1", "task-123", "host-A")
    assert a is not b


def test_the_same_caller_reaching_its_own_session_twice_gets_one_object(
    manager: TerminalSessionManager,
) -> None:
    """Anything else and the shell breaks: a second PTY would replace the first."""
    first = manager.get_or_create_session("tenant-a", "u-1", "task-123", "host-A")
    second = manager.get_or_create_session("tenant-a", "u-1", "task-123", "host-A")
    assert first is second
    assert manager.get_session("tenant-a", "u-1", "task-123", "host-A") is first
    assert len(manager.sessions) == 1


def test_one_task_on_two_hosts_still_gets_two_shells(manager: TerminalSessionManager) -> None:
    a = manager.get_or_create_session("tenant-a", "u-1", "task-123", "host-A")
    b = manager.get_or_create_session("tenant-a", "u-1", "task-123", "host-B")
    assert a is not b
    assert manager.get_session("tenant-a", "u-1", "task-123", "host-B") is b


def test_the_session_records_its_owner(manager: TerminalSessionManager) -> None:
    session = manager.get_or_create_session("tenant-a", "u-1", "task-123", "host-A")
    assert session.tenant_id == "tenant-a"
    assert session.user_id == "u-1"
    assert session.session_id == "task-123"
    assert session.asset_id == "host-A"


# ---------------------------------------------------------------------------
# No lookup may leave the caller's own namespace
# ---------------------------------------------------------------------------


def test_lookup_with_another_callers_session_id_finds_nothing(
    manager: TerminalSessionManager,
) -> None:
    manager.get_or_create_session("tenant-a", "u-victim", "task-123", "host-A")
    assert manager.get_session("tenant-a", "u-attacker", "task-123", "host-A") is None
    assert manager.get_session("tenant-b", "u-victim", "task-123", "host-A") is None


def test_a_crafted_session_id_cannot_reassemble_another_namespace(
    manager: TerminalSessionManager,
) -> None:
    """Without this the namespace would be decorative.

    The key is a tuple, so a ``session_id`` carrying the separators of a joined
    string lands in a field of its own instead of shifting the identity fields.
    """
    victim = manager.get_or_create_session("tenant-a", "u-victim", "task-123", "host-A")
    for crafted in (
        "u-victim:task-123",
        "tenant-a:u-victim:task-123",
        "task-123:host-A",
        "task-123",
    ):
        forged = manager.get_or_create_session("tenant-a", "u-attacker", crafted, "host-A")
        assert forged is not victim
    assert manager.get_session("tenant-a", "u-victim", "task-123", "host-A") is victim


def test_a_short_session_id_no_longer_resolves_onto_a_longer_one(
    manager: TerminalSessionManager,
) -> None:
    """The deleted fallback matched ``key.startswith(f"{session_id}:")``."""
    victim = manager.get_or_create_session("tenant-a", "u-1", "task-123", "host-A")
    assert manager.get_session("tenant-a", "u-1", "task", "host-A") is None
    assert manager.get_session("tenant-a", "u-1", "task-123", "host") is None
    assert manager.get_session("tenant-a", "u-1", "task-123", "host-A") is victim


def test_get_session_requires_an_asset_id(manager: TerminalSessionManager) -> None:
    """The asset-less lookup was the scan; it is gone rather than narrowed."""
    manager.get_or_create_session("tenant-a", "u-1", "task-123", "host-A")
    with pytest.raises(ValueError):
        manager.get_session("tenant-a", "u-1", "task-123", "")


# ---------------------------------------------------------------------------
# An unidentified caller gets no shell at all
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("tenant_id", "user_id"),
    [("", "u-1"), ("tenant-a", ""), ("", ""), (None, "u-1"), ("tenant-a", None)],
)
def test_a_session_cannot_be_created_without_an_identity(
    manager: TerminalSessionManager, tenant_id, user_id
) -> None:
    """A blank namespace would be shared by everyone who fails to resolve."""
    with pytest.raises(ValueError):
        manager.get_or_create_session(tenant_id, user_id, "task-123", "host-A")
    assert manager.sessions == {}


# ---------------------------------------------------------------------------
# Closing
# ---------------------------------------------------------------------------


def test_closing_a_task_leaves_other_callers_shells_alone(
    manager: TerminalSessionManager,
) -> None:
    victim_a = manager.get_or_create_session("tenant-a", "u-victim", "task-123", "host-A")
    victim_b = manager.get_or_create_session("tenant-a", "u-victim", "task-123", "host-B")
    other_tenant = manager.get_or_create_session("tenant-b", "u-victim", "task-123", "host-A")
    mine = manager.get_or_create_session("tenant-a", "u-attacker", "task-123", "host-A")

    # No asset id: every host this caller holds for the task, and nothing else.
    manager.close_session("tenant-a", "u-attacker", "task-123")

    assert manager.get_session("tenant-a", "u-attacker", "task-123", "host-A") is None
    assert manager.get_session("tenant-a", "u-victim", "task-123", "host-A") is victim_a
    assert manager.get_session("tenant-a", "u-victim", "task-123", "host-B") is victim_b
    assert manager.get_session("tenant-b", "u-victim", "task-123", "host-A") is other_tenant
    assert mine not in manager.sessions.values()


def test_closing_one_host_leaves_the_callers_other_hosts_open(
    manager: TerminalSessionManager,
) -> None:
    manager.get_or_create_session("tenant-a", "u-1", "task-123", "host-A")
    b = manager.get_or_create_session("tenant-a", "u-1", "task-123", "host-B")
    manager.close_session("tenant-a", "u-1", "task-123", "host-A")
    assert manager.get_session("tenant-a", "u-1", "task-123", "host-A") is None
    assert manager.get_session("tenant-a", "u-1", "task-123", "host-B") is b


# ---------------------------------------------------------------------------
# Nothing to migrate: the manager is in-process memory
# ---------------------------------------------------------------------------


def test_sessions_live_only_in_this_process(manager: TerminalSessionManager) -> None:
    """A restart drops every session, so no old-format key can survive one.

    ``session_manager`` is a module-level instance holding a plain dict of
    objects that own an OS pty file descriptor and a forked ssh child. There is
    no store behind it.
    """
    manager.get_or_create_session("tenant-a", "u-1", "task-123", "host-A")
    assert TerminalSessionManager().sessions == {}

    from app.services.terminal import session as session_module

    assert isinstance(session_module.session_manager, TerminalSessionManager)
    assert isinstance(session_module.session_manager.sessions, dict)


# ---------------------------------------------------------------------------
# POST /execute keys on the caller the middleware authenticated
# ---------------------------------------------------------------------------


class _FakePTY:
    """Already connected, so the route does not try to fork ssh."""

    fd = 7


class _FakeSession:
    def __init__(self) -> None:
        self.pty = _FakePTY()
        self.commands: list[str] = []

    def start(self, cmd: list[str], env_updates: dict, temp_files: list[str]) -> None:
        """No ssh is forked here; only the key the route chose is under test."""

    async def execute_command(self, command: str, timeout_seconds: int = 30) -> dict:
        self.commands.append(command)
        return {"stdout": "ok", "stderr": "", "return_code": 0}


class _KeyRecordingManager:
    """Keys sessions exactly as the real manager does, and records the keys."""

    def __init__(self) -> None:
        self._real = TerminalSessionManager()
        self.sessions: dict[tuple, _FakeSession] = {}
        self.keys: list[tuple] = []

    def get_session(self, tenant_id, user_id, session_id, asset_id):
        key = self._real._get_key(tenant_id, user_id, session_id, asset_id)
        self.keys.append(key)
        return self.sessions.get(key)

    def get_or_create_session(self, tenant_id, user_id, session_id, asset_id):
        key = self._real._get_key(tenant_id, user_id, session_id, asset_id)
        self.keys.append(key)
        return self.sessions.setdefault(key, _FakeSession())


class _FakeDB:
    """Returns one asset for any query, so only the key is under test."""

    async def execute(self, _query):
        asset = SimpleNamespace(
            id="host-A",
            keychain_id=None,
            tenant_id="tenant-a",
            ip="10.0.0.1",
            port=22,
            username="root",
        )
        return SimpleNamespace(scalars=lambda: SimpleNamespace(first=lambda: asset))


def _execute_request(session_id: str = "task-123"):
    from app.gateway.routers import terminal as terminal_router

    return terminal_router.ExecuteCommandRequest(
        session_id=session_id, asset_id="host-A", command="id"
    )


def _call_execute(manager: _KeyRecordingManager, *, user_id, tenant_id="tenant-a"):
    from app.gateway.routers import terminal as terminal_router

    request = SimpleNamespace(state=SimpleNamespace(user_id=user_id, tenant_id=tenant_id))
    original = terminal_router.session_manager
    terminal_router.session_manager = manager
    try:
        return asyncio.run(
            terminal_router.execute_command_api(_execute_request(), request, _FakeDB())
        )
    finally:
        terminal_router.session_manager = original


def test_execute_gives_two_users_with_one_session_id_two_shells() -> None:
    manager = _KeyRecordingManager()
    _call_execute(manager, user_id="u-victim")
    _call_execute(manager, user_id="u-attacker")

    assert len(manager.sessions) == 2
    owners = {(key[0], key[1]) for key in manager.keys}
    assert owners == {("tenant-a", "u-victim"), ("tenant-a", "u-attacker")}


def test_execute_reuses_the_callers_own_shell() -> None:
    manager = _KeyRecordingManager()
    _call_execute(manager, user_id="u-1")
    _call_execute(manager, user_id="u-1")
    assert len(manager.sessions) == 1
    assert list(manager.sessions.values())[0].commands == ["id", "id"]


def test_execute_refuses_a_request_with_no_authenticated_user() -> None:
    """Without this the route would key on "unknown_user" and share one shell."""
    from fastapi import HTTPException

    manager = _KeyRecordingManager()
    with pytest.raises(HTTPException) as exc:
        _call_execute(manager, user_id=None)
    assert exc.value.status_code == 401
    assert manager.sessions == {}


def test_execute_refuses_a_request_with_no_tenant_context() -> None:
    from fastapi import HTTPException

    manager = _KeyRecordingManager()
    with pytest.raises(HTTPException) as exc:
        _call_execute(manager, user_id="u-1", tenant_id=None)
    assert exc.value.status_code == 400
    assert manager.sessions == {}


def test_the_pty_key_and_the_graph_thread_id_agree_on_the_owner() -> None:
    """Both are derived from (tenant_id, user_id, session_id), server-side."""
    from app.gateway.routers.terminal import _graph_thread_id

    manager = TerminalSessionManager()
    key = manager._get_key("tenant-a", "u-1", "task-123", "host-A")
    thread_id = _graph_thread_id("tenant-a", "u-1", "task-123")
    assert key[:3] == ("tenant-a", "u-1", "task-123")
    assert thread_id == "tenant-a:u-1:task-123"


# ---------------------------------------------------------------------------
# The agent tools resolve their own identity
# ---------------------------------------------------------------------------


def test_agent_tools_prefer_the_authenticated_tenant_context() -> None:
    """The run context the agent factory passes in is the fallback, not the source."""
    from deerflow.config.tenant_context import tenant_context

    import app.agent.terminal_tools as terminal_tools

    terminal_tools.set_terminal_context({"tenant_id": "tenant-claimed", "user_id": "u-claimed"})
    try:
        with tenant_context(user_id="u-real", tenant_id="tenant-real"):
            assert terminal_tools._get_identity() == ("tenant-real", "u-real")
        assert terminal_tools._get_identity() == ("tenant-claimed", "u-claimed")
    finally:
        terminal_tools.set_terminal_context({})


def test_agent_tools_open_no_session_without_an_identity() -> None:
    import app.agent.terminal_tools as terminal_tools

    terminal_tools.set_terminal_context({"terminal_session_id": "task-123"})
    try:
        assert terminal_tools._get_identity() == ("", "")
        assert asyncio.run(terminal_tools._ensure_session("host-A")) is None
    finally:
        terminal_tools.set_terminal_context({})
