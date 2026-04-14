from datetime import datetime
import uuid

from sqlalchemy import JSON, Boolean, DateTime, Float, Integer, String, Text
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    pass


class RunRecord(Base):
    __tablename__ = "runs"

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    source_content: Mapped[str] = mapped_column(Text, nullable=False)
    run_payload: Mapped[dict] = mapped_column(JSON, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow
    )


class VariantEditRecord(Base):
    __tablename__ = "variant_edits"

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    run_id: Mapped[str] = mapped_column(String(36), nullable=False)
    platform: Mapped[str] = mapped_column(String(32), nullable=False)
    variant_id: Mapped[str] = mapped_column(String(36), nullable=False)
    action: Mapped[str] = mapped_column(String(32), nullable=False)
    old_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    new_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow
    )


class WorkflowDefinitionRecord(Base):
    __tablename__ = "workflow_definitions"

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    platforms: Mapped[list[str]] = mapped_column(JSON, nullable=False)
    default_voice_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    default_agent_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    default_audience_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    default_audience_ids: Mapped[list] = mapped_column(JSON, default=list)
    default_rule_set_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    per_platform_config: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow
    )


class WorkflowRunRecord(Base):
    __tablename__ = "workflow_runs"

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    definition_id: Mapped[str] = mapped_column(String(36), nullable=False)
    source_content: Mapped[str] = mapped_column(Text, nullable=False)
    source_images: Mapped[list] = mapped_column(JSON, default=list)
    status: Mapped[str] = mapped_column(String(32), default="active")
    dag_state: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow
    )


class WorkflowNodeStateRecord(Base):
    __tablename__ = "workflow_node_states"

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    workflow_run_id: Mapped[str] = mapped_column(String(36), nullable=False)
    node_type: Mapped[str] = mapped_column(String(32), nullable=False)
    platform: Mapped[str | None] = mapped_column(String(32), nullable=True)
    status: Mapped[str] = mapped_column(String(32), default="pending")
    composition: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    variants: Mapped[list[dict]] = mapped_column(JSON, nullable=False, default=list)
    validation_results: Mapped[list[dict]] = mapped_column(JSON, nullable=False, default=list)
    started_at: Mapped[datetime | None] = mapped_column(
        DateTime, nullable=True, default=None
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow
    )


class AccountRecord(Base):
    __tablename__ = "accounts"

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    platform: Mapped[str] = mapped_column(String(32), nullable=False)
    handle: Mapped[str] = mapped_column(String(255), nullable=False)
    status: Mapped[str] = mapped_column(String(32), default="pending")
    api_token: Mapped[str | None] = mapped_column(Text, nullable=True)
    profile_data: Mapped[dict] = mapped_column(JSON, default=dict)
    imported_posts: Mapped[list] = mapped_column(JSON, default=list)
    inferences: Mapped[dict] = mapped_column(JSON, default=dict)
    post_count: Mapped[int] = mapped_column(Integer, default=0)
    data_health_percent: Mapped[int] = mapped_column(Integer, default=0)
    follower_data: Mapped[dict] = mapped_column(JSON, default=dict)
    last_sync_at: Mapped[datetime | None] = mapped_column(
        DateTime, nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow
    )


class VoiceRecord(Base):
    __tablename__ = "voices"

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    purpose: Mapped[str | None] = mapped_column(Text, nullable=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    attributes: Mapped[dict] = mapped_column(JSON, default=dict)
    avoid_list: Mapped[list] = mapped_column(JSON, default=list)
    overrides: Mapped[dict] = mapped_column(JSON, default=dict)
    source_account_ids: Mapped[list] = mapped_column(JSON, default=list)
    training_period: Mapped[str | None] = mapped_column(String(16), nullable=True)
    consistency_score: Mapped[int] = mapped_column(Integer, default=0)
    posts_trained_on: Mapped[int] = mapped_column(Integer, default=0)
    status: Mapped[str] = mapped_column(String(32), default="generating")
    created_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow
    )


class PersonaRecord(Base):
    __tablename__ = "personas"

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    persona_type: Mapped[str] = mapped_column(String(32), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    writing_approach: Mapped[str | None] = mapped_column(String(64), nullable=True)
    tone: Mapped[dict] = mapped_column(JSON, default=dict)
    structure_preference: Mapped[str | None] = mapped_column(Text, nullable=True)
    platform_behavior: Mapped[dict] = mapped_column(JSON, default=dict)
    tags_positive: Mapped[list] = mapped_column(JSON, default=list)
    tags_negative: Mapped[list] = mapped_column(JSON, default=list)
    enabled_tools: Mapped[list] = mapped_column(JSON, default=list)
    per_platform_config: Mapped[dict] = mapped_column(JSON, default=dict)
    demographics: Mapped[dict] = mapped_column(JSON, default=dict)
    interests: Mapped[list] = mapped_column(JSON, default=list)
    content_preferences: Mapped[dict] = mapped_column(JSON, default=dict)
    goals_and_triggers: Mapped[dict] = mapped_column(JSON, default=dict)
    source_account_ids: Mapped[list] = mapped_column(JSON, default=list)
    status: Mapped[str] = mapped_column(String(32), default="active")
    created_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow
    )


class RecordVersion(Base):
    """Stores snapshots of entities before each edit for version history."""
    __tablename__ = "record_versions"

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    entity_type: Mapped[str] = mapped_column(String(64), nullable=False)
    entity_id: Mapped[str] = mapped_column(String(36), nullable=False)
    version: Mapped[int] = mapped_column(Integer, nullable=False)
    snapshot: Mapped[dict] = mapped_column(JSON, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow
    )


class ConfigRecord(Base):
    """Key-value store for runtime configuration (API keys, OAuth creds)."""
    __tablename__ = "config"

    key: Mapped[str] = mapped_column(String(128), primary_key=True)
    value: Mapped[str] = mapped_column(Text, nullable=False, default="")
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow
    )


class RuleSetRecord(Base):
    __tablename__ = "rule_sets"

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    default_platform: Mapped[str | None] = mapped_column(String(32), nullable=True)
    rules: Mapped[list] = mapped_column(JSON, default=list)
    is_emergency: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow
    )


class DocumentEmbedding(Base):
    __tablename__ = "document_embeddings"

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    entity_type: Mapped[str] = mapped_column(String(64), nullable=False)
    entity_id: Mapped[str] = mapped_column(String(36), nullable=False)
    chunk_text: Mapped[str] = mapped_column(Text, nullable=False)
    chunk_index: Mapped[int] = mapped_column(Integer, default=0)
    metadata_: Mapped[dict] = mapped_column("metadata", JSON, default=dict)
    embedding: Mapped[list | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow
    )


class ContentFeedback(Base):
    __tablename__ = "content_feedback"

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    run_id: Mapped[str] = mapped_column(String(36), nullable=False)
    node_id: Mapped[str] = mapped_column(String(36), nullable=False)
    variant_id: Mapped[str] = mapped_column(String(36), nullable=False)
    platform: Mapped[str] = mapped_column(String(32), nullable=False)
    action: Mapped[str] = mapped_column(String(32), nullable=False)
    original_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    final_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    edit_distance: Mapped[int] = mapped_column(Integer, default=0)
    user_instruction: Mapped[str | None] = mapped_column(Text, nullable=True)
    time_spent_ms: Mapped[int] = mapped_column(Integer, default=0)
    composition_snapshot: Mapped[dict] = mapped_column(JSON, default=dict)
    research_briefs_snapshot: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow
    )


class RunChangeLog(Base):
    """Tracks every user-initiated change to a workflow run for versioning and fine-tuning."""
    __tablename__ = "run_change_logs"

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    run_id: Mapped[str] = mapped_column(String(36), nullable=False)
    node_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    change_type: Mapped[str] = mapped_column(String(64), nullable=False)
    field: Mapped[str] = mapped_column(String(64), nullable=False)
    before_snapshot: Mapped[dict] = mapped_column(JSON, default=dict)
    after_snapshot: Mapped[dict] = mapped_column(JSON, default=dict)
    user_instruction: Mapped[str | None] = mapped_column(Text, nullable=True)
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow
    )


class EditRecord(Base):
    """Granular edit tracking for inline and AI-assisted edits, indexed for RAG retrieval."""
    __tablename__ = "edit_records"

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    run_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    node_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    variant_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    edit_type: Mapped[str] = mapped_column(String(32), nullable=False)
    before_text: Mapped[str] = mapped_column(Text, nullable=False)
    after_text: Mapped[str] = mapped_column(Text, nullable=False)
    diff_ops: Mapped[list[dict]] = mapped_column(JSON, default=list)
    summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    user_instruction: Mapped[str | None] = mapped_column(Text, nullable=True)
    chat_session_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    propagated_from: Mapped[str | None] = mapped_column(String(36), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow
    )


class WorkflowAuditLog(Base):
    __tablename__ = "workflow_audit_logs"

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    run_id: Mapped[str] = mapped_column(String(36), nullable=False)
    node_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    step: Mapped[str] = mapped_column(String(32), nullable=False)
    agent_name: Mapped[str] = mapped_column(String(64), nullable=False)
    platform: Mapped[str | None] = mapped_column(String(32), nullable=True)
    input_summary: Mapped[str] = mapped_column(Text, default="")
    output_summary: Mapped[str] = mapped_column(Text, default="")
    token_usage: Mapped[dict] = mapped_column(JSON, default=dict)
    latency_ms: Mapped[int] = mapped_column(Integer, default=0)
    status: Mapped[str] = mapped_column(String(32), default="success")
    created_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow
    )
