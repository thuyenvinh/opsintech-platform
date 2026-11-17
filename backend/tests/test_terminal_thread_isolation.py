"""The LangGraph thread a terminal request resumes must belong to the caller.

``session_id`` is chosen by the browser, so two users can present the same
value. When it was used directly as the LangGraph ``thread_id`` they shared one
thread: calling /invoke with someone else's session id appended a message to
their history and streamed it back, and because /invoke writes ``tenant_id`` and
``user_id`` into the state it also took over ownership, which defeated the
owner check in /approve.

The thread id is now derived server-side from the caller's identity, so the
collision cannot happen in the first place.
"""

from __future__ import annotations

from app.gateway.routers.terminal import _graph_thread_id


def test_same_session_id_from_two_users_gives_two_threads() -> None:
    attacker = _graph_thread_id("tenant-a", "user-attacker", "task-123")
    victim = _graph_thread_id("tenant-a", "user-victim", "task-123")
    assert attacker != victim


def test_same_session_id_across_tenants_gives_two_threads() -> None:
    a = _graph_thread_id("tenant-a", "user-1", "task-123")
    b = _graph_thread_id("tenant-b", "user-1", "task-123")
    assert a != b


def test_same_caller_and_session_is_stable() -> None:
    """Resuming a thread has to land on the same id, or /approve finds nothing."""
    first = _graph_thread_id("tenant-a", "user-1", "task-123")
    second = _graph_thread_id("tenant-a", "user-1", "task-123")
    assert first == second


def test_caller_identity_is_present_in_the_thread_id() -> None:
    thread_id = _graph_thread_id("tenant-a", "user-1", "task-123")
    assert "tenant-a" in thread_id
    assert "user-1" in thread_id
    assert "task-123" in thread_id


def test_session_id_cannot_forge_another_callers_namespace() -> None:
    """A crafted session id must not collide with another caller's thread id.

    Without this property the namespace would be decorative: an attacker could
    pass a session id that reassembles the victim's prefix.
    """
    victim = _graph_thread_id("tenant-a", "user-victim", "task-123")
    forged = _graph_thread_id("tenant-a", "user-attacker", "task-123")
    crafted = _graph_thread_id("tenant-a", "user-attacker", "user-victim:task-123")
    assert crafted != victim
    assert forged != victim
