"""Knowledge Base (Native RAG) domain models."""

import uuid
from datetime import UTC, datetime

from sqlalchemy import Column, DateTime, Text, func
from sqlmodel import Field, SQLModel


def _utcnow() -> datetime:
    return datetime.now(UTC)


class KnowledgeBase(SQLModel, table=True):
    """Tenant-scoped knowledge base collection for Native RAG."""

    __tablename__ = "knowledge_bases"

    id: str = Field(default_factory=lambda: str(uuid.uuid4()), primary_key=True)
    tenant_id: str = Field(index=True)
    user_id: str = Field(index=True)  # owner user_id or "tenant-shared"
    name: str
    description: str = Field(default="")
    embedding_model: str | None = Field(default=None)
    chunk_size: int = Field(default=800)
    chunk_overlap: int = Field(default=120)
    created_at: datetime = Field(
        default_factory=_utcnow,
        sa_column=Column(DateTime(timezone=True), nullable=False, server_default=func.now()),
    )
    updated_at: datetime = Field(
        default_factory=_utcnow,
        sa_column=Column(DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()),
    )


class KnowledgeDocument(SQLModel, table=True):
    """Document uploaded and indexed into a KnowledgeBase."""

    __tablename__ = "knowledge_documents"

    id: str = Field(default_factory=lambda: str(uuid.uuid4()), primary_key=True)
    kb_id: str = Field(index=True)
    tenant_id: str = Field(index=True)
    filename: str
    content_type: str = Field(default="text/plain")
    file_size: int = Field(default=0)
    status: str = Field(default="ready")
    chunk_count: int = Field(default=0)
    error_message: str | None = Field(default=None)
    created_by: str | None = Field(default=None)
    created_at: datetime = Field(
        default_factory=_utcnow,
        sa_column=Column(DateTime(timezone=True), nullable=False, server_default=func.now()),
    )
    updated_at: datetime = Field(
        default_factory=_utcnow,
        sa_column=Column(DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()),
    )


class KnowledgeChunk(SQLModel, table=True):
    """Chunked text and optional embedding vector belonging to a KnowledgeDocument."""

    __tablename__ = "knowledge_chunks"

    id: str = Field(default_factory=lambda: str(uuid.uuid4()), primary_key=True)
    kb_id: str = Field(index=True)
    doc_id: str = Field(index=True)
    tenant_id: str = Field(index=True)
    chunk_index: int
    content: str = Field(sa_column=Column(Text, nullable=False))
    embedding_json: str | None = Field(default=None, sa_column=Column(Text, nullable=True))
    token_count: int = Field(default=0)
