"""add_knowledge_base_tables

Revision ID: a8c9d0e1f2a3
Revises: f1a2b3c4d5e6
Create Date: 2026-11-17 09:10:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
import sqlmodel


# revision identifiers, used by Alembic.
revision: str = 'a8c9d0e1f2a3'
down_revision: Union[str, Sequence[str], None] = 'f1a2b3c4d5e6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # --- knowledge_bases ---
    op.create_table(
        'knowledge_bases',
        sa.Column('id', sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column('tenant_id', sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column('user_id', sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column('name', sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column('description', sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column('embedding_model', sqlmodel.sql.sqltypes.AutoString(), nullable=True),
        sa.Column('chunk_size', sa.Integer(), nullable=False),
        sa.Column('chunk_overlap', sa.Integer(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('(CURRENT_TIMESTAMP)'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('(CURRENT_TIMESTAMP)'), nullable=False),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_knowledge_bases_tenant_id'), 'knowledge_bases', ['tenant_id'], unique=False)
    op.create_index(op.f('ix_knowledge_bases_user_id'), 'knowledge_bases', ['user_id'], unique=False)

    # --- knowledge_documents ---
    op.create_table(
        'knowledge_documents',
        sa.Column('id', sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column('kb_id', sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column('tenant_id', sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column('filename', sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column('content_type', sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column('file_size', sa.Integer(), nullable=False),
        sa.Column('status', sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column('chunk_count', sa.Integer(), nullable=False),
        sa.Column('error_message', sqlmodel.sql.sqltypes.AutoString(), nullable=True),
        sa.Column('created_by', sqlmodel.sql.sqltypes.AutoString(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('(CURRENT_TIMESTAMP)'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('(CURRENT_TIMESTAMP)'), nullable=False),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_knowledge_documents_kb_id'), 'knowledge_documents', ['kb_id'], unique=False)
    op.create_index(op.f('ix_knowledge_documents_tenant_id'), 'knowledge_documents', ['tenant_id'], unique=False)

    # --- knowledge_chunks ---
    op.create_table(
        'knowledge_chunks',
        sa.Column('id', sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column('kb_id', sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column('doc_id', sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column('tenant_id', sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column('chunk_index', sa.Integer(), nullable=False),
        sa.Column('content', sa.Text(), nullable=False),
        sa.Column('embedding_json', sa.Text(), nullable=True),
        sa.Column('token_count', sa.Integer(), nullable=False),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_knowledge_chunks_doc_id'), 'knowledge_chunks', ['doc_id'], unique=False)
    op.create_index(op.f('ix_knowledge_chunks_kb_id'), 'knowledge_chunks', ['kb_id'], unique=False)
    op.create_index(op.f('ix_knowledge_chunks_tenant_id'), 'knowledge_chunks', ['tenant_id'], unique=False)


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index(op.f('ix_knowledge_chunks_tenant_id'), table_name='knowledge_chunks')
    op.drop_index(op.f('ix_knowledge_chunks_kb_id'), table_name='knowledge_chunks')
    op.drop_index(op.f('ix_knowledge_chunks_doc_id'), table_name='knowledge_chunks')
    op.drop_table('knowledge_chunks')

    op.drop_index(op.f('ix_knowledge_documents_tenant_id'), table_name='knowledge_documents')
    op.drop_index(op.f('ix_knowledge_documents_kb_id'), table_name='knowledge_documents')
    op.drop_table('knowledge_documents')

    op.drop_index(op.f('ix_knowledge_bases_user_id'), table_name='knowledge_bases')
    op.drop_index(op.f('ix_knowledge_bases_tenant_id'), table_name='knowledge_bases')
    op.drop_table('knowledge_bases')
