from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.config_store import get_all_config, set_many_config, get_config
from app.db.session import get_db

router = APIRouter(prefix="/v1/settings", tags=["settings"])


class ConfigUpdateRequest(BaseModel):
    values: dict[str, str]


@router.get("")
def get_settings(db: Session = Depends(get_db)) -> dict:
    """Return all config keys with values masked for display."""
    masked = get_all_config(db)
    configured: dict[str, bool] = {}
    for key, val in masked.items():
        configured[key] = bool(val and not val.startswith("••••") or val.startswith("••••"))
    # Simply: configured = has a non-empty value
    configured = {k: bool(v) for k, v in masked.items()}
    return {"values": masked, "configured": configured}


@router.put("")
def update_settings(payload: ConfigUpdateRequest, db: Session = Depends(get_db)) -> dict:
    """Update config values. Empty strings and masked values are skipped."""
    set_many_config(db, payload.values)

    ls_keys = ("langsmith_api_key", "langsmith_project")
    if any(k in payload.values for k in ls_keys):
        from app.main import _configure_langsmith
        _configure_langsmith()

    return get_settings(db)


@router.get("/status")
def settings_status(db: Session = Depends(get_db)) -> dict:
    """Quick check: which integrations are configured?"""
    return {
        "anthropic": bool(get_config(db, "anthropic_api_key")),
        "x": bool(get_config(db, "x_client_id")),
        "linkedin": bool(get_config(db, "linkedin_client_id")),
        "instagram": bool(get_config(db, "facebook_app_id")),
        "tiktok": bool(get_config(db, "tiktok_client_key")),
    }
