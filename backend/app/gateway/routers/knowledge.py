"""Knowledge Base (Native RAG) API router."""

import json
import logging
import uuid

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy import delete as sa_delete, func, select as sa_select
from sqlmodel.ext.asyncio.session import AsyncSession

from app.gateway.authorization import _is_tenant_admin, require_tenant_context
from app.models.knowledge import KnowledgeBase, KnowledgeChunk, KnowledgeDocument
from deerflow.database.session import get_session
from deerflow.rag.chunker import chunk_text
from deerflow.rag.embeddings import embed_texts
from deerflow.rag.extractor import extract_text_from_bytes
from deerflow.rag.retriever import search_knowledge_chunks

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/knowledge", tags=["knowledge"])

SHARED_USER_ID = "tenant-shared"


# ---------------------------------------------------------------------------
# Request / Response models
# ---------------------------------------------------------------------------


class KnowledgeBaseResponse(BaseModel):
    """Response model for a knowledge base."""

    id: str
    name: str
    description: str = ""
    embedding_model: str | None = None
    chunk_size: int = 800
    chunk_overlap: int = 120
    is_shared: bool = False
    doc_count: int = 0
    chunk_count: int = 0
    created_at: str | None = None
    updated_at: str | None = None


class KnowledgeBaseListResponse(BaseModel):
    """Response model for listing knowledge bases."""

    bases: list[KnowledgeBaseResponse]


class KnowledgeBaseCreateRequest(BaseModel):
    """Request body for creating a knowledge base."""

    name: str = Field(..., min_length=1, max_length=200, description="Knowledge base name")
    description: str = Field(default="", description="Optional description")
    is_shared: bool = Field(default=False, description="Whether shared across the tenant (admin only)")
    chunk_size: int = Field(default=800, ge=100, le=10000, description="Target chunk size in characters")
    chunk_overlap: int = Field(default=120, ge=0, le=5000, description="Overlap between adjacent chunks")


class KnowledgeDocumentResponse(BaseModel):
    """Response model for a knowledge document."""

    id: str
    kb_id: str
    filename: str
    content_type: str = "text/plain"
    file_size: int = 0
    status: str = "ready"
    chunk_count: int = 0
    error_message: str | None = None
    created_by: str | None = None
    created_at: str | None = None
    updated_at: str | None = None


class KnowledgeDocumentListResponse(BaseModel):
    """Response model for listing documents in a knowledge base."""

    documents: list[KnowledgeDocumentResponse]


class KnowledgeSearchRequest(BaseModel):
    """Request body for searching knowledge base chunks."""

    query: str = Field(..., min_length=1, description="Search query")
    kb_ids: list[str] | None = Field(default=None, description="Optional list of KB IDs to search")
    top_k: int = Field(default=5, ge=1, le=50, description="Maximum number of chunks to return")


class KnowledgeSearchResult(BaseModel):
    """Matched chunk returned from knowledge search."""

    kb_id: str
    kb_name: str = ""
    doc_id: str
    filename: str = ""
    chunk_index: int
    content: str
    score: float


class KnowledgeSearchResponse(BaseModel):
    """Response model for knowledge search."""

    results: list[KnowledgeSearchResult]


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _get_user_id(request: Request) -> str:
    user_id = getattr(request.state, "user_id", None)
    if not user_id:
        raise HTTPException(status_code=401, detail="Authentication required")
    return user_id


def _kb_to_response(
    kb: KnowledgeBase,
    *,
    doc_count: int = 0,
    chunk_count: int = 0,
) -> KnowledgeBaseResponse:
    return KnowledgeBaseResponse(
        id=kb.id,
        name=kb.name,
        description=kb.description or "",
        embedding_model=kb.embedding_model,
        chunk_size=kb.chunk_size,
        chunk_overlap=kb.chunk_overlap,
        is_shared=kb.user_id == SHARED_USER_ID,
        doc_count=doc_count,
        chunk_count=chunk_count,
        created_at=kb.created_at.isoformat() if kb.created_at else None,
        updated_at=kb.updated_at.isoformat() if kb.updated_at else None,
    )


def _doc_to_response(doc: KnowledgeDocument) -> KnowledgeDocumentResponse:
    return KnowledgeDocumentResponse(
        id=doc.id,
        kb_id=doc.kb_id,
        filename=doc.filename,
        content_type=doc.content_type,
        file_size=doc.file_size,
        status=doc.status,
        chunk_count=doc.chunk_count,
        error_message=doc.error_message,
        created_by=doc.created_by,
        created_at=doc.created_at.isoformat() if doc.created_at else None,
        updated_at=doc.updated_at.isoformat() if doc.updated_at else None,
    )


async def _get_accessible_kb(
    session: AsyncSession,
    request: Request,
    tenant_id: str,
    user_id: str,
    kb_id: str,
    *,
    require_write: bool = False,
) -> KnowledgeBase:
    result = await session.exec(
        sa_select(KnowledgeBase).where(
            KnowledgeBase.id == kb_id,
            KnowledgeBase.tenant_id == tenant_id,
        )
    )
    kb = result.scalars().first()
    if kb is None:
        raise HTTPException(status_code=404, detail=f"Knowledge base '{kb_id}' not found")

    is_shared = kb.user_id == SHARED_USER_ID
    if is_shared:
        if require_write and not _is_tenant_admin(request):
            raise HTTPException(status_code=403, detail="Only tenant admins can modify shared knowledge bases")
    elif kb.user_id != user_id:
        raise HTTPException(status_code=403, detail="Access denied to this knowledge base")

    return kb


# ---------------------------------------------------------------------------
# Knowledge Base endpoints
# ---------------------------------------------------------------------------


@router.get(
    "/bases",
    response_model=KnowledgeBaseListResponse,
    summary="List Knowledge Bases",
)
async def list_knowledge_bases(
    request: Request,
    session: AsyncSession = Depends(get_session),
) -> KnowledgeBaseListResponse:
    tenant_id = require_tenant_context(request)
    user_id = _get_user_id(request)

    result = await session.exec(
        sa_select(KnowledgeBase)
        .where(
            KnowledgeBase.tenant_id == tenant_id,
            (KnowledgeBase.user_id == user_id) | (KnowledgeBase.user_id == SHARED_USER_ID),
        )
        .order_by(KnowledgeBase.created_at.desc())
    )
    kbs = result.scalars().all()
    if not kbs:
        return KnowledgeBaseListResponse(bases=[])

    kb_ids = [kb.id for kb in kbs]

    doc_counts_res = await session.exec(
        sa_select(KnowledgeDocument.kb_id, func.count(KnowledgeDocument.id))
        .where(
            KnowledgeDocument.tenant_id == tenant_id,
            KnowledgeDocument.kb_id.in_(kb_ids),
        )
        .group_by(KnowledgeDocument.kb_id)
    )
    doc_counts = {row[0]: int(row[1]) for row in doc_counts_res.all()}

    chunk_counts_res = await session.exec(
        sa_select(KnowledgeChunk.kb_id, func.count(KnowledgeChunk.id))
        .where(
            KnowledgeChunk.tenant_id == tenant_id,
            KnowledgeChunk.kb_id.in_(kb_ids),
        )
        .group_by(KnowledgeChunk.kb_id)
    )
    chunk_counts = {row[0]: int(row[1]) for row in chunk_counts_res.all()}

    return KnowledgeBaseListResponse(
        bases=[
            _kb_to_response(
                kb,
                doc_count=doc_counts.get(kb.id, 0),
                chunk_count=chunk_counts.get(kb.id, 0),
            )
            for kb in kbs
        ]
    )


@router.post(
    "/bases",
    response_model=KnowledgeBaseResponse,
    status_code=201,
    summary="Create Knowledge Base",
)
async def create_knowledge_base(
    body: KnowledgeBaseCreateRequest,
    request: Request,
    session: AsyncSession = Depends(get_session),
) -> KnowledgeBaseResponse:
    tenant_id = require_tenant_context(request)
    user_id = _get_user_id(request)

    if body.is_shared and not _is_tenant_admin(request):
        raise HTTPException(status_code=403, detail="Only tenant admins can create shared knowledge bases")

    name = body.name.strip()
    if not name:
        raise HTTPException(status_code=422, detail="Knowledge base name must not be empty")

    if body.chunk_overlap >= body.chunk_size:
        raise HTTPException(status_code=422, detail="chunk_overlap must be smaller than chunk_size")

    target_user_id = SHARED_USER_ID if body.is_shared else user_id
    kb = KnowledgeBase(
        id=str(uuid.uuid4()),
        tenant_id=tenant_id,
        user_id=target_user_id,
        name=name,
        description=body.description or "",
        chunk_size=body.chunk_size,
        chunk_overlap=body.chunk_overlap,
    )
    session.add(kb)
    await session.commit()
    await session.refresh(kb)

    logger.info("Created knowledge base '%s' (id=%s) by user %s", kb.name, kb.id, user_id)
    return _kb_to_response(kb, doc_count=0, chunk_count=0)


@router.delete(
    "/bases/{kb_id}",
    status_code=204,
    summary="Delete Knowledge Base",
)
async def delete_knowledge_base(
    kb_id: str,
    request: Request,
    session: AsyncSession = Depends(get_session),
) -> None:
    tenant_id = require_tenant_context(request)
    user_id = _get_user_id(request)

    kb = await _get_accessible_kb(
        session,
        request,
        tenant_id,
        user_id,
        kb_id,
        require_write=True,
    )

    await session.exec(
        sa_delete(KnowledgeChunk).where(
            KnowledgeChunk.kb_id == kb_id,
            KnowledgeChunk.tenant_id == tenant_id,
        )
    )
    await session.exec(
        sa_delete(KnowledgeDocument).where(
            KnowledgeDocument.kb_id == kb_id,
            KnowledgeDocument.tenant_id == tenant_id,
        )
    )
    await session.delete(kb)
    await session.commit()
    logger.info("Deleted knowledge base id=%s by user %s", kb_id, user_id)


# ---------------------------------------------------------------------------
# Document endpoints
# ---------------------------------------------------------------------------


@router.get(
    "/bases/{kb_id}/documents",
    response_model=KnowledgeDocumentListResponse,
    summary="List Knowledge Documents",
)
async def list_knowledge_documents(
    kb_id: str,
    request: Request,
    session: AsyncSession = Depends(get_session),
) -> KnowledgeDocumentListResponse:
    tenant_id = require_tenant_context(request)
    user_id = _get_user_id(request)

    await _get_accessible_kb(session, request, tenant_id, user_id, kb_id, require_write=False)

    result = await session.exec(
        sa_select(KnowledgeDocument)
        .where(
            KnowledgeDocument.kb_id == kb_id,
            KnowledgeDocument.tenant_id == tenant_id,
        )
        .order_by(KnowledgeDocument.created_at.desc())
    )
    docs = result.scalars().all()
    return KnowledgeDocumentListResponse(documents=[_doc_to_response(d) for d in docs])


@router.post(
    "/bases/{kb_id}/documents",
    response_model=KnowledgeDocumentResponse,
    status_code=201,
    summary="Upload or Ingest Knowledge Document",
)
async def create_knowledge_document(
    kb_id: str,
    request: Request,
    file: UploadFile | None = File(default=None),
    title: str | None = Form(default=None),
    text: str | None = Form(default=None),
    session: AsyncSession = Depends(get_session),
) -> KnowledgeDocumentResponse:
    tenant_id = require_tenant_context(request)
    user_id = _get_user_id(request)

    kb = await _get_accessible_kb(session, request, tenant_id, user_id, kb_id, require_write=True)

    if file is not None:
        raw_bytes = await file.read()
        if not raw_bytes:
            raise HTTPException(status_code=422, detail="Uploaded file is empty")
        filename = (title or "").strip() or (file.filename or "document.txt")
        content_type = file.content_type or "application/octet-stream"
        file_size = len(raw_bytes)
        try:
            extracted_text = extract_text_from_bytes(
                filename=file.filename or filename,
                content=raw_bytes,
                content_type=file.content_type,
            )
        except (ValueError, RuntimeError) as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        except Exception as exc:
            logger.exception("Failed to extract text from uploaded file '%s'", filename)
            raise HTTPException(status_code=400, detail=f"Failed to extract text: {exc}") from exc
    elif text is not None and text.strip():
        extracted_text = text.strip()
        filename = (title or "").strip() or "Untitled Note"
        content_type = "text/plain"
        file_size = len(extracted_text.encode("utf-8"))
    else:
        raise HTTPException(status_code=422, detail="Either 'file' or non-empty 'text' must be provided")

    chunks = chunk_text(
        extracted_text,
        chunk_size=kb.chunk_size,
        chunk_overlap=kb.chunk_overlap,
    )
    if not chunks:
        raise HTTPException(status_code=422, detail="No text content could be extracted from the document")

    embeddings = await embed_texts(chunks, model=kb.embedding_model)

    doc_id = str(uuid.uuid4())
    doc = KnowledgeDocument(
        id=doc_id,
        kb_id=kb.id,
        tenant_id=tenant_id,
        filename=filename,
        content_type=content_type,
        file_size=file_size,
        status="ready",
        chunk_count=len(chunks),
        created_by=user_id,
    )
    session.add(doc)

    for idx, chunk_content in enumerate(chunks):
        emb_json: str | None = None
        if embeddings is not None and idx < len(embeddings):
            emb_json = json.dumps(embeddings[idx])
        session.add(
            KnowledgeChunk(
                id=str(uuid.uuid4()),
                kb_id=kb.id,
                doc_id=doc_id,
                tenant_id=tenant_id,
                chunk_index=idx,
                content=chunk_content,
                embedding_json=emb_json,
                token_count=len(chunk_content.split()),
            )
        )

    await session.commit()
    await session.refresh(doc)

    logger.info(
        "Ingested document '%s' (id=%s, chunks=%d) into kb=%s by user %s",
        doc.filename,
        doc.id,
        len(chunks),
        kb.id,
        user_id,
    )
    return _doc_to_response(doc)


@router.delete(
    "/bases/{kb_id}/documents/{doc_id}",
    status_code=204,
    summary="Delete Knowledge Document",
)
async def delete_knowledge_document(
    kb_id: str,
    doc_id: str,
    request: Request,
    session: AsyncSession = Depends(get_session),
) -> None:
    tenant_id = require_tenant_context(request)
    user_id = _get_user_id(request)

    await _get_accessible_kb(session, request, tenant_id, user_id, kb_id, require_write=True)

    result = await session.exec(
        sa_select(KnowledgeDocument).where(
            KnowledgeDocument.id == doc_id,
            KnowledgeDocument.kb_id == kb_id,
            KnowledgeDocument.tenant_id == tenant_id,
        )
    )
    doc = result.scalars().first()
    if doc is None:
        raise HTTPException(status_code=404, detail=f"Document '{doc_id}' not found")

    await session.exec(
        sa_delete(KnowledgeChunk).where(
            KnowledgeChunk.doc_id == doc_id,
            KnowledgeChunk.kb_id == kb_id,
            KnowledgeChunk.tenant_id == tenant_id,
        )
    )
    await session.delete(doc)
    await session.commit()
    logger.info("Deleted document id=%s from kb=%s by user %s", doc_id, kb_id, user_id)


# ---------------------------------------------------------------------------
# Search endpoint
# ---------------------------------------------------------------------------


@router.post(
    "/search",
    response_model=KnowledgeSearchResponse,
    summary="Search Knowledge Bases",
)
async def search_knowledge(
    body: KnowledgeSearchRequest,
    request: Request,
    session: AsyncSession = Depends(get_session),
) -> KnowledgeSearchResponse:
    tenant_id = require_tenant_context(request)
    user_id = _get_user_id(request)

    kb_query = sa_select(KnowledgeBase.id).where(
        KnowledgeBase.tenant_id == tenant_id,
        (KnowledgeBase.user_id == user_id) | (KnowledgeBase.user_id == SHARED_USER_ID),
    )
    if body.kb_ids is not None:
        if not body.kb_ids:
            return KnowledgeSearchResponse(results=[])
        kb_query = kb_query.where(KnowledgeBase.id.in_(body.kb_ids))

    kb_res = await session.exec(kb_query)
    accessible_kb_ids = list(kb_res.scalars().all())
    if not accessible_kb_ids:
        return KnowledgeSearchResponse(results=[])

    matches = await search_knowledge_chunks(
        tenant_id=tenant_id,
        query=body.query,
        kb_ids=accessible_kb_ids,
        user_id=user_id,
        top_k=body.top_k,
    )

    results = [
        KnowledgeSearchResult(
            kb_id=m["kb_id"],
            kb_name=m.get("kb_name", ""),
            doc_id=m["doc_id"],
            filename=m.get("filename", ""),
            chunk_index=m["chunk_index"],
            content=m["content"],
            score=float(m["score"]),
        )
        for m in matches
    ]
    return KnowledgeSearchResponse(results=results)
