"""Tenant terminal policy ceiling: combine semantics and route guards.

Also covers the two authorization holes in the same router that the ceiling
work touched: cross-user command approval, and the server-side URL fetcher.
"""

import asyncio
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.services.terminal.security import (
    DEFAULT_AUTO_APPROVAL,
    DEFAULT_SECURITY_CONFIG,
    CommandSecurityService,
    resolve_effective_policy,
)


def _request(
    *,
    user_role: str | None = None,
    tenant_role_value: str | None = None,
    tenant_id: str | None = "tenant-a",
    must_change_password: bool = False,
) -> SimpleNamespace:
    return SimpleNamespace(
        state=SimpleNamespace(
            user_id="u-1",
            user_role=user_role,
            tenant_role=tenant_role_value,
            tenant_id=tenant_id,
            must_change_password=must_change_password,
        )
    )


def _legacy_merge(config_data: dict) -> tuple[dict, dict]:
    """The merge both call sites did before the tenant ceiling existed.

    Reimplemented here on purpose: the backward-compatibility invariant is
    checked against an independent copy of the old behaviour, not against the
    new resolver's own internals.
    """
    security_config = {**DEFAULT_SECURITY_CONFIG, **config_data.get("security_config", {})}
    default_policy = DEFAULT_SECURITY_CONFIG.get("securityPolicy", {})
    saved_policy = config_data.get("security_config", {}).get("securityPolicy", {})
    security_config["securityPolicy"] = {**default_policy, **saved_policy}

    auto_approval = {**DEFAULT_AUTO_APPROVAL, **config_data.get("auto_approval", {})}
    default_actions = DEFAULT_AUTO_APPROVAL.get("actions", {})
    saved_actions = config_data.get("auto_approval", {}).get("actions", {})
    auto_approval["actions"] = {**default_actions, **saved_actions}

    return security_config, auto_approval


#: A member who has turned every protection off for themselves.
LOOSE_USER_SETTINGS = {
    "security_config": {
        "enableCommandSecurity": False,
        "enableStrictMode": False,
        "maxCommandLength": 999999,
        "blacklistPatterns": [],
        "whitelistPatterns": ["ls", "pwd", "rm", "dd"],
        "securityPolicy": {"askForBlacklist": True},
    },
    "auto_approval": {
        "enabled": True,
        "actions": {"executeAllCommands": True, "editFiles": True},
        "maxRequests": 100,
    },
}

#: What a tenant admin pins to close that hole.
STRICT_TENANT_POLICY = {
    "security_config": {
        "enableCommandSecurity": True,
        "enableStrictMode": True,
        "maxCommandLength": 500,
        "blacklistPatterns": ["rm -rf /", "shutdown"],
        "whitelistPatterns": ["ls", "pwd", "cat"],
        "securityPolicy": {"askForBlacklist": False},
    },
    "auto_approval": {
        "enabled": False,
        "actions": {"executeAllCommands": False, "editFiles": False},
        "maxRequests": 1,
    },
}


# ---------------------------------------------------------------------------
# Backward compatibility: an empty tenant policy changes nothing
# ---------------------------------------------------------------------------


def test_empty_policy_and_empty_user_settings_are_the_platform_defaults() -> None:
    security_config, auto_approval = resolve_effective_policy({}, {})
    assert security_config == DEFAULT_SECURITY_CONFIG
    assert auto_approval == DEFAULT_AUTO_APPROVAL


@pytest.mark.parametrize(
    "user_settings",
    [
        {},
        {"security_config": {}, "auto_approval": {}},
        LOOSE_USER_SETTINGS,
        {"security_config": {"maxCommandLength": 42}},
        {"auto_approval": {"actions": {"readFiles": False}}},
        {"security_config": {"securityPolicy": {"askForHigh": False}}},
    ],
)
def test_empty_tenant_policy_reproduces_the_legacy_merge(user_settings: dict) -> None:
    assert resolve_effective_policy({}, user_settings) == _legacy_merge(user_settings)


def test_missing_policy_rows_are_tolerated() -> None:
    """A tenant with no row, and a user with no row, both arrive as None."""
    assert resolve_effective_policy(None, None) == (
        DEFAULT_SECURITY_CONFIG,
        DEFAULT_AUTO_APPROVAL,
    )


def test_resolver_does_not_alias_the_module_level_defaults() -> None:
    security_config, auto_approval = resolve_effective_policy({}, {})
    security_config["enableCommandSecurity"] = False
    security_config["securityPolicy"]["blockCritical"] = False
    auto_approval["actions"]["executeAllCommands"] = True
    assert DEFAULT_SECURITY_CONFIG["enableCommandSecurity"] is True
    assert DEFAULT_SECURITY_CONFIG["securityPolicy"]["blockCritical"] is True
    assert DEFAULT_AUTO_APPROVAL["actions"]["executeAllCommands"] is False


# ---------------------------------------------------------------------------
# A member cannot loosen a pinned key
# ---------------------------------------------------------------------------


def test_tenant_on_wins_for_boolean_switches() -> None:
    security_config, _ = resolve_effective_policy(STRICT_TENANT_POLICY, LOOSE_USER_SETTINGS)
    assert security_config["enableCommandSecurity"] is True
    assert security_config["enableStrictMode"] is True


def test_max_command_length_takes_the_minimum() -> None:
    security_config, _ = resolve_effective_policy(STRICT_TENANT_POLICY, LOOSE_USER_SETTINGS)
    assert security_config["maxCommandLength"] == 500


def test_blacklist_patterns_are_unioned() -> None:
    user_settings = {"security_config": {"blacklistPatterns": ["curl * | sh"]}}
    security_config, _ = resolve_effective_policy(STRICT_TENANT_POLICY, user_settings)
    assert security_config["blacklistPatterns"] == ["rm -rf /", "shutdown", "curl * | sh"]


def test_an_emptied_user_blacklist_cannot_drop_a_pinned_pattern() -> None:
    security_config, _ = resolve_effective_policy(STRICT_TENANT_POLICY, LOOSE_USER_SETTINGS)
    assert security_config["blacklistPatterns"] == ["rm -rf /", "shutdown"]


def test_whitelist_patterns_are_intersected() -> None:
    security_config, _ = resolve_effective_policy(STRICT_TENANT_POLICY, LOOSE_USER_SETTINGS)
    assert security_config["whitelistPatterns"] == ["ls", "pwd"]
    assert "rm" not in security_config["whitelistPatterns"]
    assert "cat" not in security_config["whitelistPatterns"]


def test_auto_approval_is_anded() -> None:
    _, auto_approval = resolve_effective_policy(STRICT_TENANT_POLICY, LOOSE_USER_SETTINGS)
    assert auto_approval["enabled"] is False
    assert auto_approval["actions"]["executeAllCommands"] is False
    assert auto_approval["actions"]["editFiles"] is False


def test_auto_approval_actions_the_tenant_leaves_alone_keep_the_user_value() -> None:
    tenant_policy = {"auto_approval": {"actions": {"executeAllCommands": False}}}
    user_settings = {"auto_approval": {"enabled": True, "actions": {"readFiles": False}}}
    _, auto_approval = resolve_effective_policy(tenant_policy, user_settings)
    assert auto_approval["actions"]["executeAllCommands"] is False
    assert auto_approval["actions"]["readFiles"] is False
    assert auto_approval["enabled"] is True


def test_max_requests_takes_the_minimum() -> None:
    _, auto_approval = resolve_effective_policy(STRICT_TENANT_POLICY, LOOSE_USER_SETTINGS)
    assert auto_approval["maxRequests"] == 1


def test_pinned_security_policy_flags_win_per_key() -> None:
    user_settings = {
        "security_config": {"securityPolicy": {"askForBlacklist": True, "askForHigh": False}}
    }
    security_config, _ = resolve_effective_policy(STRICT_TENANT_POLICY, user_settings)
    assert security_config["securityPolicy"]["askForBlacklist"] is False
    assert security_config["securityPolicy"]["askForHigh"] is False
    assert security_config["securityPolicy"]["blockCritical"] is True


def test_dangerous_commands_are_unioned() -> None:
    tenant_policy = {"security_config": {"dangerousCommands": ["rm", "truncate"]}}
    user_settings = {"security_config": {"dangerousCommands": ["curl"]}}
    security_config, _ = resolve_effective_policy(tenant_policy, user_settings)
    assert security_config["dangerousCommands"] == ["rm", "truncate", "curl"]


def test_any_other_pinned_scalar_wins() -> None:
    tenant_policy = {"security_config": {"someFutureFlag": "tenant"}}
    user_settings = {"security_config": {"someFutureFlag": "user"}}
    security_config, _ = resolve_effective_policy(tenant_policy, user_settings)
    assert security_config["someFutureFlag"] == "tenant"


# ---------------------------------------------------------------------------
# A member can still tighten, and unpinned keys still belong to them
# ---------------------------------------------------------------------------


def test_a_stricter_user_value_is_honoured() -> None:
    user_settings = {
        "security_config": {
            "maxCommandLength": 100,
            "blacklistPatterns": ["rm -rf /", "shutdown", "nc -l"],
            "whitelistPatterns": ["ls"],
        },
        "auto_approval": {"enabled": False},
    }
    tenant_policy = {
        "security_config": {
            "maxCommandLength": 500,
            "blacklistPatterns": ["rm -rf /"],
            "whitelistPatterns": ["ls", "pwd", "cat"],
        },
        "auto_approval": {"enabled": True},
    }
    security_config, auto_approval = resolve_effective_policy(tenant_policy, user_settings)
    assert security_config["maxCommandLength"] == 100
    assert security_config["blacklistPatterns"] == ["rm -rf /", "shutdown", "nc -l"]
    assert security_config["whitelistPatterns"] == ["ls"]
    assert auto_approval["enabled"] is False


def test_keys_absent_from_the_tenant_policy_fall_through_to_the_user() -> None:
    tenant_policy = {"security_config": {"enableStrictMode": True}}
    user_settings = {"security_config": {"maxCommandLength": 42, "enableCommandSecurity": False}}
    security_config, _ = resolve_effective_policy(tenant_policy, user_settings)
    assert security_config["enableStrictMode"] is True
    assert security_config["maxCommandLength"] == 42
    assert security_config["enableCommandSecurity"] is False


def test_keys_absent_from_both_fall_through_to_the_default() -> None:
    tenant_policy = {"security_config": {"enableStrictMode": True}}
    security_config, auto_approval = resolve_effective_policy(tenant_policy, {})
    assert security_config["maxCommandLength"] == DEFAULT_SECURITY_CONFIG["maxCommandLength"]
    assert security_config["blacklistPatterns"] == DEFAULT_SECURITY_CONFIG["blacklistPatterns"]
    assert auto_approval == DEFAULT_AUTO_APPROVAL


# ---------------------------------------------------------------------------
# The ceiling actually reaches the evaluator
# ---------------------------------------------------------------------------


def test_self_service_hole_is_open_without_a_tenant_policy() -> None:
    """Documents the pre-policy behaviour the ceiling is there to close."""
    security_config, auto_approval = resolve_effective_policy({}, LOOSE_USER_SETTINGS)
    result = CommandSecurityService.evaluate_command(
        "rm -rf /", mode="agent", security_config=security_config, auto_approval=auto_approval
    )
    assert result.action == "allow"


def test_tenant_policy_closes_the_hole() -> None:
    security_config, auto_approval = resolve_effective_policy(
        STRICT_TENANT_POLICY, LOOSE_USER_SETTINGS
    )
    result = CommandSecurityService.evaluate_command(
        "rm -rf /", mode="agent", security_config=security_config, auto_approval=auto_approval
    )
    assert result.action == "block"
    assert result.risk_level == "critical"


def test_pinned_strict_mode_blocks_commands_the_user_whitelisted() -> None:
    security_config, auto_approval = resolve_effective_policy(
        STRICT_TENANT_POLICY, LOOSE_USER_SETTINGS
    )
    result = CommandSecurityService.evaluate_command(
        "dd if=/dev/zero of=/tmp/x",
        mode="agent",
        security_config=security_config,
        auto_approval=auto_approval,
    )
    assert result.action == "block"


# ---------------------------------------------------------------------------
# Route guards
# ---------------------------------------------------------------------------


def _route_guards(path: str, method: str) -> list:
    from app.gateway.routers import terminal as terminal_router

    for route in terminal_router.router.routes:
        if getattr(route, "path", None) == path and method in getattr(route, "methods", set()):
            return [dependency.dependency for dependency in route.dependencies]
    raise AssertionError(f"No {method} route at {path}")


def _run_guards(guards: list, request: SimpleNamespace) -> None:
    for guard in guards:
        guard(request)


def test_tenant_policy_put_is_rejected_for_a_member() -> None:
    guards = _route_guards("/tenant-policy", "PUT")
    assert guards, "PUT /tenant-policy declares no capability guard"
    with pytest.raises(HTTPException) as exc:
        _run_guards(guards, _request(tenant_role_value="tenant_member"))
    assert exc.value.status_code == 403
    assert "tenant.terminal_policy.write" in exc.value.detail


def test_tenant_policy_put_is_accepted_for_a_tenant_admin() -> None:
    _run_guards(_route_guards("/tenant-policy", "PUT"), _request(tenant_role_value="tenant_admin"))


def test_tenant_policy_put_is_rejected_for_a_platform_admin_without_membership() -> None:
    guards = _route_guards("/tenant-policy", "PUT")
    with pytest.raises(HTTPException) as exc:
        _run_guards(guards, _request(user_role="platform_admin", tenant_role_value=None))
    assert exc.value.status_code == 403


def test_tenant_policy_get_is_readable_by_a_member() -> None:
    """Members need to see what is pinned, so the read declares no extra guard."""
    assert _route_guards("/tenant-policy", "GET") == []


@pytest.mark.parametrize(
    ("path", "method"),
    [("/security-settings", "PUT"), ("/security-settings/reset", "POST")],
)
def test_own_security_settings_writes_require_the_member_capability(path: str, method: str) -> None:
    guards = _route_guards(path, method)
    assert guards, f"{method} {path} declares no capability guard"
    _run_guards(guards, _request(tenant_role_value="tenant_member"))
    _run_guards(guards, _request(tenant_role_value="tenant_admin"))
    with pytest.raises(HTTPException) as exc:
        _run_guards(guards, _request(tenant_role_value=None, tenant_id=None))
    assert exc.value.status_code == 400


@pytest.mark.parametrize(("path", "method"), [("/approve", "POST"), ("/web-fetch", "POST")])
def test_terminal_execution_routes_require_the_execute_capability(path: str, method: str) -> None:
    guards = _route_guards(path, method)
    assert guards, f"{method} {path} declares no capability guard"
    _run_guards(guards, _request(tenant_role_value="tenant_member"))
    with pytest.raises(HTTPException) as exc:
        _run_guards(guards, _request(tenant_role_value=None, tenant_id=None))
    assert exc.value.status_code == 400


# ---------------------------------------------------------------------------
# POST /approve may only resume the caller's own session
# ---------------------------------------------------------------------------


class _FakeGraph:
    def __init__(self, values: dict | None) -> None:
        self._values = values

    def get_state(self, config: dict) -> SimpleNamespace:
        return SimpleNamespace(values=self._values, next=())


def _approve_request(session_id: str = "thread-1") -> object:
    from app.gateway.routers import terminal as terminal_router

    return terminal_router.AgentApproveRequest(
        session_id=session_id, tool_call_id="call-1", approved=True
    )


def _call_approve(graph_values: dict | None, request: SimpleNamespace):
    import app.agent.terminal_graph as graph_module
    from app.gateway.routers import terminal as terminal_router

    original = graph_module.terminal_graph
    graph_module.terminal_graph = _FakeGraph(graph_values)
    try:
        return asyncio.run(terminal_router.agent_approve(_approve_request(), request))
    finally:
        graph_module.terminal_graph = original


def test_approve_rejects_a_session_owned_by_another_user() -> None:
    with pytest.raises(HTTPException) as exc:
        _call_approve(
            {"tenant_id": "tenant-a", "user_id": "victim"},
            _request(tenant_role_value="tenant_member"),
        )
    assert exc.value.status_code == 404
    assert exc.value.detail == "Session not found"


def test_approve_rejects_a_session_from_another_tenant() -> None:
    with pytest.raises(HTTPException) as exc:
        _call_approve(
            {"tenant_id": "tenant-b", "user_id": "u-1"},
            _request(tenant_role_value="tenant_member"),
        )
    assert exc.value.status_code == 404


def test_approve_reports_404_for_an_unknown_session() -> None:
    """404, not 403: the response must not confirm that a session id exists."""
    with pytest.raises(HTTPException) as exc:
        _call_approve({}, _request(tenant_role_value="tenant_member"))
    assert exc.value.status_code == 404


def test_approve_accepts_the_session_owner() -> None:
    from fastapi.responses import StreamingResponse

    response = _call_approve(
        {"tenant_id": "tenant-a", "user_id": "u-1"},
        _request(tenant_role_value="tenant_member"),
    )
    assert isinstance(response, StreamingResponse)


# ---------------------------------------------------------------------------
# POST /web-fetch may not reach internal addresses, on any hop
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "url",
    [
        "http://127.0.0.1/",
        "http://[::1]/",
        "http://169.254.169.254/latest/meta-data/",
        "http://10.0.0.5:5432/",
        "http://192.168.1.1/",
        "http://172.16.0.9/",
        "http://0.0.0.0/",
        "http://[::ffff:169.254.169.254]/",
        "http://2130706433/",
    ],
)
def test_internal_fetch_targets_are_refused(url: str) -> None:
    from app.gateway.routers import terminal as terminal_router

    with pytest.raises(HTTPException) as exc:
        asyncio.run(terminal_router.resolve_public_fetch_target(url))
    assert exc.value.status_code == 400


@pytest.mark.parametrize("url", ["ftp://example.com/x", "file:///etc/passwd", "gopher://x/"])
def test_non_http_schemes_are_refused(url: str) -> None:
    from app.gateway.routers import terminal as terminal_router

    with pytest.raises(HTTPException) as exc:
        asyncio.run(terminal_router.resolve_public_fetch_target(url))
    assert exc.value.detail == "Invalid URL scheme"


def test_a_public_target_is_pinned_to_its_resolved_address() -> None:
    from app.gateway.routers import terminal as terminal_router

    host, ip, port = asyncio.run(
        terminal_router.resolve_public_fetch_target("https://93.184.216.34/page")
    )
    assert (host, ip, port) == ("93.184.216.34", "93.184.216.34", 443)


class _FakeProc:
    def __init__(self, stdout: bytes) -> None:
        self.returncode = 0
        self._stdout = stdout

    async def communicate(self) -> tuple[bytes, bytes]:
        return self._stdout, b""


def _fetch_request(url: str) -> object:
    from app.gateway.routers import terminal as terminal_router

    return terminal_router.WebFetchRequest(url=url, asset_id="a-1", command="")


def _run_fetch(url: str, stdout: bytes, monkeypatch: pytest.MonkeyPatch) -> tuple[list, object]:
    from app.gateway.routers import terminal as terminal_router

    fetched: list[str] = []

    async def fake_exec(*cmd, **kwargs):
        fetched.append(cmd[-1])
        return _FakeProc(stdout)

    monkeypatch.setattr(asyncio, "create_subprocess_exec", fake_exec)

    async def run():
        return await terminal_router.web_fetch_proxy(
            _fetch_request(url), _request(tenant_role_value="tenant_member")
        )

    try:
        return fetched, asyncio.run(run())
    except HTTPException as exc:
        return fetched, exc


def test_web_fetch_does_not_let_curl_follow_redirects(monkeypatch: pytest.MonkeyPatch) -> None:
    from app.gateway.routers import terminal as terminal_router

    captured: list[tuple] = []

    async def fake_exec(*cmd, **kwargs):
        captured.append(cmd)
        return _FakeProc(f"ok\n{terminal_router.WEB_FETCH_META_MARKER}200\t".encode())

    monkeypatch.setattr(asyncio, "create_subprocess_exec", fake_exec)
    asyncio.run(
        terminal_router.web_fetch_proxy(
            _fetch_request("http://93.184.216.34/"), _request(tenant_role_value="tenant_member")
        )
    )
    cmd = captured[0]
    assert "-L" not in cmd
    assert "-sL" not in cmd
    assert "--resolve" in cmd
    assert "93.184.216.34:80:93.184.216.34" in cmd


def test_web_fetch_revalidates_a_redirect_to_the_metadata_endpoint(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from app.gateway.routers import terminal as terminal_router

    stdout = (
        f"<html>moved</html>\n{terminal_router.WEB_FETCH_META_MARKER}"
        f"302\thttp://169.254.169.254/latest/meta-data/"
    ).encode()
    fetched, outcome = _run_fetch("http://93.184.216.34/", stdout, monkeypatch)

    assert isinstance(outcome, HTTPException)
    assert outcome.status_code == 400
    assert fetched == ["http://93.184.216.34/"], "the redirect target was fetched anyway"


def test_web_fetch_gives_up_after_too_many_redirects(monkeypatch: pytest.MonkeyPatch) -> None:
    from app.gateway.routers import terminal as terminal_router

    stdout = (
        f"<html>moved</html>\n{terminal_router.WEB_FETCH_META_MARKER}"
        f"302\thttp://93.184.216.34/next"
    ).encode()
    fetched, outcome = _run_fetch("http://93.184.216.34/", stdout, monkeypatch)

    assert outcome == {"ok": False, "error": "Too many redirects", "content": ""}
    assert len(fetched) == terminal_router.MAX_WEB_FETCH_REDIRECTS + 1


def test_web_fetch_returns_cleaned_text_for_a_public_target(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from app.gateway.routers import terminal as terminal_router

    stdout = (
        f"<html><script>bad()</script><p>hello  world</p></html>\n"
        f"{terminal_router.WEB_FETCH_META_MARKER}200\t"
    ).encode()
    _, outcome = _run_fetch("http://93.184.216.34/", stdout, monkeypatch)
    assert outcome["ok"] is True
    assert outcome["content"] == "hello world"
