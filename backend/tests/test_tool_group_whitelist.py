"""Tool group whitelisting: the runtime filter and the API-side validation.

Part A covers :func:`deerflow.tools.tools.get_available_tools` — ``groups=None``
must keep returning exactly what it returned before the filter existed, and a
non-empty whitelist must keep only the named groups plus ungrouped plumbing.

Part B covers ``POST``/``PUT /api/agents`` — a tool group outside what the
tenant allows is rejected with 422, and the write endpoints require the
``agent.own.write`` capability.
"""

from __future__ import annotations

import asyncio

import pytest
from fastapi.testclient import TestClient
from langchain_core.tools import BaseTool, tool as make_tool
from sqlalchemy.ext.asyncio import AsyncEngine, async_sessionmaker, create_async_engine
from sqlmodel import SQLModel
from sqlmodel.ext.asyncio.session import AsyncSession

# Tools that belong to no group and must survive every whitelist.
PLUMBING = {"present_files", "ask_clarification", "search_knowledge_base"}

# The exact list get_available_tools(include_mcp=False) returned before the
# group filter was implemented: DEFAULT_COMMUNITY_TOOLS + BUILTIN_TOOLS.
UNFILTERED_TOOL_NAMES = [
    "web_search",
    "web_fetch",
    "image_search",
    "present_files",
    "ask_clarification",
    "ls",
    "read_file",
    "write_file",
    "str_replace",
    "bash",
    "search_knowledge_base",
]


def _names(tools: list[BaseTool]) -> list[str]:
    return [t.name for t in tools]


def _fake_mcp_tool(name: str) -> BaseTool:
    @make_tool(name)
    def _impl(query: str) -> str:
        """Fake MCP tool."""
        return query

    return _impl


@pytest.fixture()
def stub_app_config(monkeypatch):
    """Pin get_available_tools to a config with no models and no declared tools."""
    from deerflow.config.app_config import AppConfig
    from deerflow.config.sandbox_config import SandboxConfig
    from deerflow.tools import tools as tools_module

    config = AppConfig(sandbox=SandboxConfig(use="deerflow.sandbox.local:LocalSandboxProvider"))
    config.tool_search.enabled = False
    monkeypatch.setattr(tools_module, "get_app_config", lambda: config)
    return config


# ===========================================================================
# Part A — runtime filtering
# ===========================================================================


class TestGetAvailableToolsBackwardCompatibility:
    def test_groups_none_returns_the_pre_filter_tool_set(self, stub_app_config):
        from deerflow.tools.tools import BUILTIN_TOOLS, DEFAULT_COMMUNITY_TOOLS, get_available_tools

        # The pre-change body was `list(DEFAULT_COMMUNITY_TOOLS) + BUILTIN_TOOLS.copy()`.
        baseline = _names(DEFAULT_COMMUNITY_TOOLS) + _names(BUILTIN_TOOLS)
        assert baseline == UNFILTERED_TOOL_NAMES

        assert _names(get_available_tools(include_mcp=False)) == UNFILTERED_TOOL_NAMES
        assert _names(get_available_tools(groups=None, include_mcp=False)) == UNFILTERED_TOOL_NAMES

    def test_empty_whitelist_is_treated_as_no_restriction(self, stub_app_config):
        from deerflow.tools.tools import get_available_tools

        # Agents with an empty tool_groups column reach the runtime as [] or None.
        assert _names(get_available_tools(groups=[], include_mcp=False)) == UNFILTERED_TOOL_NAMES
        assert _names(get_available_tools(groups=["", "   "], include_mcp=False)) == UNFILTERED_TOOL_NAMES

    def test_subagent_tool_still_opt_in(self, stub_app_config):
        from deerflow.tools.tools import get_available_tools

        assert "task" not in _names(get_available_tools(include_mcp=False))
        assert "task" in _names(get_available_tools(include_mcp=False, subagent_enabled=True))
        # task is plumbing: a whitelist does not remove it.
        assert "task" in _names(get_available_tools(groups=["bash"], include_mcp=False, subagent_enabled=True))


class TestGetAvailableToolsGroupFilter:
    def test_single_group_returns_that_group_plus_plumbing(self, stub_app_config):
        from deerflow.tools.tools import get_available_tools

        names = set(_names(get_available_tools(groups=["file:read"], include_mcp=False)))
        assert names == PLUMBING | {"ls", "read_file"}

    def test_several_groups_union(self, stub_app_config):
        from deerflow.tools.tools import get_available_tools

        names = set(_names(get_available_tools(groups=["bash", "file:write"], include_mcp=False)))
        assert names == PLUMBING | {"bash", "write_file", "str_replace"}

    def test_web_group_covers_the_community_tools(self, stub_app_config):
        from deerflow.tools.tools import get_available_tools

        names = set(_names(get_available_tools(groups=["web"], include_mcp=False)))
        assert names == PLUMBING | {"web_search", "web_fetch", "image_search"}

    def test_unknown_group_grants_nothing_beyond_plumbing(self, stub_app_config):
        from deerflow.tools.tools import get_available_tools

        names = set(_names(get_available_tools(groups=["no-such-group"], include_mcp=False)))
        assert names == PLUMBING

    def test_config_declared_group_overrides_the_default_map(self, stub_app_config):
        from deerflow.config.tool_config import ToolConfig
        from deerflow.tools.tools import get_available_tools, resolve_tool_group

        stub_app_config.tools = [
            ToolConfig(name="bash", group="ops", use="deerflow.sandbox.tools:bash_tool")
        ]
        assert resolve_tool_group("bash", stub_app_config) == "ops"

        assert "bash" in _names(get_available_tools(groups=["ops"], include_mcp=False))
        assert "bash" not in _names(get_available_tools(groups=["bash"], include_mcp=False))


class TestGetAvailableToolsMcpFilter:
    @pytest.fixture(autouse=True)
    def _stub_mcp(self, monkeypatch):
        from deerflow.mcp import cache as mcp_cache

        tools = [
            _fake_mcp_tool("github_create_issue"),
            _fake_mcp_tool("github_list_repos"),
            _fake_mcp_tool("jira_search"),
        ]
        monkeypatch.setattr(mcp_cache, "get_cached_mcp_tools", lambda: tools)

    def test_no_whitelist_keeps_every_mcp_tool(self, stub_app_config):
        from deerflow.tools.tools import get_available_tools

        names = _names(get_available_tools())
        assert {"github_create_issue", "github_list_repos", "jira_search"} <= set(names)

    def test_whitelist_keeps_only_the_named_servers(self, stub_app_config):
        from deerflow.tools.tools import get_available_tools

        names = set(_names(get_available_tools(groups=["github"])))
        assert {"github_create_issue", "github_list_repos"} <= names
        assert "jira_search" not in names

    def test_whitelist_without_any_server_drops_all_mcp_tools(self, stub_app_config):
        from deerflow.tools.tools import get_available_tools

        names = set(_names(get_available_tools(groups=["bash"])))
        assert names == PLUMBING | {"bash"}

    def test_tool_search_defers_only_whitelisted_mcp_tools(self, stub_app_config):
        from deerflow.tools.builtins.tool_search import get_deferred_registry
        from deerflow.tools.tools import get_available_tools

        stub_app_config.tool_search.enabled = True
        names = set(_names(get_available_tools(groups=["github"])))
        assert "tool_search" in names

        registry = get_deferred_registry()
        assert registry is not None
        assert {e.name for e in registry.entries} == {"github_create_issue", "github_list_repos"}


# ===========================================================================
# Part B — API validation
# ===========================================================================


def _make_test_engine() -> AsyncEngine:
    return create_async_engine(
        "sqlite+aiosqlite://",
        echo=False,
        connect_args={"check_same_thread": False},
    )


async def _create_tables(engine: AsyncEngine) -> None:
    from app.models.agents import CustomAgent  # noqa: F401

    async with engine.begin() as conn:
        await conn.run_sync(SQLModel.metadata.create_all)


@pytest.fixture()
def session_factory():
    engine = _make_test_engine()
    asyncio.run(_create_tables(engine))
    factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    yield factory
    asyncio.run(engine.dispose())


@pytest.fixture()
def agent_client(session_factory, monkeypatch):
    """Agents router with one tenant MCP server registered: 'github'."""
    from fastapi import FastAPI, Request

    from app.gateway.routers import agents as agents_module
    from deerflow.database.session import get_session

    async def fake_available_mcp_servers(user_id, tenant_id, **kwargs):
        return [{"name": "github", "scope": "tenant", "enabled": True}]

    monkeypatch.setattr(agents_module, "get_available_mcp_servers", fake_available_mcp_servers)

    app = FastAPI()

    @app.middleware("http")
    async def inject_test_user(request: Request, call_next):
        request.state.user_id = request.headers.get("x-user-id", "user-a")
        request.state.tenant_id = request.headers.get("x-tenant-id", "tenant-a")
        role = request.headers.get("x-tenant-role", "tenant_member")
        if role:
            request.state.tenant_role = role
        return await call_next(request)

    async def override_get_session():
        async with session_factory() as session:
            yield session

    app.dependency_overrides[get_session] = override_get_session
    app.include_router(agents_module.router)

    with TestClient(app) as client:
        yield client


def _create(client: TestClient, name: str, tool_groups, **headers):
    return client.post(
        "/api/agents",
        json={"name": name, "system_prompt": "p", "tool_groups": tool_groups},
        headers=headers or None,
    )


class TestToolGroupValidation:
    def test_platform_tool_groups_are_accepted(self, agent_client):
        response = _create(agent_client, "platform-groups", ["bash", "file:read", "file:write", "web"])
        assert response.status_code == 201
        assert response.json()["tool_groups"] == ["bash", "file:read", "file:write", "web"]

    def test_tenant_mcp_server_is_accepted_as_a_tool_group(self, agent_client):
        response = _create(agent_client, "mcp-group", ["github"])
        assert response.status_code == 201
        assert response.json()["tool_groups"] == ["github"]

    def test_create_rejects_group_outside_the_tenant_allowed_set(self, agent_client):
        response = _create(agent_client, "escalating", ["gitlab-prod"])
        assert response.status_code == 422
        assert "gitlab-prod" in response.json()["detail"]

    def test_rejection_names_every_offending_group(self, agent_client):
        response = _create(agent_client, "escalating-2", ["bash", "gitlab-prod", "secret-mcp"])
        assert response.status_code == 422
        detail = response.json()["detail"]
        assert "gitlab-prod" in detail
        assert "secret-mcp" in detail
        assert "bash" not in detail

    def test_rejected_create_stores_nothing(self, agent_client):
        assert _create(agent_client, "not-stored", ["gitlab-prod"]).status_code == 422
        assert agent_client.get("/api/agents/not-stored").status_code == 404

    def test_update_rejects_group_outside_the_tenant_allowed_set(self, agent_client):
        assert _create(agent_client, "to-update", ["bash"]).status_code == 201

        response = agent_client.put("/api/agents/to-update", json={"tool_groups": ["gitlab-prod"]})
        assert response.status_code == 422
        assert "gitlab-prod" in response.json()["detail"]
        assert agent_client.get("/api/agents/to-update").json()["tool_groups"] == ["bash"]

    def test_update_accepts_an_allowed_group(self, agent_client):
        assert _create(agent_client, "to-widen", ["bash"]).status_code == 201

        response = agent_client.put("/api/agents/to-widen", json={"tool_groups": ["bash", "github"]})
        assert response.status_code == 200
        assert response.json()["tool_groups"] == ["bash", "github"]

    def test_clearing_tool_groups_is_always_allowed(self, agent_client):
        assert _create(agent_client, "to-clear", ["github"]).status_code == 201

        response = agent_client.put("/api/agents/to-clear", json={"tool_groups": None})
        assert response.status_code == 200
        assert response.json()["tool_groups"] == []

    def test_create_without_tool_groups_skips_validation(self, agent_client):
        response = agent_client.post(
            "/api/agents", json={"name": "no-groups", "system_prompt": "p"}
        )
        assert response.status_code == 201
        assert response.json()["tool_groups"] == []


class TestAgentWriteCapability:
    def test_member_holds_agent_own_write(self, agent_client):
        response = _create(agent_client, "member-agent", ["bash"], **{"x-tenant-role": "tenant_member"})
        assert response.status_code == 201

    def test_caller_without_tenant_membership_is_refused(self, agent_client):
        response = _create(agent_client, "no-membership", ["bash"], **{"x-tenant-role": ""})
        assert response.status_code == 403
        assert "agent.own.write" in response.json()["detail"]

    def test_update_and_delete_are_gated_too(self, agent_client):
        assert _create(agent_client, "gated", ["bash"]).status_code == 201

        no_role = {"x-tenant-role": ""}
        assert agent_client.put("/api/agents/gated", json={"description": "x"}, headers=no_role).status_code == 403
        assert agent_client.delete("/api/agents/gated", headers=no_role).status_code == 403
