from fastapi import APIRouter, HTTPException
import uuid
from typing import cast
from sqlalchemy.orm import Session
from fastapi import Depends

from app.db.models import RunRecord, VariantEditRecord
from app.db.session import get_db
from app.schemas.run import (
    Platform,
    RunCreateRequest,
    RunResponse,
    VariantRegenerateRequest,
    VariantUpdateRequest,
)
from app.services.generation import generate_platform_output, regenerate_variant_text

router = APIRouter(prefix="/v1/runs", tags=["runs"])


@router.post("", response_model=RunResponse)
def create_run(payload: RunCreateRequest, db: Session = Depends(get_db)) -> RunResponse:
    run_id = str(uuid.uuid4())
    outputs = [
        generate_platform_output(payload.source_content, platform)
        for platform in payload.platforms
    ]
    run = RunResponse(run_id=run_id, outputs=outputs)
    db.add(
        RunRecord(
            id=run_id,
            source_content=payload.source_content,
            run_payload=run.model_dump(),
        )
    )
    db.commit()
    return run


@router.get("/{run_id}", response_model=RunResponse)
def get_run(run_id: str, db: Session = Depends(get_db)) -> RunResponse:
    stored = db.get(RunRecord, run_id)
    if not stored:
        raise HTTPException(status_code=404, detail="Run not found")
    return RunResponse(**stored.run_payload)


@router.put("/{run_id}/nodes/{platform}/variants/{variant_id}", response_model=RunResponse)
def update_variant(
    run_id: str,
    platform: str,
    variant_id: str,
    payload: VariantUpdateRequest,
    db: Session = Depends(get_db),
) -> RunResponse:
    stored = db.get(RunRecord, run_id)
    if not stored:
        raise HTTPException(status_code=404, detail="Run not found")

    run_data = stored.run_payload
    for output in run_data["outputs"]:
        if output["platform"] != platform:
            continue
        for variant in output["variants"]:
            if variant["id"] == variant_id:
                old_text = variant["text"]
                if payload.text is not None:
                    variant["text"] = payload.text
                    variant["status"] = "edited"
                if payload.status is not None:
                    variant["status"] = payload.status
                db.add(
                    VariantEditRecord(
                        run_id=run_id,
                        platform=platform,
                        variant_id=variant_id,
                        action="update",
                        old_text=old_text,
                        new_text=variant["text"],
                    )
                )
                stored.run_payload = dict(run_data)
                db.commit()
                return RunResponse(**run_data)

    raise HTTPException(status_code=404, detail="Variant not found")


@router.post(
    "/{run_id}/nodes/{platform}/variants/{variant_id}/regenerate",
    response_model=RunResponse,
)
def regenerate_variant(
    run_id: str,
    platform: str,
    variant_id: str,
    payload: VariantRegenerateRequest,
    db: Session = Depends(get_db),
) -> RunResponse:
    stored = db.get(RunRecord, run_id)
    if not stored:
        raise HTTPException(status_code=404, detail="Run not found")

    source_content = stored.source_content
    run_data = stored.run_payload

    if platform not in {"linkedin", "x", "instagram", "tiktok"}:
        raise HTTPException(status_code=400, detail="Unsupported platform")

    platform_value = cast(Platform, platform)

    for output in run_data["outputs"]:
        if output["platform"] != platform:
            continue
        for variant in output["variants"]:
            if variant["id"] == variant_id:
                old_text = variant["text"]
                new_text, new_rationale = regenerate_variant_text(
                    source_content=source_content,
                    platform=platform_value,
                    label=variant["label"],
                    context=payload.context,
                )
                variant["text"] = new_text
                variant["rationale"] = new_rationale
                variant["status"] = "generated"
                db.add(
                    VariantEditRecord(
                        run_id=run_id,
                        platform=platform,
                        variant_id=variant_id,
                        action="regenerate",
                        old_text=old_text,
                        new_text=new_text,
                    )
                )
                stored.run_payload = dict(run_data)
                db.commit()
                return RunResponse(**run_data)

    raise HTTPException(status_code=404, detail="Variant not found")
