import logging
from datetime import datetime, timedelta

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.db.models import (
    AccountRecord,
    PersonaRecord,
    RecordVersion,
    RunRecord,
    RuleSetRecord,
    VoiceRecord,
)
from app.db.session import SessionLocal, get_db
from app.services.platforms import fetch_platform_data

log = logging.getLogger(__name__)

router = APIRouter(prefix="/v1", tags=["resources"])


# ---------------------------------------------------------------------------
# RAG Auto-Index helpers
# ---------------------------------------------------------------------------

def _index_voice(voice_id: str) -> None:
    """Background task: embed a voice profile into the vector store."""
    from app.services.embeddings import embed_and_store
    db = SessionLocal()
    try:
        record = db.get(VoiceRecord, voice_id)
        if not record:
            return
        chunks = []
        if record.description:
            chunks.append(record.description)
        if record.purpose:
            chunks.append(f"Purpose: {record.purpose}")
        attrs = record.attributes or {}
        for attr_name, attr_val in attrs.items():
            chunks.append(f"{attr_name}: {attr_val}")
        overrides = record.overrides or {}
        for key, val in overrides.items():
            if isinstance(val, str) and val:
                chunks.append(f"{key}: {val}")
            elif isinstance(val, list):
                chunks.append(f"{key}: {', '.join(str(v) for v in val)}")
        if chunks:
            embed_and_store(db, "voice", voice_id, chunks, {"name": record.name})
    except Exception:
        log.exception("Auto-index failed for voice %s", voice_id)
    finally:
        db.close()


def _index_persona(persona_id: str) -> None:
    """Background task: embed a persona into the vector store."""
    from app.services.embeddings import embed_and_store
    db = SessionLocal()
    try:
        record = db.get(PersonaRecord, persona_id)
        if not record:
            return
        chunks = []
        if record.description:
            chunks.append(record.description)
        if record.interests:
            chunks.append(f"Interests: {', '.join(str(i) for i in record.interests)}")
        if record.content_preferences:
            chunks.append(f"Content preferences: {record.content_preferences}")
        if record.goals_and_triggers:
            chunks.append(f"Goals: {record.goals_and_triggers}")
        if chunks:
            embed_and_store(db, "persona", persona_id, chunks, {"name": record.name, "type": record.persona_type})
    except Exception:
        log.exception("Auto-index failed for persona %s", persona_id)
    finally:
        db.close()


def _index_rule_set(rule_set_id: str) -> None:
    """Background task: embed a rule set into the vector store."""
    from app.services.embeddings import embed_and_store
    db = SessionLocal()
    try:
        record = db.get(RuleSetRecord, rule_set_id)
        if not record:
            return
        chunks = []
        if record.description:
            chunks.append(record.description)
        for rule in (record.rules or []):
            if isinstance(rule, dict):
                txt = f"{rule.get('name', '')}: {rule.get('description', '')}"
                chunks.append(txt)
        if chunks:
            embed_and_store(db, "rule_set", rule_set_id, chunks, {"name": record.name})
    except Exception:
        log.exception("Auto-index failed for rule_set %s", rule_set_id)
    finally:
        db.close()


def _index_posts(account_id: str) -> None:
    """Background task: embed imported posts from an account."""
    from app.services.embeddings import embed_and_store
    db = SessionLocal()
    try:
        record = db.get(AccountRecord, account_id)
        if not record or not record.imported_posts:
            return
        chunks = []
        for post in record.imported_posts:
            if isinstance(post, dict):
                text = post.get("text", post.get("content", ""))
                if text:
                    chunks.append(text)
        if chunks:
            embed_and_store(db, "post", account_id, chunks, {"platform": record.platform, "handle": record.handle})
    except Exception:
        log.exception("Auto-index failed for posts of account %s", account_id)
    finally:
        db.close()


def _row_to_dict(row) -> dict:
    d = {c.key: getattr(row, c.key) for c in row.__table__.columns}
    d.pop("api_token", None)
    return d


def _snapshot_version(db: Session, entity_type: str, record) -> int:
    """Save a snapshot of the current record state before mutation. Returns the new version number."""
    last = (
        db.query(RecordVersion)
        .filter_by(entity_type=entity_type, entity_id=record.id)
        .order_by(RecordVersion.version.desc())
        .first()
    )
    next_version = (last.version + 1) if last else 1
    snapshot = _row_to_dict(record)
    snapshot.pop("api_token", None)
    db.add(RecordVersion(
        entity_type=entity_type,
        entity_id=record.id,
        version=next_version,
        snapshot=snapshot,
    ))
    db.flush()
    return next_version


# ---------------------------------------------------------------------------
# Accounts — schemas
# ---------------------------------------------------------------------------


class ConnectAccountRequest(BaseModel):
    platform: str
    handle: str
    api_token: str


class SyncAccountRequest(BaseModel):
    api_token: str | None = None


# ---------------------------------------------------------------------------
# Accounts
# ---------------------------------------------------------------------------


@router.get("/accounts")
def list_accounts(db: Session = Depends(get_db)) -> list[dict]:
    rows = db.execute(select(AccountRecord)).scalars().all()
    return [_row_to_dict(r) for r in rows]


@router.post("/accounts", status_code=201)
async def create_account(payload: ConnectAccountRequest, db: Session = Depends(get_db)) -> dict:
    record = AccountRecord(
        platform=payload.platform,
        handle=payload.handle,
        api_token=payload.api_token,
        status="syncing",
    )
    db.add(record)
    db.commit()
    db.refresh(record)

    try:
        data = await fetch_platform_data(payload.platform, payload.api_token, payload.handle)
        record.profile_data = data.get("profile", {})
        record.imported_posts = data.get("posts", [])
        record.post_count = len(data.get("posts", []))
        record.data_health_percent = data.get("data_health_percent", 0)
        record.status = "connected"

        from datetime import datetime, timezone
        record.last_sync_at = datetime.now(timezone.utc)

        from app.core.settings import settings
        if settings.anthropic_api_key and record.imported_posts:
            try:
                from app.services.llm import analyze_account_posts
                inferences = analyze_account_posts(record.imported_posts, payload.platform)
                record.inferences = inferences
            except Exception:
                log.warning("Post analysis failed, skipping inferences")
                record.inferences = {}

        db.commit()
        db.refresh(record)
    except Exception as exc:
        log.exception("Failed to fetch platform data for %s", payload.platform)
        record.status = "error"
        record.profile_data = {"error": str(exc)}
        db.commit()
        db.refresh(record)

    return _row_to_dict(record)


@router.get("/accounts/{account_id}")
def get_account(account_id: str, db: Session = Depends(get_db)) -> dict:
    record = db.get(AccountRecord, account_id)
    if not record:
        raise HTTPException(status_code=404, detail="Account not found")
    return _row_to_dict(record)


@router.post("/accounts/{account_id}/sync")
async def sync_account(
    account_id: str,
    payload: SyncAccountRequest | None = None,
    db: Session = Depends(get_db),
) -> dict:
    """Re-sync an existing account to fetch latest data."""
    record = db.get(AccountRecord, account_id)
    if not record:
        raise HTTPException(status_code=404, detail="Account not found")

    token = (payload.api_token if payload and payload.api_token else record.api_token)
    if not token:
        raise HTTPException(status_code=400, detail="No API token available for sync")

    if payload and payload.api_token:
        record.api_token = payload.api_token

    record.status = "syncing"
    db.commit()

    try:
        data = await fetch_platform_data(record.platform, token, record.handle)
        record.profile_data = data.get("profile", {})
        record.imported_posts = data.get("posts", [])
        record.post_count = len(data.get("posts", []))
        record.data_health_percent = data.get("data_health_percent", 0)
        record.status = "connected"

        from datetime import datetime, timezone
        record.last_sync_at = datetime.now(timezone.utc)

        from app.core.settings import settings
        if settings.anthropic_api_key and record.imported_posts:
            try:
                from app.services.llm import analyze_account_posts
                inferences = analyze_account_posts(record.imported_posts, record.platform)
                record.inferences = inferences
            except Exception:
                log.warning("Post analysis failed during sync")

        db.commit()
        db.refresh(record)
    except Exception as exc:
        log.exception("Sync failed for account %s", account_id)
        record.status = "error"
        record.profile_data = {**record.profile_data, "sync_error": str(exc)}
        db.commit()
        db.refresh(record)

    return _row_to_dict(record)


@router.put("/accounts/{account_id}")
def update_account(
    account_id: str, payload: dict, db: Session = Depends(get_db)
) -> dict:
    record = db.get(AccountRecord, account_id)
    if not record:
        raise HTTPException(status_code=404, detail="Account not found")
    for key, value in payload.items():
        if hasattr(record, key) and key not in ("id", "api_token"):
            setattr(record, key, value)
    db.commit()
    db.refresh(record)
    return _row_to_dict(record)


@router.delete("/accounts/{account_id}", status_code=204)
def delete_account(account_id: str, db: Session = Depends(get_db)) -> None:
    record = db.get(AccountRecord, account_id)
    if not record:
        raise HTTPException(status_code=404, detail="Account not found")
    db.delete(record)
    db.commit()


# ---------------------------------------------------------------------------
# Voices
# ---------------------------------------------------------------------------


@router.get("/voices")
def list_voices(db: Session = Depends(get_db)) -> list[dict]:
    rows = db.execute(select(VoiceRecord)).scalars().all()
    return [_row_to_dict(r) for r in rows]


class CreateVoiceRequest(BaseModel):
    name: str = Field(min_length=1)
    purpose: str = ""
    source_account_ids: list[str] = Field(default_factory=list)
    training_period: str = "6mo"


def _training_cutoff(period: str) -> datetime | None:
    """Convert a period string like '3mo' to a cutoff datetime. 'all' means no cutoff."""
    now = datetime.utcnow()
    mapping = {"3mo": 90, "6mo": 180, "12mo": 365}
    days = mapping.get(period)
    if days is None:
        return None
    return now - timedelta(days=days)


def _collect_training_data(
    account_ids: list[str], cutoff: datetime | None, db: Session,
) -> tuple[list[dict], str, list[dict]]:
    """
    Gather posts from selected accounts (filtered by training period),
    plus org name and handle info for the agent.
    Returns (posts, org_name, account_handles).
    """
    accounts = db.query(AccountRecord).filter(
        AccountRecord.id.in_(account_ids),
        AccountRecord.status.in_(["active", "connected"]),
    ).all()

    posts: list[dict] = []
    org_name = ""
    account_handles: list[dict] = []

    for acct in accounts:
        profile = acct.profile_data or {}
        if not org_name:
            org_name = profile.get("name", acct.handle)

        account_handles.append({
            "platform": acct.platform,
            "handle": acct.handle,
            "name": profile.get("name", acct.handle),
            "bio": profile.get("bio", ""),
        })

        for post in (acct.imported_posts or []):
            p = dict(post)
            p["platform"] = acct.platform
            if cutoff is not None:
                date_str = p.get("date")
                if date_str and date_str != "unknown":
                    try:
                        post_date = _parse_date_flexible(date_str)
                        if post_date < cutoff:
                            continue
                    except Exception:
                        pass  # treat unparseable dates as latest → include
            posts.append(p)

    return posts, org_name, account_handles


def _parse_date_flexible(date_str: str) -> datetime:
    """Try multiple date formats."""
    for fmt in ("%Y-%m-%d", "%Y-%m-%dT%H:%M:%S", "%b %d, %Y", "%d %b %Y", "%m/%d/%Y"):
        try:
            return datetime.strptime(date_str.strip(), fmt)
        except ValueError:
            continue
    raise ValueError(f"Unparseable date: {date_str}")


def _generate_voice_background(
    voice_id: str,
    posts: list[dict],
    name: str,
    purpose: str,
    org_name: str,
    account_handles: list[dict],
) -> None:
    """Run agentic voice generation with Claude in a background thread."""
    from app.services.llm import generate_brand_voice

    db = SessionLocal()
    try:
        record = db.get(VoiceRecord, voice_id)
        if not record:
            return
        try:
            result = generate_brand_voice(
                posts, name, purpose,
                org_name=org_name,
                account_handles=account_handles,
            )
            record.attributes = result.get("attributes", {})
            record.avoid_list = result.get("avoid_list", [])
            record.description = result.get("description", "")
            record.overrides = {
                "tone_descriptors": result.get("tone_descriptors", []),
                "vocabulary_patterns": result.get("vocabulary_patterns", []),
                "structure_patterns": result.get("structure_patterns", []),
                "platform_nuances": result.get("platform_nuances", {}),
                "web_research_notes": result.get("web_research_notes", ""),
                "top_performing_patterns": result.get("top_performing_patterns", ""),
            }
            record.consistency_score = result.get("consistency_score", 0)
            record.posts_trained_on = len(posts)
            record.status = "generated"
            log.info("Voice '%s' generated from %d posts", name, len(posts))
        except Exception:
            log.exception("Voice generation failed for '%s'", name)
            record.status = "error"
        db.commit()
    finally:
        db.close()


@router.post("/voices", status_code=201)
def create_voice(
    payload: CreateVoiceRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
) -> dict:
    cutoff = _training_cutoff(payload.training_period)
    posts, org_name, account_handles = _collect_training_data(
        payload.source_account_ids, cutoff, db,
    )

    record = VoiceRecord(
        name=payload.name,
        purpose=payload.purpose,
        source_account_ids=payload.source_account_ids,
        training_period=payload.training_period,
        posts_trained_on=len(posts),
        status="generating" if posts else "generated",
    )
    db.add(record)
    db.commit()
    db.refresh(record)

    if posts:
        background_tasks.add_task(
            _generate_voice_background,
            record.id, posts, payload.name, payload.purpose,
            org_name, account_handles,
        )

    background_tasks.add_task(_index_voice, record.id)
    return _row_to_dict(record)


@router.get("/voices/{voice_id}")
def get_voice(voice_id: str, db: Session = Depends(get_db)) -> dict:
    record = db.get(VoiceRecord, voice_id)
    if not record:
        raise HTTPException(status_code=404, detail="Voice not found")
    return _row_to_dict(record)


@router.put("/voices/{voice_id}")
def update_voice(
    voice_id: str, payload: dict,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
) -> dict:
    record = db.get(VoiceRecord, voice_id)
    if not record:
        raise HTTPException(status_code=404, detail="Voice not found")
    _snapshot_version(db, "voice", record)
    for key, value in payload.items():
        if hasattr(record, key) and key != "id":
            setattr(record, key, value)
    db.commit()
    db.refresh(record)
    background_tasks.add_task(_index_voice, voice_id)
    return _row_to_dict(record)


@router.delete("/voices/{voice_id}", status_code=204)
def delete_voice(voice_id: str, db: Session = Depends(get_db)) -> None:
    record = db.get(VoiceRecord, voice_id)
    if not record:
        raise HTTPException(status_code=404, detail="Voice not found")
    db.delete(record)
    db.commit()


# ---------------------------------------------------------------------------
# Personas
# ---------------------------------------------------------------------------


@router.get("/personas")
def list_personas(db: Session = Depends(get_db)) -> list[dict]:
    rows = db.execute(select(PersonaRecord)).scalars().all()
    return [_row_to_dict(r) for r in rows]


class CreatePersonaRequest(BaseModel):
    name: str
    persona_type: str = "audience"
    description: str | None = None
    writing_approach: str | None = None
    tone: dict = Field(default_factory=dict)
    structure_preference: str | None = None
    platform_behavior: dict = Field(default_factory=dict)
    tags_positive: list = Field(default_factory=list)
    tags_negative: list = Field(default_factory=list)
    enabled_tools: list = Field(default_factory=list)
    per_platform_config: dict = Field(default_factory=dict)
    demographics: dict = Field(default_factory=dict)
    interests: list = Field(default_factory=list)
    content_preferences: dict = Field(default_factory=dict)
    goals_and_triggers: dict = Field(default_factory=dict)
    source_account_ids: list = Field(default_factory=list)
    status: str = "active"


@router.post("/personas", status_code=201)
def create_persona(
    payload: CreatePersonaRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
) -> dict:
    record = PersonaRecord(**payload.model_dump())
    db.add(record)
    db.commit()
    db.refresh(record)
    background_tasks.add_task(_index_persona, record.id)
    return _row_to_dict(record)


@router.get("/personas/{persona_id}")
def get_persona(persona_id: str, db: Session = Depends(get_db)) -> dict:
    record = db.get(PersonaRecord, persona_id)
    if not record:
        raise HTTPException(status_code=404, detail="Persona not found")
    return _row_to_dict(record)


@router.put("/personas/{persona_id}")
def update_persona(
    persona_id: str, payload: dict,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
) -> dict:
    record = db.get(PersonaRecord, persona_id)
    if not record:
        raise HTTPException(status_code=404, detail="Persona not found")
    _snapshot_version(db, "persona", record)
    for key, value in payload.items():
        if hasattr(record, key) and key != "id":
            setattr(record, key, value)
    db.commit()
    db.refresh(record)
    background_tasks.add_task(_index_persona, persona_id)
    return _row_to_dict(record)


@router.delete("/personas/{persona_id}", status_code=204)
def delete_persona(persona_id: str, db: Session = Depends(get_db)) -> None:
    record = db.get(PersonaRecord, persona_id)
    if not record:
        raise HTTPException(status_code=404, detail="Persona not found")
    db.delete(record)
    db.commit()


class DiscoverPersonasRequest(BaseModel):
    account_ids: list[str]


@router.post("/personas/discover")
def discover_personas(
    payload: DiscoverPersonasRequest,
    db: Session = Depends(get_db),
) -> list[dict]:
    """Use AI to discover audience personas from connected social accounts."""
    accounts = []
    for aid in payload.account_ids:
        record = db.get(AccountRecord, aid)
        if not record:
            raise HTTPException(404, f"Account {aid} not found")
        accounts.append(record)

    posts_by_account: list[dict] = []
    for acct in accounts:
        posts_by_account.append({
            "platform": acct.platform,
            "handle": acct.handle,
            "posts": (acct.imported_posts or [])[:30],
            "follower_data": acct.follower_data or {},
            "profile": acct.profile_data or {},
        })

    from app.services.llm import discover_audience_personas
    suggestions = discover_audience_personas(posts_by_account)
    return suggestions


# ---------------------------------------------------------------------------
# Rule Sets
# ---------------------------------------------------------------------------


@router.get("/rule-sets")
def list_rule_sets(db: Session = Depends(get_db)) -> list[dict]:
    rows = db.execute(select(RuleSetRecord)).scalars().all()
    return [_row_to_dict(r) for r in rows]


@router.post("/rule-sets", status_code=201)
def create_rule_set(
    payload: dict,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
) -> dict:
    record = RuleSetRecord(**payload)
    db.add(record)
    db.commit()
    db.refresh(record)
    background_tasks.add_task(_index_rule_set, record.id)
    return _row_to_dict(record)


@router.get("/rule-sets/{rule_set_id}")
def get_rule_set(rule_set_id: str, db: Session = Depends(get_db)) -> dict:
    record = db.get(RuleSetRecord, rule_set_id)
    if not record:
        raise HTTPException(status_code=404, detail="Rule set not found")
    return _row_to_dict(record)


@router.put("/rule-sets/{rule_set_id}")
def update_rule_set(
    rule_set_id: str, payload: dict,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
) -> dict:
    record = db.get(RuleSetRecord, rule_set_id)
    if not record:
        raise HTTPException(status_code=404, detail="Rule set not found")
    _snapshot_version(db, "rule_set", record)
    for key, value in payload.items():
        if hasattr(record, key) and key != "id":
            setattr(record, key, value)
    db.commit()
    db.refresh(record)
    background_tasks.add_task(_index_rule_set, rule_set_id)
    return _row_to_dict(record)


@router.delete("/rule-sets/{rule_set_id}", status_code=204)
def delete_rule_set(rule_set_id: str, db: Session = Depends(get_db)) -> None:
    record = db.get(RuleSetRecord, rule_set_id)
    if not record:
        raise HTTPException(status_code=404, detail="Rule set not found")
    db.delete(record)
    db.commit()


@router.post("/rule-sets/seed", status_code=201)
def seed_rule_sets(
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
) -> list[dict]:
    """Seed the system with demo rule sets for demonstration."""
    _DEMO_RULE_SETS = [
        {
            "name": "Brand Safety & Compliance",
            "description": "Ensures all content is brand-safe, legally compliant, and avoids sensitive topics.",
            "rules": [
                {"name": "No competitor mentions", "type": "compliance", "enforcement": "required",
                 "description": "Never mention competitor brands by name. Use generic terms like 'other solutions' or 'alternatives'."},
                {"name": "No unverified claims", "type": "compliance", "enforcement": "required",
                 "description": "All statistics, metrics, and performance claims must be verifiable. Avoid superlatives like 'best', 'fastest', 'only' unless backed by data."},
                {"name": "Inclusive language", "type": "tone", "enforcement": "required",
                 "description": "Use gender-neutral, culturally sensitive language. Avoid jargon that excludes non-technical audiences."},
                {"name": "No financial advice", "type": "compliance", "enforcement": "required",
                 "description": "Do not make statements that could be construed as financial, legal, or medical advice."},
                {"name": "Disclosure on AI content", "type": "compliance", "enforcement": "suggested",
                 "description": "When discussing AI-generated outputs, include a note that content was AI-assisted where platform norms expect it."},
            ],
        },
        {
            "name": "Platform Character & Format Limits",
            "description": "Enforces platform-specific character limits, hashtag norms, and structural requirements.",
            "rules": [
                {"name": "X/Twitter: 280 chars", "type": "format", "enforcement": "required",
                 "description": "Posts for X must not exceed 280 characters including hashtags and URLs."},
                {"name": "LinkedIn: 3000 chars max", "type": "format", "enforcement": "required",
                 "description": "LinkedIn posts should not exceed 3000 characters. Ideal range is 1200-1800 for engagement."},
                {"name": "Instagram: 2200 chars", "type": "format", "enforcement": "required",
                 "description": "Instagram captions must not exceed 2200 characters. First 125 chars appear above the fold."},
                {"name": "Facebook: 63206 chars", "type": "format", "enforcement": "required",
                 "description": "Facebook posts must not exceed 63,206 characters."},
                {"name": "Hashtag limits", "type": "format", "enforcement": "suggested",
                 "description": "X: 2-3 hashtags max. LinkedIn: 3-5. Instagram: 5-15. Facebook: 1-3. Always place hashtags at end."},
                {"name": "Hook in first line", "type": "format", "enforcement": "suggested",
                 "description": "Every post must start with a compelling hook in the first sentence or line break."},
            ],
        },
        {
            "name": "Engagement & CTA Rules",
            "description": "Rules for maximizing engagement through proven content patterns.",
            "rules": [
                {"name": "Always include CTA", "type": "engagement", "enforcement": "suggested",
                 "description": "Every post should end with a clear call-to-action: question, link, invitation to comment, or share prompt."},
                {"name": "Question-based hooks", "type": "engagement", "enforcement": "suggested",
                 "description": "Prefer opening with a provocative question or contrarian take over generic statements."},
                {"name": "Value-first structure", "type": "engagement", "enforcement": "suggested",
                 "description": "Lead with actionable insight or data point. Save the pitch for the final third of the post."},
                {"name": "Personal story angle", "type": "engagement", "enforcement": "suggested",
                 "description": "Where appropriate, frame content through a personal anecdote or 'I learned...' structure."},
                {"name": "Thread-ready format", "type": "engagement", "enforcement": "suggested",
                 "description": "For X, structure longer content as thread-ready: each sentence should stand alone with a clear point."},
            ],
        },
        {
            "name": "Tone & Voice Guardrails",
            "description": "Constraints on writing style to maintain consistent brand voice across platforms.",
            "rules": [
                {"name": "Active voice preferred", "type": "tone", "enforcement": "suggested",
                 "description": "Use active voice over passive. 'We built X' not 'X was built by us'."},
                {"name": "No corporate jargon", "type": "tone", "enforcement": "suggested",
                 "description": "Avoid buzzwords: synergy, leverage, paradigm shift, circle back, move the needle. Use plain language."},
                {"name": "Conversational formality", "type": "tone", "enforcement": "suggested",
                 "description": "LinkedIn: professional but approachable. X: casual and punchy. Instagram: warm and visual. Facebook: conversational and community-oriented."},
                {"name": "No excessive emojis", "type": "tone", "enforcement": "suggested",
                 "description": "LinkedIn: 0-2 emojis. X: 0-1. Instagram: 3-5 maximum. Facebook: 1-3. Never use emojis in the middle of sentences."},
                {"name": "Sentence length", "type": "tone", "enforcement": "suggested",
                 "description": "Keep sentences under 20 words on X. LinkedIn and Facebook allow up to 30 words per sentence."},
            ],
        },
    ]

    created = []
    for rs_data in _DEMO_RULE_SETS:
        existing = db.execute(
            select(RuleSetRecord).where(
                RuleSetRecord.name == rs_data["name"]
            )
        ).scalar_one_or_none()
        if existing:
            created.append(_row_to_dict(existing))
            continue
        record = RuleSetRecord(**rs_data)
        db.add(record)
        db.flush()
        background_tasks.add_task(_index_rule_set, record.id)
        created.append(_row_to_dict(record))
    db.commit()
    return created


# ---------------------------------------------------------------------------
# Analytics
# ---------------------------------------------------------------------------


@router.get("/analytics/summary")
def analytics_summary(db: Session = Depends(get_db)) -> dict:
    run_count = select(func.count()).select_from(RunRecord)
    total_runs = db.scalar(run_count) or 0

    acct_count = select(func.count()).select_from(AccountRecord)
    total_accounts = db.scalar(acct_count) or 0

    voice_count = select(func.count()).select_from(VoiceRecord)
    total_voices = db.scalar(voice_count) or 0

    post_sum = select(
        func.coalesce(func.sum(AccountRecord.post_count), 0)
    )
    total_posts = db.scalar(post_sum) or 0

    return {
        "total_runs": total_runs,
        "total_accounts": total_accounts,
        "total_voices": total_voices,
        "posts_per_month": total_posts,
        "engagement_index": 1.0 if total_runs > 0 else 0.0,
        "time_to_platform_min": 4.8,
    }


# ---------------------------------------------------------------------------
# Version History
# ---------------------------------------------------------------------------

ENTITY_TYPE_MAP = {
    "voices": "voice",
    "personas": "persona",
    "rule-sets": "rule_set",
}


@router.get("/versions/{entity_type}/{entity_id}")
def list_versions(
    entity_type: str, entity_id: str, db: Session = Depends(get_db)
) -> list[dict]:
    """Return all saved versions for an entity, newest first."""
    mapped = ENTITY_TYPE_MAP.get(entity_type, entity_type)
    rows = (
        db.query(RecordVersion)
        .filter_by(entity_type=mapped, entity_id=entity_id)
        .order_by(RecordVersion.version.desc())
        .all()
    )
    return [
        {
            "id": r.id,
            "version": r.version,
            "snapshot": r.snapshot,
            "created_at": r.created_at.isoformat() if r.created_at else None,
        }
        for r in rows
    ]


@router.post("/versions/{entity_type}/{entity_id}/{version}/restore")
def restore_version(
    entity_type: str,
    entity_id: str,
    version: int,
    db: Session = Depends(get_db),
) -> dict:
    """Restore an entity to a previous version (saves current as new version first)."""
    mapped = ENTITY_TYPE_MAP.get(entity_type, entity_type)
    ver = (
        db.query(RecordVersion)
        .filter_by(entity_type=mapped, entity_id=entity_id, version=version)
        .first()
    )
    if not ver:
        raise HTTPException(404, "Version not found")

    model_map = {"voice": VoiceRecord, "persona": PersonaRecord, "rule_set": RuleSetRecord}
    model = model_map.get(mapped)
    if not model:
        raise HTTPException(400, "Unknown entity type")

    record = db.get(model, entity_id)
    if not record:
        raise HTTPException(404, "Entity not found")

    _snapshot_version(db, mapped, record)

    for key, value in ver.snapshot.items():
        if hasattr(record, key) and key not in ("id", "created_at", "api_token"):
            setattr(record, key, value)

    db.commit()
    db.refresh(record)
    return _row_to_dict(record)
