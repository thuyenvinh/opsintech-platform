"""Hybrid BM25 + vector cosine similarity retriever for Native RAG."""

from collections import Counter
import json
import math
import re

from sqlmodel import select

from deerflow.database.session import get_session
from deerflow.rag.embeddings import embed_query

_TOKEN_RE = re.compile(r"\w+", re.UNICODE)


def _tokenize(text: str) -> list[str]:
    """Tokenize text into lowercase alphanumeric/Unicode word tokens."""
    return _TOKEN_RE.findall(text.lower())


def _compute_bm25_scores(
    query_tokens: list[str],
    docs_tokens: list[list[str]],
    k1: float = 1.5,
    b: float = 0.75,
) -> list[float]:
    """Compute BM25 relevance scores for a corpus of tokenized chunks."""
    num_docs = len(docs_tokens)
    if num_docs == 0 or not query_tokens:
        return [0.0] * num_docs

    avg_dl = sum(len(dt) for dt in docs_tokens) / num_docs
    if avg_dl == 0:
        return [0.0] * num_docs

    df: Counter[str] = Counter()
    for dt in docs_tokens:
        df.update(set(dt))

    unique_query = list(dict.fromkeys(query_tokens))
    scores: list[float] = []
    for dt in docs_tokens:
        dl = len(dt)
        tf_map = Counter(dt)
        score = 0.0
        for term in unique_query:
            tf = tf_map.get(term, 0)
            if tf == 0:
                continue
            doc_freq = df.get(term, 0)
            idf = math.log((num_docs - doc_freq + 0.5) / (doc_freq + 0.5) + 1.0)
            denom = tf + k1 * (1.0 - b + b * (dl / avg_dl))
            score += idf * ((tf * (k1 + 1.0)) / denom)
        scores.append(score)

    return scores


def _cosine_similarity(vec_a: list[float], vec_b: list[float]) -> float:
    """Compute non-negative cosine similarity between two equal-length vectors."""
    if not vec_a or len(vec_a) != len(vec_b):
        return 0.0
    dot = sum(a * b for a, b in zip(vec_a, vec_b))
    norm_a = math.sqrt(sum(a * a for a in vec_a))
    norm_b = math.sqrt(sum(b * b for b in vec_b))
    if norm_a == 0.0 or norm_b == 0.0:
        return 0.0
    return max(0.0, dot / (norm_a * norm_b))


async def search_knowledge_chunks(
    tenant_id: str,
    query: str,
    kb_ids: list[str] | None = None,
    user_id: str | None = None,
    top_k: int = 5,
) -> list[dict]:
    """Search tenant-scoped knowledge chunks using hybrid BM25 + optional vector similarity.

    Strictly filters by `tenant_id`. If `kb_ids` is provided, restricts to those
    knowledge bases; otherwise, if `user_id` is provided, restricts to knowledge
    bases owned by `user_id` or `"tenant-shared"`.
    """
    if not tenant_id or not query or not query.strip() or top_k <= 0:
        return []
    if kb_ids is not None and len(kb_ids) == 0:
        return []

    from app.models.knowledge import KnowledgeBase, KnowledgeChunk, KnowledgeDocument

    kbs: list[KnowledgeBase] = []
    docs: list[KnowledgeDocument] = []
    chunks: list[KnowledgeChunk] = []

    async for session in get_session():
        kb_stmt = select(KnowledgeBase).where(KnowledgeBase.tenant_id == tenant_id)
        if kb_ids is not None:
            kb_stmt = kb_stmt.where(KnowledgeBase.id.in_(kb_ids))
        elif user_id is not None:
            kb_stmt = kb_stmt.where(KnowledgeBase.user_id.in_([user_id, "tenant-shared"]))

        kb_res = await session.exec(kb_stmt)
        kbs = list(kb_res.all())
        if not kbs:
            return []

        target_kb_ids = [kb.id for kb in kbs]

        doc_stmt = select(KnowledgeDocument).where(
            KnowledgeDocument.tenant_id == tenant_id,
            KnowledgeDocument.kb_id.in_(target_kb_ids),
            KnowledgeDocument.status == "ready",
        )
        doc_res = await session.exec(doc_stmt)
        docs = list(doc_res.all())
        if not docs:
            return []

        ready_doc_ids = [doc.id for doc in docs]
        chunk_stmt = select(KnowledgeChunk).where(
            KnowledgeChunk.tenant_id == tenant_id,
            KnowledgeChunk.kb_id.in_(target_kb_ids),
            KnowledgeChunk.doc_id.in_(ready_doc_ids),
        )
        chunk_res = await session.exec(chunk_stmt)
        chunks = list(chunk_res.all())
        break

    if not chunks:
        return []

    kb_map = {kb.id: kb for kb in kbs}
    doc_map = {doc.id: doc for doc in docs}

    query_tokens = _tokenize(query)
    docs_tokens = [_tokenize(chunk.content) for chunk in chunks]
    raw_bm25 = _compute_bm25_scores(query_tokens, docs_tokens)
    max_bm25 = max(raw_bm25) if raw_bm25 else 0.0
    norm_bm25 = [s / max_bm25 if max_bm25 > 0.0 else 0.0 for s in raw_bm25]

    query_embedding: list[float] | None = None
    if any(chunk.embedding_json for chunk in chunks):
        embed_models = {kb.embedding_model for kb in kbs if kb.embedding_model}
        preferred_model = next(iter(embed_models)) if len(embed_models) == 1 else None
        query_embedding = await embed_query(query, model=preferred_model)

    scored: list[tuple[float, KnowledgeChunk]] = []
    for chunk, bm25_score in zip(chunks, norm_bm25):
        vec_score = 0.0
        has_vec = False
        if query_embedding is not None and chunk.embedding_json:
            try:
                chunk_vec = json.loads(chunk.embedding_json)
                if isinstance(chunk_vec, list):
                    vec_score = _cosine_similarity(query_embedding, chunk_vec)
                    has_vec = True
            except (ValueError, TypeError):
                has_vec = False

        final_score = (0.6 * vec_score + 0.4 * bm25_score) if has_vec else bm25_score
        if final_score > 0.0:
            scored.append((final_score, chunk))

    scored.sort(key=lambda item: item[0], reverse=True)

    results: list[dict] = []
    for final_score, chunk in scored[:top_k]:
        kb = kb_map.get(chunk.kb_id)
        doc = doc_map.get(chunk.doc_id)
        results.append(
            {
                "kb_id": chunk.kb_id,
                "kb_name": kb.name if kb else "",
                "doc_id": chunk.doc_id,
                "filename": doc.filename if doc else "",
                "chunk_index": chunk.chunk_index,
                "content": chunk.content,
                "score": round(float(final_score), 4),
            }
        )
    return results
