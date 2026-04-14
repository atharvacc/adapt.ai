"""
Runtime config store — reads from DB (config table) first,
falls back to env-based settings.
Lets users manage API keys from the UI without restarting.
"""
from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.settings import settings
from app.db.models import ConfigRecord

ALL_CONFIG_KEYS = [
    "anthropic_api_key",
    "openai_api_key",
    "voyage_api_key",
    "langsmith_api_key",
    "langsmith_project",
    "x_client_id",
    "x_client_secret",
    "linkedin_client_id",
    "linkedin_client_secret",
    "facebook_app_id",
    "facebook_app_secret",
    "facebook_page_token",
]


def get_config(db: Session, key: str) -> str:
    """Get a config value: DB first, then env var fallback."""
    row = db.get(ConfigRecord, key)
    if row and row.value:
        return row.value
    return getattr(settings, key, "")


def get_all_config(db: Session) -> dict[str, str]:
    """Get all config values with masking for display."""
    result: dict[str, str] = {}
    rows = db.execute(select(ConfigRecord)).scalars().all()
    db_values = {r.key: r.value for r in rows}

    for key in ALL_CONFIG_KEYS:
        val = db_values.get(key) or getattr(settings, key, "")
        result[key] = _mask(val) if val else ""
    return result


def get_all_config_raw(db: Session) -> dict[str, str]:
    """Get all config values unmasked (for internal use only)."""
    result: dict[str, str] = {}
    rows = db.execute(select(ConfigRecord)).scalars().all()
    db_values = {r.key: r.value for r in rows}

    for key in ALL_CONFIG_KEYS:
        result[key] = db_values.get(key) or getattr(settings, key, "")
    return result


def set_config(db: Session, key: str, value: str) -> None:
    """Set a config value in the DB."""
    row = db.get(ConfigRecord, key)
    if row:
        row.value = value
    else:
        db.add(ConfigRecord(key=key, value=value))
    db.commit()


def set_many_config(db: Session, updates: dict[str, str]) -> None:
    """Batch-set config values. Skips empty strings and masked values."""
    for key, value in updates.items():
        if key not in ALL_CONFIG_KEYS:
            continue
        if not value or value.startswith("••••"):
            continue
        set_config(db, key, value)


def _mask(val: str) -> str:
    if len(val) <= 8:
        return "••••" + val[-2:] if len(val) >= 2 else "••••"
    return val[:4] + "••••" + val[-4:]
