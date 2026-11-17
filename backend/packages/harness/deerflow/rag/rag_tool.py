"""LangChain tool for searching tenant-scoped Native RAG knowledge bases."""

import logging

from langchain.tools import ToolRuntime, tool
from langgraph.typing import ContextT
from sqlmodel import select

from deerflow.agents.thread_state import ThreadState
from deerflow.database.session import get_session
from deerflow.rag.retriever import search_knowledge_chunks

logger = logging.getLogger(__name__)


async def _get_agent_kb_ids(
    tenant_id: str,
    agent_name: str,
    user_id: str | None,
) -> list[str] | None:
    """Resolve `knowledge_base_ids` from a CustomAgent's metadata if configured."""
    from app.models.agents import CustomAgent

    async for session in get_session():
        stmt = select(CustomAgent).where(
            CustomAgent.tenant_id == tenant_id,
            CustomAgent.name == agent_name,
        )
        if user_id:
            stmt = stmt.where(CustomAgent.user_id.in_([user_id, "tenant-shared"]))
        result = await session.exec(stmt)
        agents = list(result.all())
        if not agents:
            return None

        selected = next((a for a in agents if user_id and a.user_id == user_id), agents[0])
        meta = selected.meta_info or {}
        raw_ids = meta.get("knowledge_base_ids")
        if isinstance(raw_ids, list) and raw_ids:
            return [str(kb_id) for kb_id in raw_ids if kb_id]
        return None
    return None


@tool("search_knowledge_base")
async def search_knowledge_base(
    query: str,
    runtime: ToolRuntime[ContextT, ThreadState],
    kb_id: str | None = None,
    top_k: int = 5,
) -> str:
    """Search the tenant's knowledge bases for relevant documents and return cited excerpts.

    Args:
        query: Natural-language search query or keywords.
        kb_id: Optional specific knowledge base ID to search. When omitted, searches
            the current agent's configured knowledge bases or all accessible bases.
        top_k: Maximum number of excerpts to return (default 5).
    """
    configurable = runtime.config.get("configurable", {}) if runtime and runtime.config else {}
    context = runtime.context if runtime and runtime.context else {}

    tenant_id = configurable.get("tenant_id") or context.get("tenant_id")
    user_id = configurable.get("user_id") or context.get("user_id")
    agent_name = configurable.get("agent_name") or context.get("agent_name")

    if not tenant_id:
        return "Error: tenant_id is not available in runtime configuration."

    kb_ids: list[str] | None = [kb_id] if kb_id else None
    if kb_ids is None and agent_name and agent_name != "default":
        try:
            kb_ids = await _get_agent_kb_ids(tenant_id=tenant_id, agent_name=agent_name, user_id=user_id)
        except Exception as exc:
            logger.warning("Failed to load knowledge_base_ids for agent '%s': %s", agent_name, exc)

    results = await search_knowledge_chunks(
        tenant_id=tenant_id,
        query=query,
        kb_ids=kb_ids,
        user_id=user_id,
        top_k=max(1, min(top_k, 20)),
    )

    if not results:
        return "No relevant knowledge base entries found for your query."

    lines = [f"Found {len(results)} relevant excerpt(s) from the knowledge base:\n"]
    for idx, item in enumerate(results, start=1):
        lines.append(
            f"[{idx}] Source: {item['filename']} "
            f"(Knowledge Base: {item['kb_name']}, Chunk #{item['chunk_index']}, Score: {item['score']})"
        )
        lines.append(item["content"])
        lines.append("")

    return "\n".join(lines).strip()
