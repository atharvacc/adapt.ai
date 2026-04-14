"""Developer tools API — raw data explorer for all tables."""
from __future__ import annotations

from datetime import datetime
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, inspect, select
from sqlalchemy.orm import Session, defer

from app.db.models import (
    AccountRecord,
    ConfigRecord,
    ContentFeedback,
    DocumentEmbedding,
    PersonaRecord,
    RecordVersion,
    RuleSetRecord,
    RunChangeLog,
    RunRecord,
    VariantEditRecord,
    VoiceRecord,
    WorkflowAuditLog,
    WorkflowDefinitionRecord,
    WorkflowNodeStateRecord,
    WorkflowRunRecord,
)
from app.db.session import get_db

router = APIRouter(prefix="/v1/devtools", tags=["devtools"])

TABLE_MAP: dict[str, type] = {
    "accounts": AccountRecord,
    "voices": VoiceRecord,
    "personas": PersonaRecord,
    "rule_sets": RuleSetRecord,
    "workflow_definitions": WorkflowDefinitionRecord,
    "workflow_runs": WorkflowRunRecord,
    "workflow_node_states": WorkflowNodeStateRecord,
    "workflow_audit_logs": WorkflowAuditLog,
    "content_feedback": ContentFeedback,
    "run_change_logs": RunChangeLog,
    "document_embeddings": DocumentEmbedding,
    "config": ConfigRecord,
    "record_versions": RecordVersion,
    "runs": RunRecord,
    "variant_edits": VariantEditRecord,
}


def _row_to_dict(row: Any) -> dict:
    """Convert a SQLAlchemy model instance to a JSON-safe dict."""
    mapper = inspect(type(row))
    inst_dict = inspect(row).dict
    result: dict[str, Any] = {}
    for col in mapper.columns:
        out_key = col.name
        if col.key == "embedding":
            result[out_key] = "(deferred — vector data)"
            continue
        try:
            val = inst_dict.get(col.key, None)
        except Exception:
            val = None
        if isinstance(val, datetime):
            val = val.isoformat()
        elif not isinstance(val, (str, int, float, bool, list, dict, type(None))):
            val = str(val)
        result[out_key] = val
    return result


@router.get("/stats")
def get_stats(
    db: Session = Depends(get_db),
) -> dict[str, int]:
    """Row counts for every table."""
    counts: dict[str, int] = {}
    for name, model in TABLE_MAP.items():
        try:
            count = db.execute(
                select(func.count()).select_from(model)
            ).scalar() or 0
            counts[name] = count
        except Exception:
            counts[name] = 0
    return counts


@router.get("/{table_name}")
def get_table(
    table_name: str,
    limit: int = Query(default=200, le=1000),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
) -> dict:
    """Return rows from the specified table."""
    model = TABLE_MAP.get(table_name)
    if not model:
        raise HTTPException(
            status_code=404,
            detail=f"Unknown table: {table_name}",
        )

    mapper = inspect(model)
    created_col = None
    for col in mapper.columns:
        if col.key == "created_at":
            created_col = col
            break

    stmt = select(model)
    if model is DocumentEmbedding:
        stmt = stmt.options(defer(DocumentEmbedding.embedding))
    if created_col is not None:
        stmt = stmt.order_by(created_col.desc())
    stmt = stmt.offset(offset).limit(limit)

    rows = db.execute(stmt).scalars().all()
    total = db.execute(
        select(func.count()).select_from(model)
    ).scalar() or 0

    return {
        "table": table_name,
        "total": total,
        "offset": offset,
        "limit": limit,
        "rows": [_row_to_dict(r) for r in rows],
    }
