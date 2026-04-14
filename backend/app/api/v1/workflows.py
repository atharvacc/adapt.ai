import logging
import uuid
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

log = logging.getLogger(__name__)

from app.db.models import (
    ContentFeedback,
    EditRecord,
    PersonaRecord,
    RunChangeLog,
    VoiceRecord,
    WorkflowAuditLog,
    WorkflowDefinitionRecord,
    WorkflowNodeStateRecord,
    WorkflowRunRecord,
)
from app.db.session import SessionLocal, get_db
from app.schemas.workflow import (
    AuditLogResponse,
    EditChatRequest,
    EditChatResponse,
    EditChatSessionRequest,
    EditChatSessionResponse,
    EditRecordResponse,
    EditSuggestRequest,
    EditSuggestResponse,
    PropagateChangesRequest,
    PropagateChangesResponse,
    RunChangeLogResponse,
    SummarizeChangesRequest,
    SummarizeChangesResponse,
    UpdateSourceRequest,
    VariantFeedbackRequest,
    WorkflowDefinitionCreateRequest,
    WorkflowDefinitionResponse,
    WorkflowDefinitionUpdateRequest,
    WorkflowNodeStateResponse,
    WorkflowRunCreateRequest,
    WorkflowRunResponse,
    WorkflowNodeUpdateRequest,
)
router = APIRouter(prefix="/v1/workflows", tags=["workflows"])


_VALID_PLATFORMS = {"linkedin", "x", "instagram", "tiktok"}


def _def_response(row: WorkflowDefinitionRecord) -> WorkflowDefinitionResponse:
    return WorkflowDefinitionResponse(
        id=row.id,
        name=row.name,
        description=row.description,
        platforms=[p for p in row.platforms if p in _VALID_PLATFORMS],
        default_voice_id=row.default_voice_id,
        default_agent_id=row.default_agent_id,
        default_audience_id=row.default_audience_id,
        default_audience_ids=getattr(row, "default_audience_ids", None) or [],
        default_rule_set_id=getattr(row, "default_rule_set_id", None),
        per_platform_config=row.per_platform_config,
    )


@router.get("", response_model=list[WorkflowDefinitionResponse])
def list_workflows(
    db: Session = Depends(get_db),
) -> list[WorkflowDefinitionResponse]:
    rows = db.execute(select(WorkflowDefinitionRecord)).scalars().all()
    return [_def_response(r) for r in rows]


@router.get("/{workflow_id}", response_model=WorkflowDefinitionResponse)
def get_workflow(
    workflow_id: str, db: Session = Depends(get_db)
) -> WorkflowDefinitionResponse:
    row = db.get(WorkflowDefinitionRecord, workflow_id)
    if not row:
        raise HTTPException(status_code=404, detail="Workflow not found")
    return _def_response(row)


@router.post("", response_model=WorkflowDefinitionResponse)
def create_workflow(
    payload: WorkflowDefinitionCreateRequest,
    db: Session = Depends(get_db),
) -> WorkflowDefinitionResponse:
    workflow = WorkflowDefinitionRecord(
        id=str(uuid.uuid4()),
        name=payload.name,
        description=payload.description,
        platforms=payload.platforms,
        default_voice_id=payload.default_voice_id,
        default_agent_id=payload.default_agent_id,
        default_audience_id=payload.default_audience_id,
        default_audience_ids=payload.default_audience_ids,
        default_rule_set_id=payload.default_rule_set_id,
        per_platform_config=payload.per_platform_config,
    )
    db.add(workflow)
    db.commit()
    return _def_response(workflow)


@router.put("/{workflow_id}", response_model=WorkflowDefinitionResponse)
def update_workflow(
    workflow_id: str,
    payload: WorkflowDefinitionUpdateRequest,
    db: Session = Depends(get_db),
) -> WorkflowDefinitionResponse:
    row = db.get(WorkflowDefinitionRecord, workflow_id)
    if not row:
        raise HTTPException(status_code=404, detail="Workflow not found")
    if payload.name is not None:
        row.name = payload.name
    if payload.description is not None:
        row.description = payload.description
    if payload.default_voice_id is not None:
        row.default_voice_id = payload.default_voice_id
    if payload.default_agent_id is not None:
        row.default_agent_id = payload.default_agent_id
    if payload.default_audience_ids is not None:
        row.default_audience_ids = payload.default_audience_ids
    if payload.default_rule_set_id is not None:
        row.default_rule_set_id = payload.default_rule_set_id
    if payload.per_platform_config is not None:
        row.per_platform_config = payload.per_platform_config
    db.commit()

    _propagate_defaults_to_nodes(db, row)

    return _def_response(row)


@router.delete("/{workflow_id}")
def delete_workflow(workflow_id: str, db: Session = Depends(get_db)) -> dict:
    runs = db.execute(
        select(WorkflowRunRecord).where(WorkflowRunRecord.definition_id == workflow_id)
    ).scalars().all()
    for run in runs:
        nodes = db.execute(
            select(WorkflowNodeStateRecord).where(WorkflowNodeStateRecord.workflow_run_id == run.id)
        ).scalars().all()
        for node in nodes:
            db.delete(node)
        db.delete(run)
    definition = db.get(WorkflowDefinitionRecord, workflow_id)
    if definition:
        db.delete(definition)
    db.commit()
    return {"deleted": workflow_id}


# ─── Defaults propagation ────────────────────────────────────────────────────

def _propagate_defaults_to_nodes(
    db: Session,
    definition: WorkflowDefinitionRecord,
) -> None:
    """Push definition defaults (+ per-platform overrides) into
    platform nodes not yet user-configured."""
    audience_ids = (
        getattr(definition, "default_audience_ids", None) or []
    )
    if not audience_ids and definition.default_audience_id:
        audience_ids = [definition.default_audience_id]
    rule_set_id = getattr(definition, "default_rule_set_id", None)
    ppc = definition.per_platform_config or {}

    runs = db.execute(
        select(WorkflowRunRecord).where(
            WorkflowRunRecord.definition_id == definition.id
        )
    ).scalars().all()

    changed = False
    for run in runs:
        nodes = db.execute(
            select(WorkflowNodeStateRecord).where(
                WorkflowNodeStateRecord.workflow_run_id == run.id,
                WorkflowNodeStateRecord.node_type == "platform",
            )
        ).scalars().all()
        for node in nodes:
            comp = dict(node.composition or {})
            if comp.get("user_configured"):
                continue
            override = ppc.get(node.platform, {}) or {}
            comp["voice_id"] = (
                override.get("voice_id")
                or definition.default_voice_id
            )
            comp["agent_id"] = (
                override.get("agent_id")
                or definition.default_agent_id
            )
            comp["audience_ids"] = (
                override.get("audience_ids") or audience_ids
            )
            comp["rule_set_id"] = (
                override.get("rule_set_id") or rule_set_id
            )
            custom_acts = override.get("research_activities")
            if isinstance(custom_acts, list) and custom_acts:
                comp["research_activities"] = custom_acts
            elif "research_activities" in comp:
                del comp["research_activities"]
            node.composition = comp
            changed = True
    if changed:
        db.commit()


# ─── Change Logging ──────────────────────────────────────────────────────────

def _log_change(
    db: Session,
    run_id: str,
    change_type: str,
    field: str,
    before: dict,
    after: dict,
    node_id: str | None = None,
    instruction: str | None = None,
) -> RunChangeLog:
    """Record a versioned change to a run for audit trail + future fine-tuning."""
    latest = db.execute(
        select(RunChangeLog)
        .where(RunChangeLog.run_id == run_id)
        .order_by(RunChangeLog.version.desc())
        .limit(1)
    ).scalar_one_or_none()
    next_version = (latest.version + 1) if latest else 1

    entry = RunChangeLog(
        run_id=run_id,
        node_id=node_id,
        change_type=change_type,
        field=field,
        before_snapshot=before,
        after_snapshot=after,
        user_instruction=instruction,
        version=next_version,
    )
    db.add(entry)
    return entry


# ─── Pipeline Thread ─────────────────────────────────────────────────────────

def _run_pipeline_thread(
    run_id: str,
    node_id: str,
    platform: str,
    source_content: str,
    source_images: list[str],
    voice_id: str | None,
    agent_id: str | None,
    audience_ids: list[str],
    rule_set_id: str | None,
    per_platform_config: dict,
) -> None:
    """Load full profiles from DB and execute the LangGraph pipeline."""
    from app.services.workflow_engine import run_platform_pipeline

    from app.db.models import (
        PersonaRecord, RuleSetRecord, VoiceRecord,
    )

    db = SessionLocal()
    try:
        node_row = db.get(WorkflowNodeStateRecord, node_id)
        node_comp = (node_row.composition or {}) if node_row else {}
        custom_activities = node_comp.get("research_activities")

        voice_profile: dict = {}
        persona_profile: dict = {}
        audience_profiles: list[dict] = []
        rule_set: dict = {}

        if voice_id:
            voice = db.get(VoiceRecord, voice_id)
            if voice:
                voice_profile = {
                    "name": voice.name,
                    "purpose": voice.purpose,
                    "description": voice.description,
                    "attributes": voice.attributes,
                    "avoid_list": voice.avoid_list,
                    "overrides": voice.overrides,
                }

        if agent_id:
            persona = db.get(PersonaRecord, agent_id)
            if persona:
                tools = persona.enabled_tools
                if isinstance(custom_activities, list) and custom_activities:
                    tools = custom_activities
                persona_profile = {
                    "name": persona.name,
                    "description": persona.description,
                    "writing_approach": persona.writing_approach,
                    "tone": persona.tone,
                    "enabled_tools": tools,
                    "per_platform_config": persona.per_platform_config,
                    "structure_preference": persona.structure_preference,
                }
        elif isinstance(custom_activities, list) and custom_activities:
            persona_profile = {"enabled_tools": custom_activities}

        for aid in audience_ids:
            if not aid:
                continue
            audience = db.get(PersonaRecord, aid)
            if audience:
                audience_profiles.append({
                    "name": audience.name,
                    "description": audience.description,
                    "demographics": audience.demographics,
                    "interests": audience.interests,
                    "content_preferences": audience.content_preferences,
                    "goals_and_triggers": audience.goals_and_triggers,
                })

        if rule_set_id:
            rs = db.get(RuleSetRecord, rule_set_id)
            if rs:
                rule_set = {"name": rs.name, "rules": rs.rules}
        else:
            platform_rules = per_platform_config.get(platform, {})
            if isinstance(platform_rules, dict):
                rule_set = platform_rules

        preference_summary = _build_preference_summary(db, platform)
    finally:
        db.close()

    run_platform_pipeline(
        run_id=run_id, node_id=node_id, platform=platform,
        source_content=source_content, source_images=source_images,
        voice_profile=voice_profile, persona_profile=persona_profile,
        audience_profiles=audience_profiles, rule_set=rule_set,
        preference_summary=preference_summary,
    )


def _build_preference_summary(db: Session, platform: str) -> str:
    """Build a summary of past user feedback for cross-session learning."""
    try:
        rows = db.execute(
            select(ContentFeedback)
            .where(ContentFeedback.platform == platform)
            .order_by(ContentFeedback.created_at.desc())
            .limit(20)
        ).scalars().all()
        if not rows:
            return ""
        lines = []
        for r in rows:
            if r.action == "edit" and r.original_text and r.final_text:
                lines.append(f"- User edited variant: changed from '{r.original_text[:80]}...' to '{r.final_text[:80]}...'")
                if r.user_instruction:
                    lines.append(f"  Instruction: {r.user_instruction}")
            elif r.action == "accept":
                lines.append(f"- User accepted variant (hook: {r.composition_snapshot.get('hook_type', 'unknown')})")
            elif r.action == "reject":
                lines.append("- User rejected variant")
        return "\n".join(lines[:15])
    except Exception:
        log.warning("Failed to build preference summary, skipping")
        return ""


# ─── Run creation ────────────────────────────────────────────────────────────

@router.post("/{workflow_id}/runs", response_model=WorkflowRunResponse)
def create_workflow_run(
    workflow_id: str,
    payload: WorkflowRunCreateRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
) -> WorkflowRunResponse:
    definition = db.get(WorkflowDefinitionRecord, workflow_id)
    if not definition:
        raise HTTPException(status_code=404, detail="Workflow not found")

    run_id = str(uuid.uuid4())
    run = WorkflowRunRecord(
        id=run_id, definition_id=workflow_id,
        source_content=payload.source_content,
        source_images=payload.source_images,
        status="running", dag_state={"phase": "generating"},
    )
    db.add(run)

    source_node = WorkflowNodeStateRecord(
        workflow_run_id=run_id, node_type="source", status="done",
        composition={}, variants=[],
    )
    db.add(source_node)

    platforms = [p for p in definition.platforms if p in _VALID_PLATFORMS]
    node_ids: list[tuple[str, str]] = []

    def_audience_ids = (
        getattr(definition, "default_audience_ids", None) or []
    )
    if not def_audience_ids and definition.default_audience_id:
        def_audience_ids = [definition.default_audience_id]
    def_rule_set_id = getattr(definition, "default_rule_set_id", None)

    ppc = definition.per_platform_config or {}

    for platform in platforms:
        node_id = str(uuid.uuid4())
        override = ppc.get(platform, {}) or {}
        comp: dict = {
            "voice_id": override.get("voice_id") or definition.default_voice_id,
            "agent_id": override.get("agent_id") or definition.default_agent_id,
            "audience_ids": override.get("audience_ids") or def_audience_ids,
            "rule_set_id": override.get("rule_set_id") or def_rule_set_id,
        }
        custom_acts = override.get("research_activities")
        if isinstance(custom_acts, list) and custom_acts:
            comp["research_activities"] = custom_acts
        platform_node = WorkflowNodeStateRecord(
            id=node_id, workflow_run_id=run_id,
            node_type="platform",
            platform=platform, status="pending",
            composition=comp,
            variants=[],
        )
        db.add(platform_node)
        node_ids.append((node_id, platform))

    review_node = WorkflowNodeStateRecord(
        workflow_run_id=run_id, node_type="review", status="pending",
        composition={}, variants=[],
    )
    db.add(review_node)
    db.commit()

    node_comps: dict[str, dict] = {}
    for nid, plat in node_ids:
        override = ppc.get(plat, {}) or {}
        node_comps[nid] = {
            "voice_id": override.get("voice_id") or definition.default_voice_id,
            "agent_id": override.get("agent_id") or definition.default_agent_id,
            "audience_ids": override.get("audience_ids") or def_audience_ids,
            "rule_set_id": override.get("rule_set_id") or def_rule_set_id,
        }

    for node_id, platform in node_ids:
        nc = node_comps[node_id]
        background_tasks.add_task(
            _run_pipeline_thread,
            run_id, node_id, platform,
            payload.source_content, payload.source_images,
            nc["voice_id"], nc["agent_id"],
            nc["audience_ids"], nc["rule_set_id"],
            ppc,
        )
        log.info("Launched pipeline for %s [run=%s, node=%s]", platform, run_id, node_id)

    return _build_run_response(db, run_id)


# ─── Runs CRUD ───────────────────────────────────────────────────────────────

@router.get("/{workflow_id}/runs", response_model=list[WorkflowRunResponse])
def list_workflow_runs(workflow_id: str, db: Session = Depends(get_db)) -> list[WorkflowRunResponse]:
    definition = db.get(WorkflowDefinitionRecord, workflow_id)
    if not definition:
        raise HTTPException(status_code=404, detail="Workflow not found")
    runs = db.execute(
        select(WorkflowRunRecord).where(WorkflowRunRecord.definition_id == workflow_id)
    ).scalars().all()
    return [_build_run_response(db, run.id) for run in runs]


@router.get("/runs/{run_id}", response_model=WorkflowRunResponse)
def get_workflow_run(run_id: str, db: Session = Depends(get_db)) -> WorkflowRunResponse:
    return _build_run_response(db, run_id)


@router.put("/runs/{run_id}/source", response_model=WorkflowRunResponse)
def update_run_source(
    run_id: str,
    payload: UpdateSourceRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
) -> WorkflowRunResponse:
    """Update source content for a run and re-trigger all platform pipelines."""
    run = db.get(WorkflowRunRecord, run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")

    old_content = run.source_content
    old_images = getattr(run, "source_images", None) or []

    _log_change(
        db, run_id, "source_edit", "source_content",
        {"source_content": old_content, "source_images": old_images},
        {"source_content": payload.source_content,
         "source_images": payload.source_images},
        instruction=payload.reason,
    )

    run.source_content = payload.source_content
    run.source_images = payload.source_images
    run.status = "running"
    run.dag_state = {"phase": "regenerating"}

    platform_nodes = db.execute(
        select(WorkflowNodeStateRecord).where(
            WorkflowNodeStateRecord.workflow_run_id == run_id,
            WorkflowNodeStateRecord.node_type == "platform",
        )
    ).scalars().all()

    for node in platform_nodes:
        node.status = "pending"
        node.variants = []
        node.validation_results = []
        if hasattr(node, "started_at"):
            node.started_at = None

    db.commit()

    definition = db.get(WorkflowDefinitionRecord, run.definition_id)

    for node in platform_nodes:
        comp = node.composition or {}
        audience_ids = comp.get("audience_ids", [])
        if not audience_ids and comp.get("audience_id"):
            audience_ids = [comp["audience_id"]]

        background_tasks.add_task(
            _run_pipeline_thread,
            run_id, node.id, node.platform,
            payload.source_content, payload.source_images,
            comp.get("voice_id") or (
                definition.default_voice_id if definition else None
            ),
            comp.get("agent_id") or (
                definition.default_agent_id if definition else None
            ),
            audience_ids, comp.get("rule_set_id"),
            (definition.per_platform_config or {}) if definition else {},
        )

    return _build_run_response(db, run_id)


@router.get(
    "/runs/{run_id}/changelog",
    response_model=list[RunChangeLogResponse],
)
def get_run_changelog(
    run_id: str, db: Session = Depends(get_db)
) -> list[RunChangeLogResponse]:
    rows = db.execute(
        select(RunChangeLog)
        .where(RunChangeLog.run_id == run_id)
        .order_by(RunChangeLog.version.desc())
    ).scalars().all()
    return [
        RunChangeLogResponse(
            id=r.id, run_id=r.run_id, node_id=r.node_id,
            change_type=r.change_type, field=r.field,
            before_snapshot=r.before_snapshot,
            after_snapshot=r.after_snapshot,
            user_instruction=r.user_instruction,
            version=r.version,
            created_at=(
                r.created_at.isoformat() if r.created_at else None
            ),
        )
        for r in rows
    ]


@router.put("/runs/{run_id}/nodes/{node_id}", response_model=WorkflowRunResponse)
def update_workflow_node(
    run_id: str,
    node_id: str,
    payload: WorkflowNodeUpdateRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
) -> WorkflowRunResponse:
    run = db.get(WorkflowRunRecord, run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Workflow run not found")

    node = db.get(WorkflowNodeStateRecord, node_id)
    if not node or node.workflow_run_id != run_id:
        raise HTTPException(status_code=404, detail="Workflow node not found")
    if node.node_type != "platform" or not node.platform:
        raise HTTPException(status_code=400, detail="Only platform nodes are editable")

    _log_change(
        db, run_id, "composition_change", "composition",
        {"composition": node.composition},
        {"composition": payload.composition},
        node_id=node_id,
        instruction=payload.context,
    )

    updated_comp = {**payload.composition, "user_configured": True}
    node.composition = updated_comp
    node.status = "pending"
    node.variants = []
    db.commit()

    comp = payload.composition
    audience_ids = comp.get("audience_ids", [])
    if not audience_ids and comp.get("audience_id"):
        audience_ids = [comp["audience_id"]]

    background_tasks.add_task(
        _run_pipeline_thread,
        run_id, node_id, node.platform,
        run.source_content, getattr(run, "source_images", None) or [],
        comp.get("voice_id"), comp.get("agent_id"),
        audience_ids, comp.get("rule_set_id"),
        {},
    )

    return _build_run_response(db, run_id)


# ─── Feedback ────────────────────────────────────────────────────────────────

@router.post("/runs/{run_id}/feedback")
def submit_feedback(
    run_id: str,
    payload: VariantFeedbackRequest,
    db: Session = Depends(get_db),
) -> dict:
    run = db.get(WorkflowRunRecord, run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")

    node = db.get(WorkflowNodeStateRecord, payload.node_id)
    if not node or node.workflow_run_id != run_id:
        raise HTTPException(status_code=404, detail="Node not found")

    variant = next(
        (v for v in node.variants if v.get("id") == payload.variant_id),
        None,
    )
    original_text = variant.get("text", "") if variant else ""

    _log_change(
        db, run_id, f"variant_{payload.action}", "variant",
        {"variant_id": payload.variant_id, "text": original_text,
         "status": variant.get("status") if variant else None},
        {"variant_id": payload.variant_id,
         "text": payload.final_text or original_text,
         "status": payload.action},
        node_id=payload.node_id,
        instruction=payload.user_instruction,
    )

    edit_distance = 0
    if payload.action == "edit" and payload.final_text:
        edit_distance = _levenshtein_distance(original_text, payload.final_text)
        if variant:
            updated_variants = list(node.variants)
            for v in updated_variants:
                if v.get("id") == payload.variant_id:
                    v["text"] = payload.final_text
                    v["status"] = "edited"
            node.variants = updated_variants

        if original_text != (payload.final_text or ""):
            _create_edit_record(
                db, run_id, payload.node_id, payload.variant_id,
                "inline", original_text, payload.final_text or "",
                user_instruction=payload.user_instruction,
            )
    elif payload.action == "accept" and variant:
        updated_variants = list(node.variants)
        for v in updated_variants:
            if v.get("id") == payload.variant_id:
                v["status"] = "accepted"
                final_text = payload.final_text or v.get("text", "")
                if final_text and node.platform:
                    try:
                        from app.services.image_gen import (
                            generate_image,
                            build_image_prompt_via_llm,
                        )
                        comp = node.composition or {}
                        run_meta = {
                            "run_id": run_id,
                            "node_id": node.id,
                            "platform": node.platform,
                            "step": "finalize_media",
                            "agent": "FinalImageGenerator",
                        }
                        final_prompt = build_image_prompt_via_llm(
                            variant_text=final_text,
                            platform=node.platform,
                            voice_profile=_load_voice_for_accept(
                                db, comp.get("voice_id"),
                            ),
                            persona_profile=_load_persona_for_accept(
                                db, comp.get("agent_id"),
                            ),
                            audience_profiles=_load_audiences_for_accept(
                                db, comp.get("audience_ids", []),
                            ),
                            rule_set=_load_ruleset_for_accept(
                                db, comp.get("rule_set_id"),
                            ),
                            run_meta=run_meta,
                        )
                        source_imgs = (
                            getattr(run, "source_images", None)
                            or []
                        )
                        img = generate_image(
                            final_prompt,
                            node.platform,
                            reference_images=source_imgs,
                            run_meta=run_meta,
                        )
                        if img:
                            v["image_prompt"] = final_prompt
                            v["image_url"] = img
                    except Exception:
                        log.exception(
                            "Final image gen failed run=%s node=%s",
                            run_id, node.id,
                        )
        node.variants = updated_variants
    elif payload.action == "reject" and variant:
        updated_variants = list(node.variants)
        for v in updated_variants:
            if v.get("id") == payload.variant_id:
                v["status"] = "rejected"
        node.variants = updated_variants

    fb = ContentFeedback(
        run_id=run_id,
        node_id=payload.node_id,
        variant_id=payload.variant_id,
        platform=node.platform or "unknown",
        action=payload.action,
        original_text=original_text,
        final_text=payload.final_text or original_text,
        edit_distance=edit_distance,
        user_instruction=payload.user_instruction,
        time_spent_ms=payload.time_spent_ms,
        composition_snapshot=node.composition,
        research_briefs_snapshot={"activities": node.composition.get("research_activities", [])},
    )
    db.add(fb)
    db.commit()

    return {"status": "ok", "feedback_id": fb.id}


# ─── Re-validate ────────────────────────────────────────────────────────────

class RevalidateRequest(BaseModel):
    node_id: str


@router.post("/runs/{run_id}/revalidate")
def revalidate_node(
    run_id: str,
    payload: RevalidateRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
) -> dict:
    """Re-run validation on a node's current variants."""
    run = db.get(WorkflowRunRecord, run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")
    node = db.get(WorkflowNodeStateRecord, payload.node_id)
    if not node or node.workflow_run_id != run_id:
        raise HTTPException(
            status_code=404, detail="Node not found",
        )
    if not node.variants:
        raise HTTPException(
            status_code=400,
            detail="No variants to validate",
        )
    background_tasks.add_task(
        _run_revalidation, run_id, node.id,
    )
    return {"status": "revalidating"}


def _run_revalidation(run_id: str, node_id: str) -> None:
    from app.services.workflow_engine import (
        validator_agent,
    )
    db = SessionLocal()
    try:
        node = db.get(WorkflowNodeStateRecord, node_id)
        if not node:
            return
        comp = node.composition or {}
        state = {
            "platform": node.platform or "linkedin",
            "variants": node.variants,
            "voice_profile": comp.get("voice_profile") or {},
            "persona_profile": comp.get("persona_profile") or {},
            "rule_set": comp.get("rule_set") or {},
            "run_id": run_id,
            "node_id": node_id,
        }
        result = validator_agent(state)
        node.validation_results = result.get(
            "validation_results", [],
        )
        db.commit()
    except Exception:
        log.exception(
            "Revalidation failed run=%s node=%s",
            run_id, node_id,
        )
    finally:
        db.close()


# ─── Inline Edit Suggest ────────────────────────────────────────────────────

@router.post("/runs/{run_id}/edit-suggest", response_model=EditSuggestResponse)
def edit_suggest(
    run_id: str,
    payload: EditSuggestRequest,
    db: Session = Depends(get_db),
) -> EditSuggestResponse:
    run = db.get(WorkflowRunRecord, run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")

    node = db.get(WorkflowNodeStateRecord, payload.node_id)
    if not node:
        raise HTTPException(status_code=404, detail="Node not found")

    variant = next((v for v in node.variants if v.get("id") == payload.variant_id), None)
    full_text = variant.get("text", "") if variant else ""

    instruction_block = ""
    if payload.instruction:
        instruction_block = f"\nUser instruction: {payload.instruction}"

    try:
        import json
        import re
        from app.services.llm import _get_client, _with_retries
        client = _get_client()
        platform_name = node.platform or 'general'
        system_msg = (
            f"Rewrite the selected text in 3 different ways, "
            f"maintaining the surrounding context. "
            f"Platform: {platform_name}.{instruction_block}\n"
            'Output JSON: {"suggestions": ["..."], "rationale": "..."}'
        )
        resp = _with_retries(lambda: client.messages.create(
            model="claude-sonnet-4-20250514",
            max_tokens=1024,
            system=system_msg,
            messages=[{
                "role": "user",
                "content": (
                    f"Full post:\n{full_text}\n\n"
                    f"Selected text to rewrite:\n{payload.selected_text}"
                ),
            }],
        ))
        raw = resp.content[0].text
        match = re.search(r'\{.*\}', raw, re.DOTALL)
        if match:
            data = json.loads(match.group())
            return EditSuggestResponse(
                suggestions=data.get("suggestions", [raw]),
                rationale=data.get("rationale", "AI-generated alternatives"),
            )
    except Exception:
        log.exception("Edit suggest failed")

    return EditSuggestResponse(
        suggestions=[payload.selected_text],
        rationale="Suggestion generation failed, returning original text.",
    )


# ─── Chat With Draft ────────────────────────────────────────────────────────

@router.post("/runs/{run_id}/edit-chat", response_model=EditChatResponse)
def edit_chat(
    run_id: str,
    payload: EditChatRequest,
    db: Session = Depends(get_db),
) -> EditChatResponse:
    run = db.get(WorkflowRunRecord, run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")

    node = db.get(WorkflowNodeStateRecord, payload.node_id)
    if not node:
        raise HTTPException(status_code=404, detail="Node not found")

    try:
        import json
        import re
        from app.services.llm import _get_client, _with_retries
        client = _get_client()
        resp = _with_retries(lambda: client.messages.create(
            model="claude-sonnet-4-20250514",
            max_tokens=2048,
            system=f"""You are an AI content editor for {node.platform or 'social media'}.
The user is editing a draft and chatting with you to improve it.
When suggesting changes, output JSON:
{{"reply": "your conversational response", "suggested_text": "full revised text or null", "diff_ranges": [{{"start": 0, "end": 10, "replacement": "..."}}]}}
If no text change needed, set suggested_text to null.""",
            messages=[{"role": "user", "content": f"Current draft:\n{payload.current_text}\n\nUser message: {payload.message}"}],
        ))
        raw = resp.content[0].text
        match = re.search(r'\{.*\}', raw, re.DOTALL)
        if match:
            data = json.loads(match.group())
            return EditChatResponse(
                reply=data.get("reply", raw),
                suggested_text=data.get("suggested_text"),
                diff_ranges=data.get("diff_ranges", []),
            )
        return EditChatResponse(reply=raw, suggested_text=None)
    except Exception:
        log.exception("Edit chat failed")
        return EditChatResponse(reply="Sorry, I couldn't process that. Please try again.", suggested_text=None)


# ─── Edit Helpers ────────────────────────────────────────────────────────────

def _compute_diff_ops(before: str, after: str) -> list[dict]:
    """Compute line-level diff operations between two texts."""
    import difflib
    before_lines = before.splitlines(keepends=True)
    after_lines = after.splitlines(keepends=True)
    matcher = difflib.SequenceMatcher(None, before_lines, after_lines)
    ops: list[dict] = []
    for tag, i1, i2, j1, j2 in matcher.get_opcodes():
        if tag == "equal":
            ops.append({"op": "equal", "lines": [l.rstrip("\n") for l in before_lines[i1:i2]]})
        elif tag == "delete":
            ops.append({"op": "delete", "lines": [l.rstrip("\n") for l in before_lines[i1:i2]]})
        elif tag == "insert":
            ops.append({"op": "insert", "lines": [l.rstrip("\n") for l in after_lines[j1:j2]]})
        elif tag == "replace":
            ops.append({"op": "delete", "lines": [l.rstrip("\n") for l in before_lines[i1:i2]]})
            ops.append({"op": "insert", "lines": [l.rstrip("\n") for l in after_lines[j1:j2]]})
    return ops


def _index_edit(db: Session, edit: EditRecord) -> None:
    """Embed an edit record into the RAG store for future context retrieval."""
    try:
        from app.services.embeddings import embed_and_store
        chunk = (
            f"Edit ({edit.edit_type}): {edit.summary or 'No summary'}\n"
            f"Before: {edit.before_text[:500]}\n"
            f"After: {edit.after_text[:500]}"
        )
        embed_and_store(db, "edit", edit.id, [chunk], metadata={
            "run_id": edit.run_id,
            "node_id": edit.node_id,
            "variant_id": edit.variant_id,
            "edit_type": edit.edit_type,
        })
    except Exception:
        log.exception("Failed to index edit %s", edit.id)


def _get_edit_context(db: Session, variant_id: str, run_id: str) -> str:
    """Retrieve past edit history for a variant via RAG for AI context injection."""
    edits = db.execute(
        select(EditRecord)
        .where(EditRecord.run_id == run_id, EditRecord.variant_id == variant_id)
        .order_by(EditRecord.created_at)
    ).scalars().all()
    if not edits:
        return ""
    parts = []
    for e in edits[-10:]:
        parts.append(
            f"- [{e.edit_type}] {e.summary or 'edit'}: "
            f"changed from '{e.before_text[:100]}...' to '{e.after_text[:100]}...'"
        )
    return "Previous edits on this variant:\n" + "\n".join(parts)


def _create_edit_record(
    db: Session,
    run_id: str,
    node_id: str,
    variant_id: str,
    edit_type: str,
    before_text: str,
    after_text: str,
    user_instruction: str | None = None,
    chat_session_id: str | None = None,
    propagated_from: str | None = None,
) -> EditRecord:
    """Create an EditRecord with diff ops and index it for RAG."""
    diff_ops = _compute_diff_ops(before_text, after_text)
    edit = EditRecord(
        run_id=run_id,
        node_id=node_id,
        variant_id=variant_id,
        edit_type=edit_type,
        before_text=before_text,
        after_text=after_text,
        diff_ops=diff_ops,
        user_instruction=user_instruction,
        chat_session_id=chat_session_id,
        propagated_from=propagated_from,
    )
    db.add(edit)
    db.flush()
    _index_edit(db, edit)
    return edit


# ─── Edit Chat Session (with history + RAG context) ─────────────────────────

@router.post("/runs/{run_id}/edit-chat-session", response_model=EditChatSessionResponse)
def edit_chat_session(
    run_id: str,
    payload: EditChatSessionRequest,
    db: Session = Depends(get_db),
) -> EditChatSessionResponse:
    run = db.get(WorkflowRunRecord, run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")

    node = db.get(WorkflowNodeStateRecord, payload.node_id)
    if not node:
        raise HTTPException(status_code=404, detail="Node not found")

    session_id = payload.session_id or str(uuid.uuid4())
    edit_context = _get_edit_context(db, payload.variant_id, run_id)

    try:
        import json
        import re
        from app.services.llm import _get_client, _with_retries
        client = _get_client()

        context_block = ""
        if edit_context:
            context_block = f"\n\n{edit_context}"

        system_msg = (
            f"You are an AI content editor for {node.platform or 'social media'}. "
            f"The user is editing a draft and chatting with you to improve it. "
            f"You have web search available if the user needs factual information."
            f"{context_block}\n\n"
            f"When suggesting changes, output JSON:\n"
            f'{{"reply": "your conversational response", '
            f'"suggested_text": "full revised text or null"}}\n'
            f"If no text change is needed, set suggested_text to null."
        )

        messages = []
        for msg in payload.history:
            role = msg.get("role", "user")
            text = msg.get("text", "")
            if role == "user":
                messages.append({"role": "user", "content": text})
            else:
                messages.append({"role": "assistant", "content": text})

        messages.append({
            "role": "user",
            "content": f"Current draft:\n{payload.current_text}\n\nUser message: {payload.message}",
        })

        resp = _with_retries(lambda: client.messages.create(
            model="claude-sonnet-4-20250514",
            max_tokens=2048,
            system=system_msg,
            messages=messages,
            tools=[{"type": "web_search_20250305", "name": "web_search", "max_uses": 3}],
        ))

        raw = ""
        for block in resp.content:
            if hasattr(block, "text"):
                raw += block.text

        match = re.search(r'\{.*\}', raw, re.DOTALL)
        reply_text = raw
        suggested_text = None
        if match:
            try:
                data = json.loads(match.group())
                reply_text = data.get("reply", raw)
                suggested_text = data.get("suggested_text")
            except json.JSONDecodeError:
                pass

        diff_ops: list[dict] = []
        if suggested_text:
            diff_ops = _compute_diff_ops(payload.current_text, suggested_text)

        return EditChatSessionResponse(
            reply=reply_text,
            suggested_text=suggested_text,
            diff_ops=[{"op": d["op"], "lines": d["lines"]} for d in diff_ops],
            session_id=session_id,
        )
    except Exception:
        log.exception("Edit chat session failed")
        return EditChatSessionResponse(
            reply="Sorry, I couldn't process that. Please try again.",
            suggested_text=None,
            session_id=session_id,
        )


# ─── Summarize Changes ──────────────────────────────────────────────────────

@router.post("/runs/{run_id}/summarize-changes", response_model=SummarizeChangesResponse)
def summarize_changes(
    run_id: str,
    payload: SummarizeChangesRequest,
    db: Session = Depends(get_db),
) -> SummarizeChangesResponse:
    run = db.get(WorkflowRunRecord, run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")

    node = db.get(WorkflowNodeStateRecord, payload.node_id)
    if not node or node.workflow_run_id != run_id:
        raise HTTPException(status_code=404, detail="Node not found")

    edits = db.execute(
        select(EditRecord)
        .where(
            EditRecord.run_id == run_id,
            EditRecord.node_id == payload.node_id,
            EditRecord.variant_id == payload.variant_id,
        )
        .order_by(EditRecord.created_at)
    ).scalars().all()

    if not edits:
        return SummarizeChangesResponse(summary="No changes to summarize.", change_items=[])

    platform_label = node.platform or "unknown"

    source_variant = next(
        (v for v in node.variants if v.get("id") == payload.variant_id), None
    )
    original_text = edits[0].before_text if edits else ""
    current_text = source_variant.get("text", "") if source_variant else (edits[-1].after_text if edits else "")

    changes_text = ""
    for i, e in enumerate(edits):
        changes_text += (
            f"\nChange {i+1} ({e.edit_type}):\n"
            f"Before: {e.before_text[:500]}\n"
            f"After: {e.after_text[:500]}\n"
        )
        if e.user_instruction:
            changes_text += f"User instruction: {e.user_instruction}\n"

    try:
        import json
        import re
        from app.services.llm import _get_client, _with_retries
        client = _get_client()

        resp = _with_retries(lambda: client.messages.create(
            model="claude-sonnet-4-20250514",
            max_tokens=2000,
            system=(
                "You are a senior content strategist analyzing edits made to a social media "
                f"post for '{platform_label}'. You have access to the original text, the "
                "final text after all edits, and the individual change log.\n\n"
                "Your job is to extract META-LEVEL editing directives — not literal text "
                "substitutions, but the INTENT and STRATEGY behind each change. Think of "
                "each directive as a reusable editing prompt that could be applied to any "
                "variant of this content to achieve the same improvement.\n\n"
                "For each change item:\n"
                "- `description`: A human-readable summary of what changed (for the user to review).\n"
                "- `edit_directive`: A clear, actionable instruction that an AI editor could "
                "follow to make this same type of change on a DIFFERENT piece of text. Write "
                "it as a direct editing command (e.g. 'Make the opening hook more urgent by "
                "leading with a surprising statistic instead of a generic statement' or "
                "'Reframe the CTA from passive to active voice, emphasizing immediate benefit').\n"
                "- `category`: one of tone|structure|factual|cta|formatting|style|messaging\n"
                "- `cross_platform_applicable`: true if this directive would improve content "
                "on ANY platform (tone shifts, factual corrections, messaging clarity, CTA "
                "improvements). false if it's platform-specific (hashtag edits, character "
                "count trims, emoji density, platform formatting).\n\n"
                "Output JSON:\n"
                '{"summary": "2-3 sentence overview of the editing session — what was the '
                'overall editorial direction and why", "change_items": ['
                '{"id": "1", "description": "user-facing summary of the change", '
                '"edit_directive": "actionable editing instruction for an AI to replicate '
                'this change on other text", '
                '"category": "tone|structure|factual|cta|formatting|style|messaging", '
                '"cross_platform_applicable": true}'
                "]}"
            ),
            messages=[{
                "role": "user",
                "content": (
                    f"=== ORIGINAL TEXT (before any edits) ===\n{original_text}\n\n"
                    f"=== CURRENT TEXT (after all edits) ===\n{current_text}\n\n"
                    f"=== INDIVIDUAL CHANGE LOG ===\n{changes_text}"
                ),
            }],
        ))
        raw = resp.content[0].text
        match = re.search(r'\{.*\}', raw, re.DOTALL)
        if match:
            data = json.loads(match.group())
            return SummarizeChangesResponse(
                summary=data.get("summary", ""),
                change_items=[
                    {
                        "id": str(ci.get("id", str(idx))),
                        "description": ci.get("description", ""),
                        "category": ci.get("category", "style"),
                        "edit_directive": ci.get("edit_directive", ci.get("description", "")),
                        "cross_platform_applicable": ci.get("cross_platform_applicable", True),
                    }
                    for idx, ci in enumerate(data.get("change_items", []))
                ],
            )
    except Exception:
        log.exception("Summarize changes failed")

    return SummarizeChangesResponse(
        summary=f"{len(edits)} edit(s) made during this session.",
        change_items=[
            {
                "id": str(i),
                "description": f"{e.edit_type} edit",
                "category": "style",
                "edit_directive": f"Apply the same type of edit: {e.user_instruction or 'refine the content similarly'}",
                "cross_platform_applicable": True,
            }
            for i, e in enumerate(edits)
        ],
    )


# ─── Propagate Changes ──────────────────────────────────────────────────────

@router.post("/runs/{run_id}/propagate-changes", response_model=PropagateChangesResponse)
def propagate_changes(
    run_id: str,
    payload: PropagateChangesRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
) -> PropagateChangesResponse:
    run = db.get(WorkflowRunRecord, run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")

    node = db.get(WorkflowNodeStateRecord, payload.node_id)
    if not node or node.workflow_run_id != run_id:
        raise HTTPException(status_code=404, detail="Node not found")

    source_edits = db.execute(
        select(EditRecord)
        .where(
            EditRecord.run_id == run_id,
            EditRecord.node_id == payload.node_id,
            EditRecord.variant_id == payload.source_variant_id,
        )
        .order_by(EditRecord.created_at)
    ).scalars().all()

    if not source_edits and not payload.edit_directives:
        raise HTTPException(status_code=400, detail="No edits to propagate")

    # Build the editing prompt from directives (preferred) or fall back to raw diffs
    if payload.edit_directives:
        directives_block = "\n".join(
            f"{i+1}. {d}" for i, d in enumerate(payload.edit_directives)
        )
    else:
        if payload.change_item_ids:
            selected_indices = set()
            for cid in payload.change_item_ids:
                try:
                    selected_indices.add(int(cid))
                except ValueError:
                    pass
            if selected_indices:
                source_edits = [e for i, e in enumerate(source_edits) if i in selected_indices]

        directives_block = "\n".join(
            f"- {e.edit_type}: Before='{e.before_text[:200]}' After='{e.after_text[:200]}'"
            for e in source_edits
        )

    source_variant = next(
        (v for v in node.variants if v.get("id") == payload.source_variant_id), None
    )
    source_current = source_variant.get("text", "") if source_variant else ""
    source_platform = node.platform or "unknown"

    updated_variants_list: list[dict] = []
    updated_nodes_list: list[dict] = []
    propagated_count = 0

    def _apply_directives(
        client, target_text: str, target_platform: str, is_cross_platform: bool,
    ) -> str:
        """Use the meta-level directives as an editing prompt."""
        if is_cross_platform:
            context = (
                f"You are editing a {target_platform} social media post. The user edited "
                f"a {source_platform} version of this content and wants to apply the same "
                f"improvements to this {target_platform} version.\n\n"
                f"Adapt each directive to {target_platform}'s conventions (format, length, "
                "tone norms). Do NOT copy text literally from the source — interpret the "
                "INTENT of each directive and apply it naturally to the target."
            )
        else:
            context = (
                "You are editing a variant of the same social media post. The user edited "
                "another variant and wants to apply the same improvements here.\n\n"
                "Preserve THIS variant's unique hook, voice, and structure. Apply the "
                "INTENT of each directive, not literal text."
            )

        resp = _with_retries(lambda t=target_text: client.messages.create(
            model="claude-sonnet-4-20250514",
            max_tokens=2048,
            system=(
                f"{context}\n\n"
                "Follow EACH editing directive below. Apply them all to the target text.\n"
                'Output JSON: {"adapted_text": "the full revised text", '
                '"adaptation_notes": "brief explanation of what you did for each directive"}'
            ),
            messages=[{
                "role": "user",
                "content": (
                    f"=== REFERENCE (the edited source) ===\n{source_current}\n\n"
                    f"=== EDITING DIRECTIVES ===\n{directives_block}\n\n"
                    f"=== TARGET TEXT TO EDIT ===\n{t}\n\n"
                    f"Apply all the editing directives to the target text."
                ),
            }],
        ))
        raw = resp.content[0].text
        match = re.search(r'\{.*\}', raw, re.DOTALL)
        if match:
            data = json.loads(match.group())
            return data.get("adapted_text", target_text)
        return target_text

    try:
        import json
        import re
        from app.services.llm import _get_client, _with_retries
        client = _get_client()

        # ── Phase 1: propagate to other variants within the same node ────
        updated_all_variants = list(node.variants)
        for target_vid in payload.target_variant_ids:
            target = next((v for v in updated_all_variants if v.get("id") == target_vid), None)
            if not target:
                continue

            target_text = target.get("text", "")
            new_text = _apply_directives(client, target_text, source_platform, False)

            if new_text != target_text:
                edit_rec = _create_edit_record(
                    db, run_id, payload.node_id, target_vid,
                    "propagated", target_text, new_text,
                    propagated_from=source_edits[-1].id if source_edits else None,
                )

                for v in updated_all_variants:
                    if v.get("id") == target_vid:
                        v["text"] = new_text
                        v["status"] = "edited"

                updated_variants_list.append({
                    "variant_id": target_vid,
                    "new_text": new_text,
                    "edit_record_id": edit_rec.id,
                })
                propagated_count += 1

        node.variants = updated_all_variants
        db.commit()

        # ── Phase 2: cross-platform propagation to other nodes ───────────
        for target_node_id in (payload.target_node_ids or []):
            target_node = db.get(WorkflowNodeStateRecord, target_node_id)
            if not target_node or target_node.workflow_run_id != run_id:
                continue
            target_platform = target_node.platform or "unknown"
            target_variants = list(target_node.variants)
            node_updated_variants = []

            for tv in target_variants:
                tv_text = tv.get("text", "")
                if not tv_text:
                    continue

                new_text = _apply_directives(client, tv_text, target_platform, True)

                if new_text != tv_text:
                    edit_rec = _create_edit_record(
                        db, run_id, target_node_id, tv.get("id", ""),
                        "propagated", tv_text, new_text,
                        propagated_from=source_edits[-1].id if source_edits else None,
                    )
                    tv["text"] = new_text
                    tv["status"] = "edited"
                    node_updated_variants.append({
                        "variant_id": tv.get("id", ""),
                        "new_text": new_text,
                        "edit_record_id": edit_rec.id,
                    })
                    propagated_count += 1

            if node_updated_variants:
                target_node.variants = target_variants
                db.commit()
                updated_nodes_list.append({
                    "node_id": target_node_id,
                    "platform": target_platform,
                    "updated_variants": node_updated_variants,
                })
                background_tasks.add_task(_run_revalidation, run_id, target_node_id)

    except Exception:
        log.exception("Propagate changes failed")
        db.rollback()

    background_tasks.add_task(_run_revalidation, run_id, node.id)

    return PropagateChangesResponse(
        propagated_count=propagated_count,
        updated_variants=updated_variants_list,
        updated_nodes=updated_nodes_list,
    )


# ─── Edit History ────────────────────────────────────────────────────────────

@router.get(
    "/runs/{run_id}/nodes/{node_id}/edit-history",
    response_model=list[EditRecordResponse],
)
def get_edit_history(
    run_id: str,
    node_id: str,
    variant_id: str | None = None,
    db: Session = Depends(get_db),
) -> list[EditRecordResponse]:
    stmt = (
        select(EditRecord)
        .where(EditRecord.run_id == run_id, EditRecord.node_id == node_id)
    )
    if variant_id:
        stmt = stmt.where(EditRecord.variant_id == variant_id)
    stmt = stmt.order_by(EditRecord.created_at)

    edits = db.execute(stmt).scalars().all()
    return [
        EditRecordResponse(
            id=e.id,
            run_id=e.run_id,
            node_id=e.node_id,
            variant_id=e.variant_id,
            edit_type=e.edit_type,
            before_text=e.before_text,
            after_text=e.after_text,
            diff_ops=e.diff_ops or [],
            summary=e.summary,
            user_instruction=e.user_instruction,
            chat_session_id=e.chat_session_id,
            propagated_from=e.propagated_from,
            created_at=e.created_at.isoformat() if e.created_at else None,
        )
        for e in edits
    ]


# ─── Audit ───────────────────────────────────────────────────────────────────

@router.get("/runs/{run_id}/audit", response_model=list[AuditLogResponse])
def get_run_audit(run_id: str, db: Session = Depends(get_db)) -> list[AuditLogResponse]:
    rows = db.execute(
        select(WorkflowAuditLog)
        .where(WorkflowAuditLog.run_id == run_id)
        .order_by(WorkflowAuditLog.created_at)
    ).scalars().all()
    return [
        AuditLogResponse(
            id=r.id, run_id=r.run_id, node_id=r.node_id, step=r.step,
            agent_name=r.agent_name, platform=r.platform,
            input_summary=r.input_summary, output_summary=r.output_summary,
            token_usage=r.token_usage, latency_ms=r.latency_ms, status=r.status,
            created_at=r.created_at.isoformat() if r.created_at else None,
        )
        for r in rows
    ]


@router.get("/runs/{run_id}/traces")
def get_run_traces(
    run_id: str,
    platform: str | None = None,
    since: str | None = None,
    db: Session = Depends(get_db),
) -> list[dict]:
    """Query LangSmith for live agent traces for a run."""
    try:
        from langsmith import Client as LSClient
        import os
        from app.core.config_store import get_config
        api_key = (
            get_config(db, "langsmith_api_key")
            or os.environ.get("LANGCHAIN_API_KEY", "")
        )
        project = (
            get_config(db, "langsmith_project")
            or os.environ.get("LANGCHAIN_PROJECT", "adapt-ai")
        )
        if not api_key:
            return []

        ls_filter = (
            f"and(eq(metadata_key, 'run_id'), "
            f"eq(metadata_value, '{run_id}'))"
        )

        ls_kwargs: dict = dict(
            project_name=project,
            filter=ls_filter,
            limit=80,
        )
        from datetime import datetime as _dt, timezone as _tz
        effective_since = since
        if not effective_since and platform:
            node = db.execute(
                select(WorkflowNodeStateRecord).where(
                    WorkflowNodeStateRecord.workflow_run_id == run_id,
                    WorkflowNodeStateRecord.platform == platform,
                )
            ).scalars().first()
            if node and getattr(node, "started_at", None):
                effective_since = node.started_at.isoformat()
        if effective_since:
            try:
                ts = _dt.fromisoformat(
                    effective_since.replace("Z", "+00:00"),
                )
                if ts.tzinfo is None:
                    ts = ts.replace(tzinfo=_tz.utc)
                ls_kwargs["start_time"] = ts
            except ValueError:
                pass

        client = LSClient(api_key=api_key)
        runs = client.list_runs(**ls_kwargs)

        traces: list[dict] = []
        for r in runs:
            meta = getattr(r, "metadata", None) or {}

            plat = meta.get("platform", "")
            if platform and plat and plat != platform:
                continue

            elapsed_ms = None
            if r.end_time and r.start_time:
                elapsed_ms = int(
                    (r.end_time - r.start_time).total_seconds()
                    * 1000
                )
            elif r.start_time:
                from datetime import datetime, timezone
                elapsed_ms = int(
                    (datetime.now(timezone.utc) - r.start_time)
                    .total_seconds() * 1000
                )

            agent_name = meta.get("agent") or r.name
            if agent_name == "ChatAnthropic":
                agent_name = meta.get("agent", "LLM Call")

            traces.append({
                "id": str(r.id),
                "name": r.name,
                "run_type": r.run_type,
                "status": r.status or (
                    "completed" if r.end_time else "running"
                ),
                "agent": agent_name,
                "step": meta.get("step", ""),
                "platform": plat,
                "node_id": meta.get("node_id", ""),
                "start_time": (
                    r.start_time.isoformat()
                    if r.start_time else None
                ),
                "end_time": (
                    r.end_time.isoformat()
                    if r.end_time else None
                ),
                "elapsed_ms": elapsed_ms,
                "total_tokens": r.total_tokens or 0,
                "error": r.error,
                "output_snippet": "",
            })

        traces.sort(
            key=lambda t: t.get("start_time") or "",
        )
        return traces
    except ImportError:
        return []
    except Exception:
        log.exception("Failed to query LangSmith traces")
        return []


# ─── Helpers ─────────────────────────────────────────────────────────────────

def _build_run_response(db: Session, run_id: str) -> WorkflowRunResponse:
    run = db.get(WorkflowRunRecord, run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Workflow run not found")

    nodes = db.execute(
        select(WorkflowNodeStateRecord).where(WorkflowNodeStateRecord.workflow_run_id == run_id)
    ).scalars().all()

    response_nodes: list[WorkflowNodeStateResponse] = []
    for node in nodes:
        started_at_val = getattr(node, "started_at", None)
        response_nodes.append(
            WorkflowNodeStateResponse(
                id=node.id,
                node_type=node.node_type,  # type: ignore[arg-type]
                platform=node.platform,  # type: ignore[arg-type]
                status=node.status,
                composition=node.composition,
                variants=node.variants,  # type: ignore[arg-type]
                validation_results=getattr(node, "validation_results", None) or [],
                started_at=started_at_val.isoformat() if started_at_val else None,
            )
        )

    return WorkflowRunResponse(
        id=run.id, definition_id=run.definition_id,
        source_content=run.source_content,
        source_images=getattr(run, "source_images", None) or [],
        status=run.status, dag_state=run.dag_state,
        created_at=run.created_at.isoformat() if run.created_at else None,
        nodes=response_nodes,
    )


def _load_voice_for_accept(db: Session, voice_id: str | None) -> dict:
    if not voice_id:
        return {}
    voice = db.get(VoiceRecord, voice_id)
    if not voice:
        return {}
    return {
        "name": voice.name,
        "attributes": voice.attributes,
        "avoid_list": voice.avoid_list,
        "overrides": voice.overrides,
    }


def _load_persona_for_accept(db: Session, agent_id: str | None) -> dict:
    if not agent_id:
        return {}
    persona = db.get(PersonaRecord, agent_id)
    if not persona:
        return {}
    return {
        "name": persona.name,
        "writing_approach": persona.writing_approach,
        "tone": persona.tone,
    }


def _load_audiences_for_accept(
    db: Session, audience_ids: list[str] | None,
) -> list[dict]:
    if not audience_ids:
        return []
    results: list[dict] = []
    for aid in audience_ids:
        audience = db.get(PersonaRecord, aid)
        if audience:
            results.append({
                "name": audience.name,
                "description": getattr(audience, "description", ""),
            })
    return results


def _load_ruleset_for_accept(
    db: Session, rule_set_id: str | None,
) -> dict:
    if not rule_set_id:
        return {}
    from app.db.models import RuleSetRecord
    rs = db.get(RuleSetRecord, rule_set_id)
    if not rs:
        return {}
    return {"name": rs.name, "rules": rs.rules}


def _levenshtein_distance(s1: str, s2: str) -> int:
    if len(s1) < len(s2):
        return _levenshtein_distance(s2, s1)
    if len(s2) == 0:
        return len(s1)
    prev_row = list(range(len(s2) + 1))
    for i, c1 in enumerate(s1):
        curr_row = [i + 1]
        for j, c2 in enumerate(s2):
            insertions = prev_row[j + 1] + 1
            deletions = curr_row[j] + 1
            substitutions = prev_row[j] + (c1 != c2)
            curr_row.append(min(insertions, deletions, substitutions))
        prev_row = curr_row
    return prev_row[-1]
