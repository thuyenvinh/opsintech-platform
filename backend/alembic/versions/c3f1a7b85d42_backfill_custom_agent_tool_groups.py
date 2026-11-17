"""backfill_custom_agent_tool_groups

Until the tool-group whitelist was enforced, ``custom_agents.tool_groups`` was
decorative: ``get_available_tools`` ignored the ``groups`` argument entirely, so
an agent received every tool whatever the column said. The agent editor only
ever wrote MCP server names into it.

Now that the whitelist is enforced, a non-empty row restricts the agent to the
groups it names -- which would silently strip ``bash``, ``ls``, ``read_file``,
``write_file``, ``str_replace`` and the ``web`` tools from exactly those agents
whose owner had picked an MCP server. This appends the platform's builtin groups
to every non-empty row, so the stored value expresses the access the agent
effectively had before, and the owner's MCP selection is preserved.

Rows that are empty or null are left alone: empty already means unrestricted.

Revision ID: c3f1a7b85d42
Revises: b7d2e9f4a318
Create Date: 2026-11-17 16:20:00.000000

"""
import json
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'c3f1a7b85d42'
down_revision: Union[str, Sequence[str], None] = 'b7d2e9f4a318'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# Mirrors BUILTIN_TOOL_GROUPS in deerflow/config/tool_config.py. Spelled out
# rather than imported: a migration must keep meaning when that module changes.
BUILTIN_TOOL_GROUPS = ("bash", "file:read", "file:write", "web")

_agents = sa.table(
    "custom_agents",
    sa.column("id", sa.String),
    sa.column("tool_groups", sa.JSON),
)


def _as_list(value) -> list[str] | None:
    """Read a JSON column that may arrive as a list or as raw text."""
    if value is None:
        return None
    if isinstance(value, list):
        return [item for item in value if isinstance(item, str)]
    if isinstance(value, str):
        try:
            parsed = json.loads(value)
        except (TypeError, ValueError):
            return None
        if isinstance(parsed, list):
            return [item for item in parsed if isinstance(item, str)]
    return None


def upgrade() -> None:
    """Grant the builtin groups to agents that already named an MCP server."""
    bind = op.get_bind()
    rows = bind.execute(sa.select(_agents.c.id, _agents.c.tool_groups)).fetchall()

    for agent_id, raw in rows:
        groups = _as_list(raw)
        if not groups:
            continue
        missing = [group for group in BUILTIN_TOOL_GROUPS if group not in groups]
        if not missing:
            continue
        bind.execute(
            _agents.update()
            .where(_agents.c.id == agent_id)
            .values(tool_groups=groups + missing)
        )


def downgrade() -> None:
    """Strip the builtin groups back out, leaving the MCP server names."""
    bind = op.get_bind()
    rows = bind.execute(sa.select(_agents.c.id, _agents.c.tool_groups)).fetchall()

    for agent_id, raw in rows:
        groups = _as_list(raw)
        if not groups:
            continue
        remaining = [group for group in groups if group not in BUILTIN_TOOL_GROUPS]
        if len(remaining) == len(groups):
            continue
        bind.execute(
            _agents.update()
            .where(_agents.c.id == agent_id)
            .values(tool_groups=remaining)
        )
