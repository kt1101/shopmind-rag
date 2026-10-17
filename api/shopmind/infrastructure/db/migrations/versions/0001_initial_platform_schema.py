"""initial platform schema

Revision ID: 0001
Revises: 
Create Date: 2026-10-17 10:27:12.093409
"""
from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = '0001'
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Generated from shopmind.infrastructure.db.models (alembic revision --autogenerate).
    op.create_table('chat_sessions',
    sa.Column('id', sa.String(length=64), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_chat_sessions'))
    )
    op.create_table('click_events',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('trace_id', sa.String(length=64), nullable=False),
    sa.Column('product_id', sa.String(length=64), nullable=False),
    sa.Column('rank', sa.Integer(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_click_events'))
    )
    with op.batch_alter_table('click_events', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_click_events_created_at'), ['created_at'], unique=False)
        batch_op.create_index(batch_op.f('ix_click_events_trace_id'), ['trace_id'], unique=False)

    op.create_table('config_profiles',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('name', sa.String(length=128), nullable=False),
    sa.Column('overrides', sa.JSON().with_variant(postgresql.JSONB(astext_type=sa.Text()), 'postgresql'), nullable=False),
    sa.Column('active', sa.Boolean(), nullable=False),
    sa.Column('created_by', sa.String(length=64), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('activated_at', sa.DateTime(timezone=True), nullable=True),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_config_profiles'))
    )
    op.create_table('eval_runs',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('run_key', sa.String(length=300), nullable=False),
    sa.Column('name', sa.String(length=200), nullable=False),
    sa.Column('kind', sa.String(length=8), nullable=False),
    sa.Column('metrics', sa.JSON().with_variant(postgresql.JSONB(astext_type=sa.Text()), 'postgresql'), nullable=False),
    sa.Column('config', sa.JSON().with_variant(postgresql.JSONB(astext_type=sa.Text()), 'postgresql'), nullable=False),
    sa.Column('details', sa.JSON().with_variant(postgresql.JSONB(astext_type=sa.Text()), 'postgresql'), nullable=True),
    sa.Column('summary', sa.Text(), nullable=True),
    sa.Column('job_id', sa.Integer(), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('imported_at', sa.DateTime(timezone=True), nullable=False),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_eval_runs')),
    sa.UniqueConstraint('run_key', name=op.f('uq_eval_runs_run_key'))
    )
    op.create_table('feedback',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('target', sa.String(length=16), nullable=False),
    sa.Column('trace_id', sa.String(length=64), nullable=True),
    sa.Column('rating', sa.Integer(), nullable=False),
    sa.Column('product_id', sa.String(length=64), nullable=True),
    sa.Column('query', sa.String(length=1000), nullable=True),
    sa.Column('comment', sa.Text(), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_feedback'))
    )
    with op.batch_alter_table('feedback', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_feedback_created_at'), ['created_at'], unique=False)
        batch_op.create_index(batch_op.f('ix_feedback_trace_id'), ['trace_id'], unique=False)

    op.create_table('jobs',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('type', sa.String(length=64), nullable=False),
    sa.Column('status', sa.String(length=16), nullable=False),
    sa.Column('params', sa.JSON().with_variant(postgresql.JSONB(astext_type=sa.Text()), 'postgresql'), nullable=False),
    sa.Column('result', sa.JSON().with_variant(postgresql.JSONB(astext_type=sa.Text()), 'postgresql'), nullable=True),
    sa.Column('log', sa.Text(), nullable=False),
    sa.Column('error', sa.Text(), nullable=True),
    sa.Column('created_by', sa.String(length=64), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('started_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('finished_at', sa.DateTime(timezone=True), nullable=True),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_jobs'))
    )
    with op.batch_alter_table('jobs', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_jobs_status'), ['status'], unique=False)
        batch_op.create_index(batch_op.f('ix_jobs_type'), ['type'], unique=False)

    op.create_table('pipeline_traces',
    sa.Column('trace_id', sa.String(length=64), nullable=False),
    sa.Column('kind', sa.String(length=32), nullable=True),
    sa.Column('pipeline', sa.String(length=64), nullable=True),
    sa.Column('duration_ms', sa.Float(), nullable=True),
    sa.Column('input_summary', sa.String(length=500), nullable=True),
    sa.Column('data', sa.JSON().with_variant(postgresql.JSONB(astext_type=sa.Text()), 'postgresql'), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.PrimaryKeyConstraint('trace_id', name=op.f('pk_pipeline_traces'))
    )
    with op.batch_alter_table('pipeline_traces', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_pipeline_traces_created_at'), ['created_at'], unique=False)
        batch_op.create_index(batch_op.f('ix_pipeline_traces_kind'), ['kind'], unique=False)

    op.create_table('policies',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('policy_id', sa.String(length=64), nullable=False),
    sa.Column('section_id', sa.String(length=128), nullable=False),
    sa.Column('title', sa.String(length=300), nullable=False),
    sa.Column('content', sa.Text(), nullable=False),
    sa.Column('policy_type', sa.String(length=64), nullable=False),
    sa.Column('version', sa.Integer(), nullable=False),
    sa.Column('status', sa.String(length=16), nullable=False),
    sa.Column('effective_date', sa.String(length=32), nullable=True),
    sa.Column('source_url', sa.String(length=500), nullable=True),
    sa.Column('extra', sa.JSON().with_variant(postgresql.JSONB(astext_type=sa.Text()), 'postgresql'), nullable=True),
    sa.Column('published_version', sa.Integer(), nullable=True),
    sa.Column('published_snapshot', sa.JSON().with_variant(postgresql.JSONB(astext_type=sa.Text()), 'postgresql'), nullable=True),
    sa.Column('updated_by', sa.String(length=64), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_policies')),
    sa.UniqueConstraint('section_id', name=op.f('uq_policies_section_id'))
    )
    op.create_table('products_overlay',
    sa.Column('product_id', sa.String(length=64), nullable=False),
    sa.Column('price_amount', sa.Float(), nullable=False),
    sa.Column('currency', sa.String(length=8), nullable=False),
    sa.Column('in_stock', sa.Boolean(), nullable=False),
    sa.Column('quantity', sa.Integer(), nullable=False),
    sa.Column('synthetic', sa.Boolean(), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
    sa.PrimaryKeyConstraint('product_id', name=op.f('pk_products_overlay'))
    )
    op.create_table('relevance_judgments',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('query', sa.String(length=1000), nullable=False),
    sa.Column('product_id', sa.String(length=64), nullable=False),
    sa.Column('grade', sa.Integer(), nullable=False),
    sa.Column('annotator', sa.String(length=64), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_relevance_judgments')),
    sa.UniqueConstraint('query', 'product_id', 'annotator', name='uq_relevance_judgments_item_annotator')
    )
    with op.batch_alter_table('relevance_judgments', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_relevance_judgments_query'), ['query'], unique=False)

    op.create_table('search_events',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('trace_id', sa.String(length=64), nullable=True),
    sa.Column('kind', sa.String(length=32), nullable=False),
    sa.Column('query', sa.String(length=1000), nullable=True),
    sa.Column('mode', sa.String(length=32), nullable=True),
    sa.Column('pipeline', sa.String(length=64), nullable=True),
    sa.Column('latency_ms', sa.Float(), nullable=True),
    sa.Column('result_count', sa.Integer(), nullable=True),
    sa.Column('filters', sa.JSON().with_variant(postgresql.JSONB(astext_type=sa.Text()), 'postgresql'), nullable=True),
    sa.Column('session_id', sa.String(length=64), nullable=True),
    sa.Column('intent', sa.String(length=32), nullable=True),
    sa.Column('insufficient_evidence', sa.Boolean(), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_search_events'))
    )
    with op.batch_alter_table('search_events', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_search_events_created_at'), ['created_at'], unique=False)
        batch_op.create_index('ix_search_events_kind_created', ['kind', 'created_at'], unique=False)
        batch_op.create_index(batch_op.f('ix_search_events_trace_id'), ['trace_id'], unique=False)

    op.create_table('users',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('username', sa.String(length=64), nullable=False),
    sa.Column('password_hash', sa.String(length=128), nullable=False),
    sa.Column('role', sa.String(length=32), nullable=False),
    sa.Column('active', sa.Boolean(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('last_login_at', sa.DateTime(timezone=True), nullable=True),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_users')),
    sa.UniqueConstraint('username', name=op.f('uq_users_username'))
    )
    op.create_table('chat_messages',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('session_id', sa.String(length=64), nullable=False),
    sa.Column('role', sa.String(length=16), nullable=False),
    sa.Column('content', sa.Text(), nullable=False),
    sa.Column('extra', sa.JSON().with_variant(postgresql.JSONB(astext_type=sa.Text()), 'postgresql'), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['session_id'], ['chat_sessions.id'], name=op.f('fk_chat_messages_session_id_chat_sessions'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_chat_messages'))
    )
    with op.batch_alter_table('chat_messages', schema=None) as batch_op:
        batch_op.create_index('ix_chat_messages_session_created', ['session_id', 'id'], unique=False)



def downgrade() -> None:
    # Generated from shopmind.infrastructure.db.models (alembic revision --autogenerate).
    with op.batch_alter_table('chat_messages', schema=None) as batch_op:
        batch_op.drop_index('ix_chat_messages_session_created')

    op.drop_table('chat_messages')
    op.drop_table('users')
    with op.batch_alter_table('search_events', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_search_events_trace_id'))
        batch_op.drop_index('ix_search_events_kind_created')
        batch_op.drop_index(batch_op.f('ix_search_events_created_at'))

    op.drop_table('search_events')
    with op.batch_alter_table('relevance_judgments', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_relevance_judgments_query'))

    op.drop_table('relevance_judgments')
    op.drop_table('products_overlay')
    op.drop_table('policies')
    with op.batch_alter_table('pipeline_traces', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_pipeline_traces_kind'))
        batch_op.drop_index(batch_op.f('ix_pipeline_traces_created_at'))

    op.drop_table('pipeline_traces')
    with op.batch_alter_table('jobs', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_jobs_type'))
        batch_op.drop_index(batch_op.f('ix_jobs_status'))

    op.drop_table('jobs')
    with op.batch_alter_table('feedback', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_feedback_trace_id'))
        batch_op.drop_index(batch_op.f('ix_feedback_created_at'))

    op.drop_table('feedback')
    op.drop_table('eval_runs')
    op.drop_table('config_profiles')
    with op.batch_alter_table('click_events', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_click_events_trace_id'))
        batch_op.drop_index(batch_op.f('ix_click_events_created_at'))

    op.drop_table('click_events')
    op.drop_table('chat_sessions')
