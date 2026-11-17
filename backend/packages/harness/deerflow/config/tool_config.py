from pydantic import BaseModel, ConfigDict, Field


class ToolGroupConfig(BaseModel):
    """Config section for a tool group"""

    name: str = Field(..., description="Unique name for the tool group")
    model_config = ConfigDict(extra="allow")


class ToolConfig(BaseModel):
    """Config section for a tool"""

    name: str = Field(..., description="Unique name for the tool")
    group: str = Field(..., description="Group name for the tool")
    use: str = Field(
        ...,
        description="Variable name of the tool provider(e.g. deerflow.sandbox.tools:bash_tool)",
    )
    model_config = ConfigDict(extra="allow")


# Group membership of the tools that ship with the platform, keyed by tool name.
# A ToolConfig entry in config.yaml wins over this map for the tool it names. A
# tool named by neither belongs to no group: present_files, ask_clarification,
# task, view_image, tool_search and search_knowledge_base are plumbing, and a
# group whitelist never removes them.
DEFAULT_TOOL_GROUPS: dict[str, str] = {
    "web_search": "web",
    "web_fetch": "web",
    "image_search": "web",
    "ls": "file:read",
    "read_file": "file:read",
    "write_file": "file:write",
    "str_replace": "file:write",
    "bash": "bash",
}

# Group names the platform itself defines. A deployment may define more through
# ``tool_groups`` / ``tools`` in config.yaml, and every MCP server name acts as
# the group of the tools that server exposes.
BUILTIN_TOOL_GROUPS: frozenset[str] = frozenset(DEFAULT_TOOL_GROUPS.values())


def normalize_tool_groups(groups: list[str] | None) -> frozenset[str] | None:
    """Clean a tool group whitelist, returning ``None`` when it restricts nothing."""
    if not groups:
        return None
    names = {group.strip() for group in groups if isinstance(group, str) and group.strip()}
    return frozenset(names) or None
