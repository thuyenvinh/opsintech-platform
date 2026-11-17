"""Optional OpenAI-compatible async embeddings helper for Native RAG."""

import logging
import os

import httpx

logger = logging.getLogger(__name__)


async def embed_texts(texts: list[str], model: str | None = None) -> list[list[float]] | None:
    """Generate embeddings via an OpenAI-compatible `/embeddings` endpoint.

    Reads `RAG_EMBEDDING_BASE_URL`, `RAG_EMBEDDING_API_KEY`, and `RAG_EMBEDDING_MODEL`
    from environment variables. Returns `None` cleanly when unconfigured or on failure
    so lexical BM25 retrieval works out-of-the-box.
    """
    base_url = os.getenv("RAG_EMBEDDING_BASE_URL", "").strip().rstrip("/")
    if not base_url:
        return None

    if not texts:
        return []

    api_key = os.getenv("RAG_EMBEDDING_API_KEY", "").strip()
    embed_model = (model or os.getenv("RAG_EMBEDDING_MODEL", "")).strip() or "text-embedding-3-small"
    endpoint = base_url if base_url.endswith("/embeddings") else f"{base_url}/embeddings"

    headers = {"Content-Type": "application/json"}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"

    payload = {"input": texts, "model": embed_model}

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(endpoint, json=payload, headers=headers)
            response.raise_for_status()
            body = response.json()
        items = sorted(body.get("data", []), key=lambda item: item.get("index", 0))
        embeddings = [item["embedding"] for item in items if "embedding" in item]
        if len(embeddings) != len(texts):
            logger.warning(
                "Embedding count mismatch: expected %d, got %d; falling back to lexical search",
                len(texts),
                len(embeddings),
            )
            return None
        return embeddings
    except Exception as exc:
        logger.warning("RAG embedding request failed (%s); falling back to lexical search", exc)
        return None


async def embed_query(query: str, model: str | None = None) -> list[float] | None:
    """Embed a single search query, returning None if embeddings are unavailable."""
    result = await embed_texts([query], model=model)
    if not result:
        return None
    return result[0]
