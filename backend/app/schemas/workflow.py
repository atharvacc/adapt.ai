from typing import Literal
from pydantic import BaseModel, Field

from app.schemas.run import Platform, Variant


class WorkflowDefinitionCreateRequest(BaseModel):
    name: str = Field(min_length=3)
    description: str | None = None
    platforms: list[Platform] = Field(
        default_factory=lambda: [
            "linkedin",
            "x",
            "instagram",
            "facebook",
        ]
    )
    default_voice_id: str | None = None
    default_agent_id: str | None = None
    default_audience_id: str | None = None
    default_audience_ids: list[str] = Field(default_factory=list)
    default_rule_set_id: str | None = None
    per_platform_config: dict = Field(default_factory=dict)


class WorkflowDefinitionUpdateRequest(BaseModel):
    name: str | None = None
    description: str | None = None
    platforms: list[Platform] | None = None
    default_voice_id: str | None = None
    default_agent_id: str | None = None
    default_audience_ids: list[str] = Field(default_factory=list)
    default_rule_set_id: str | None = None
    per_platform_config: dict | None = None


class WorkflowDefinitionResponse(BaseModel):
    id: str
    name: str
    description: str | None
    platforms: list[Platform]
    default_voice_id: str | None
    default_agent_id: str | None
    default_audience_id: str | None
    default_audience_ids: list[str] = Field(default_factory=list)
    default_rule_set_id: str | None
    per_platform_config: dict


class WorkflowRunCreateRequest(BaseModel):
    source_content: str = Field(min_length=1)
    source_images: list[str] = Field(default_factory=list)


class ValidationResultResponse(BaseModel):
    variant_label: str | None = None
    rule_name: str
    rule_type: str = "general"
    enforcement: str = "suggested"
    status: str = "pass"
    message: str | None = None


class WorkflowNodeStateResponse(BaseModel):
    id: str
    node_type: Literal["source", "platform", "review", "publish"]
    platform: Platform | None = None
    status: str
    composition: dict
    variants: list[Variant] = Field(default_factory=list)
    validation_results: list[ValidationResultResponse] = Field(
        default_factory=list,
    )
    started_at: str | None = None


class WorkflowRunResponse(BaseModel):
    id: str
    definition_id: str
    source_content: str
    source_images: list[str] = Field(default_factory=list)
    status: str
    dag_state: dict
    created_at: str | None = None
    nodes: list[WorkflowNodeStateResponse]


class AuditLogResponse(BaseModel):
    id: str
    run_id: str
    node_id: str | None = None
    step: str
    agent_name: str
    platform: str | None = None
    input_summary: str
    output_summary: str
    token_usage: dict = Field(default_factory=dict)
    latency_ms: int = 0
    status: str
    created_at: str | None = None


class WorkflowNodeUpdateRequest(BaseModel):
    composition: dict = Field(default_factory=dict)
    context: str | None = None


class VariantFeedbackRequest(BaseModel):
    node_id: str
    variant_id: str
    action: Literal["accept", "edit", "reject", "regenerate"]
    final_text: str | None = None
    user_instruction: str | None = None
    time_spent_ms: int = 0


class EditSuggestRequest(BaseModel):
    node_id: str
    variant_id: str
    selected_text: str
    instruction: str | None = None


class EditSuggestResponse(BaseModel):
    suggestions: list[str]
    rationale: str


class EditChatRequest(BaseModel):
    node_id: str
    variant_id: str
    message: str
    current_text: str


class EditChatResponse(BaseModel):
    reply: str
    suggested_text: str | None = None
    diff_ranges: list[dict] = Field(default_factory=list)


class EditChatSessionRequest(BaseModel):
    node_id: str
    variant_id: str
    message: str
    current_text: str
    session_id: str | None = None
    history: list[dict] = Field(default_factory=list)


class DiffOp(BaseModel):
    op: str  # "equal" | "insert" | "delete"
    lines: list[str]


class EditChatSessionResponse(BaseModel):
    reply: str
    suggested_text: str | None = None
    diff_ops: list[DiffOp] = Field(default_factory=list)
    session_id: str


class SummarizeChangesRequest(BaseModel):
    node_id: str
    variant_id: str


class ChangeItem(BaseModel):
    id: str
    description: str
    category: str
    edit_directive: str = ""
    cross_platform_applicable: bool = True


class SummarizeChangesResponse(BaseModel):
    summary: str
    change_items: list[ChangeItem] = Field(default_factory=list)


class PropagateChangesRequest(BaseModel):
    node_id: str
    source_variant_id: str
    target_variant_ids: list[str] = Field(default_factory=list)
    target_node_ids: list[str] = Field(default_factory=list)
    change_item_ids: list[str] = Field(default_factory=list)
    edit_directives: list[str] = Field(default_factory=list)
    mode: str = "variants"


class PropagateChangesResponse(BaseModel):
    propagated_count: int
    updated_variants: list[dict] = Field(default_factory=list)
    updated_nodes: list[dict] = Field(default_factory=list)


class EditRecordResponse(BaseModel):
    id: str
    run_id: str
    node_id: str
    variant_id: str
    edit_type: str
    before_text: str
    after_text: str
    diff_ops: list[DiffOp] = Field(default_factory=list)
    summary: str | None = None
    user_instruction: str | None = None
    chat_session_id: str | None = None
    propagated_from: str | None = None
    created_at: str | None = None


class UpdateSourceRequest(BaseModel):
    source_content: str = Field(min_length=1)
    source_images: list[str] = Field(default_factory=list)
    reason: str | None = None


class RunChangeLogResponse(BaseModel):
    id: str
    run_id: str
    node_id: str | None = None
    change_type: str
    field: str
    before_snapshot: dict
    after_snapshot: dict
    user_instruction: str | None = None
    version: int
    created_at: str | None = None
