import logging

from langchain.tools import BaseTool

from deerflow.community.duckduckgo.tools import web_fetch_tool, web_search_tool
from deerflow.community.image_search.tools import image_search_tool
from deerflow.config import get_app_config
from deerflow.config.app_config import AppConfig
from deerflow.config.tool_config import DEFAULT_TOOL_GROUPS, normalize_tool_groups
from deerflow.rag import search_knowledge_base
from deerflow.sandbox.tools import bash_tool, ls_tool, read_file_tool, str_replace_tool, write_file_tool
from deerflow.tools.builtins import ask_clarification_tool, present_file_tool, task_tool, view_image_tool
from deerflow.tools.builtins.tool_search import reset_deferred_registry

logger = logging.getLogger(__name__)

BUILTIN_TOOLS = [
    present_file_tool,
    ask_clarification_tool,
    ls_tool,
    read_file_tool,
    write_file_tool,
    str_replace_tool,
    bash_tool,
    search_knowledge_base,
]

DEFAULT_COMMUNITY_TOOLS = [
    web_search_tool,
    web_fetch_tool,
    image_search_tool,
]

SUBAGENT_TOOLS = [
    task_tool,
]


def resolve_tool_group(tool_name: str, config: AppConfig) -> str | None:
    """Group a platform tool belongs to, or ``None`` when it belongs to none."""
    declared = config.get_tool_config(tool_name)
    if declared is not None:
        return declared.group
    return DEFAULT_TOOL_GROUPS.get(tool_name)


def _platform_tool_allowed(tool: BaseTool, groups: frozenset[str], config: AppConfig) -> bool:
    group = resolve_tool_group(tool.name, config)
    return group is None or group in groups


def _mcp_tool_allowed(tool: BaseTool, groups: frozenset[str]) -> bool:
    """Whether an MCP tool comes from a whitelisted server.

    MCP tools are loaded with ``tool_name_prefix=True``, so their names carry a
    ``<server>_`` prefix. The server name is the group. Where one server name is
    an underscore-separated prefix of another (``github`` / ``github_cloud``),
    the shorter group also matches the longer server's tools — both servers are
    registered for the same tenant, so this widens the agent's whitelist but
    never reaches past what the tenant allows.
    """
    return any(tool.name == group or tool.name.startswith(f"{group}_") for group in groups)


def get_available_tools(
    groups: list[str] | None = None,
    include_mcp: bool = True,
    model_name: str | None = None,
    subagent_enabled: bool = False,
) -> list[BaseTool]:
    """Get all available tools.

    Loads builtin sandbox tools, default community tools (DuckDuckGo),
    conditionally-enabled subagent/vision tools, and MCP tools.

    Args:
        groups: Tool group whitelist. ``None`` or an empty list means no
            restriction. A non-empty list keeps only the tools belonging to the
            named groups: platform tools are matched through
            ``config.tools[].group`` and :data:`DEFAULT_TOOL_GROUPS`, MCP tools
            through the ``<server>_`` prefix in their name. Ungrouped plumbing
            tools are always kept, and when tool search is active only the
            whitelisted MCP tools reach the deferred registry.
        include_mcp: Whether to include tools from MCP servers (default: True).
        model_name: Optional model name to determine if vision tools should be included.
        subagent_enabled: Whether to include subagent tools (task).

    Returns:
        List of available tools.
    """
    config = get_app_config()
    allowed_groups = normalize_tool_groups(groups)

    # Default community tools (DuckDuckGo — free, no API key needed).
    # Users who want premium providers register MCP tools through the admin UI.
    loaded_tools: list[BaseTool] = list(DEFAULT_COMMUNITY_TOOLS)

    # Conditionally add tools based on config
    builtin_tools = BUILTIN_TOOLS.copy()

    # Add subagent tools only if enabled via runtime parameter
    if subagent_enabled:
        builtin_tools.extend(SUBAGENT_TOOLS)
        logger.info("Including subagent tools (task)")

    # If no model_name specified, use the first model (default)
    if model_name is None and config.models:
        model_name = config.models[0].name

    # Add view_image_tool only if the model supports vision
    model_config = config.get_model_config(model_name) if model_name else None
    if model_config is not None and model_config.supports_vision:
        builtin_tools.append(view_image_tool)
        logger.info(f"Including view_image_tool for model '{model_name}' (supports_vision=True)")

    # Get cached MCP tools if enabled
    # NOTE: MCP servers are now managed by tenant administrators in the database,
    # not loaded from extensions_config.json file.
    mcp_tools = []
    # Reset deferred registry upfront to prevent stale state from previous calls
    reset_deferred_registry()
    if include_mcp:
        try:
            from deerflow.mcp.cache import get_cached_mcp_tools

            mcp_tools = get_cached_mcp_tools()
            if allowed_groups is not None:
                kept = [t for t in mcp_tools if _mcp_tool_allowed(t, allowed_groups)]
                if len(kept) != len(mcp_tools):
                    logger.info(f"Tool group whitelist dropped {len(mcp_tools) - len(kept)} MCP tool(s)")
                mcp_tools = kept
            if mcp_tools:
                logger.info(f"Using {len(mcp_tools)} cached MCP tool(s)")

                # When tool_search is enabled, register MCP tools in the
                # deferred registry and add tool_search to builtin tools.
                if config.tool_search.enabled:
                    from deerflow.tools.builtins.tool_search import DeferredToolRegistry, set_deferred_registry
                    from deerflow.tools.builtins.tool_search import tool_search as tool_search_tool

                    registry = DeferredToolRegistry()
                    for t in mcp_tools:
                        registry.register(t)
                    set_deferred_registry(registry)
                    builtin_tools.append(tool_search_tool)
                    logger.info(f"Tool search active: {len(mcp_tools)} tools deferred")
        except ImportError:
            logger.warning("MCP module not available. Install 'langchain-mcp-adapters' package to enable MCP tools.")
        except Exception as e:
            logger.error(f"Failed to get cached MCP tools: {e}")

    if allowed_groups is not None:
        loaded_tools = [t for t in loaded_tools if _platform_tool_allowed(t, allowed_groups, config)]
        builtin_tools = [t for t in builtin_tools if _platform_tool_allowed(t, allowed_groups, config)]
        logger.info(f"Tool group whitelist applied: {sorted(allowed_groups)}")

    logger.info(f"Total tools loaded: {len(loaded_tools)}, built-in tools: {len(builtin_tools)}, MCP tools: {len(mcp_tools)}")
    return loaded_tools + builtin_tools + mcp_tools
