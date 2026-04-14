"""
OAuth 2.0 flows for each social platform.

Flow:
  1. GET /v1/oauth/{platform}/authorize → returns { url } (the platform consent page)
  2. User is redirected to the platform, approves access
  3. Platform redirects to GET /v1/oauth/{platform}/callback?code=...&state=...
  4. Backend exchanges code → access token, fetches profile + posts, creates account
  5. Callback redirects the browser to frontend /accounts?connected={platform}

Credentials are read from the DB config table first, falling back to env vars.
"""
from __future__ import annotations

import base64
import hashlib
import logging
import secrets
from datetime import datetime, timezone
from urllib.parse import urlencode

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import RedirectResponse
from sqlalchemy.orm import Session

from app.core.config_store import get_config
from app.core.settings import settings
from app.db.models import AccountRecord
from app.db.session import get_db
from app.services.platforms import fetch_platform_data

log = logging.getLogger(__name__)
router = APIRouter(prefix="/v1/oauth", tags=["oauth"])

_oauth_state: dict[str, dict] = {}


def _callback_url(platform: str) -> str:
    return f"{settings.backend_url}/v1/oauth/{platform}/callback"


def _cfg(db: Session, key: str) -> str:
    return get_config(db, key)


# ───────────────────────────────────────────────────────────────────────────
#  Readiness check
# ───────────────────────────────────────────────────────────────────────────

@router.get("/platforms")
def available_platforms(db: Session = Depends(get_db)) -> dict:
    return {
        "x": bool(_cfg(db, "x_client_id")),
        "linkedin": bool(_cfg(db, "linkedin_client_id")),
        "instagram": bool(_cfg(db, "facebook_app_id")),
        "facebook": bool(_cfg(db, "facebook_app_id")),
    }


# ═══════════════════════════════════════════════════════════════════════════
#  X / Twitter
# ═══════════════════════════════════════════════════════════════════════════

@router.get("/x/authorize")
def x_authorize(db: Session = Depends(get_db)):
    client_id = _cfg(db, "x_client_id")
    if not client_id:
        raise HTTPException(400, "X_CLIENT_ID not configured — add it in Settings")

    state = secrets.token_urlsafe(32)
    verifier = secrets.token_urlsafe(64)
    challenge = hashlib.sha256(verifier.encode()).digest()
    challenge_b64 = base64.urlsafe_b64encode(challenge).rstrip(b"=").decode()

    _oauth_state[state] = {"verifier": verifier, "platform": "x", "client_id": client_id}

    params = {
        "response_type": "code",
        "client_id": client_id,
        "redirect_uri": _callback_url("x"),
        "scope": "tweet.read users.read offline.access",
        "state": state,
        "code_challenge": challenge_b64,
        "code_challenge_method": "S256",
    }
    return {"url": f"https://twitter.com/i/oauth2/authorize?{urlencode(params)}"}


@router.get("/x/callback")
async def x_callback(
    code: str = Query(...),
    state: str = Query(...),
    db: Session = Depends(get_db),
):
    stored = _oauth_state.pop(state, None)
    if not stored:
        raise HTTPException(400, "Invalid or expired state")

    client_id = stored["client_id"]
    client_secret = _cfg(db, "x_client_secret")

    async with httpx.AsyncClient(timeout=15) as client:
        token_resp = await client.post(
            "https://api.twitter.com/2/oauth2/token",
            data={
                "grant_type": "authorization_code",
                "code": code,
                "redirect_uri": _callback_url("x"),
                "client_id": client_id,
                "code_verifier": stored["verifier"],
            },
            auth=(client_id, client_secret) if client_secret else None,
        )
        token_resp.raise_for_status()
        tokens = token_resp.json()

    return await _finish_oauth("x", tokens["access_token"], db)


# ═══════════════════════════════════════════════════════════════════════════
#  LinkedIn
# ═══════════════════════════════════════════════════════════════════════════

@router.get("/linkedin/authorize")
def linkedin_authorize(db: Session = Depends(get_db)):
    client_id = _cfg(db, "linkedin_client_id")
    if not client_id:
        raise HTTPException(400, "LINKEDIN_CLIENT_ID not configured — add it in Settings")

    state = secrets.token_urlsafe(32)
    _oauth_state[state] = {"platform": "linkedin", "client_id": client_id}

    params = {
        "response_type": "code",
        "client_id": client_id,
        "redirect_uri": _callback_url("linkedin"),
        "scope": "openid profile email w_member_social",
        "state": state,
    }
    return {"url": f"https://www.linkedin.com/oauth/v2/authorization?{urlencode(params)}"}


@router.get("/linkedin/callback")
async def linkedin_callback(
    code: str = Query(...),
    state: str = Query(...),
    db: Session = Depends(get_db),
):
    stored = _oauth_state.pop(state, None)
    if not stored:
        raise HTTPException(400, "Invalid or expired state")

    client_id = stored["client_id"]
    client_secret = _cfg(db, "linkedin_client_secret")

    async with httpx.AsyncClient(timeout=15) as client:
        token_resp = await client.post(
            "https://www.linkedin.com/oauth/v2/accessToken",
            data={
                "grant_type": "authorization_code",
                "code": code,
                "redirect_uri": _callback_url("linkedin"),
                "client_id": client_id,
                "client_secret": client_secret,
            },
        )
        token_resp.raise_for_status()
        tokens = token_resp.json()

    return await _finish_oauth("linkedin", tokens["access_token"], db)


# ═══════════════════════════════════════════════════════════════════════════
#  Instagram
# ═══════════════════════════════════════════════════════════════════════════

@router.get("/instagram/authorize")
def instagram_authorize(db: Session = Depends(get_db)):
    app_id = _cfg(db, "facebook_app_id")
    if not app_id:
        raise HTTPException(400, "FACEBOOK_APP_ID not configured — add it in Settings")

    state = secrets.token_urlsafe(32)
    _oauth_state[state] = {"platform": "instagram", "app_id": app_id}

    params = {
        "client_id": app_id,
        "redirect_uri": _callback_url("instagram"),
        "scope": "instagram_basic,instagram_content_publish,instagram_manage_insights,pages_show_list",
        "response_type": "code",
        "state": state,
    }
    return {"url": f"https://www.facebook.com/v21.0/dialog/oauth?{urlencode(params)}"}


@router.get("/instagram/callback")
async def instagram_callback(
    code: str = Query(...),
    state: str = Query(...),
    db: Session = Depends(get_db),
):
    stored = _oauth_state.pop(state, None)
    if not stored:
        raise HTTPException(400, "Invalid or expired state")

    app_id = stored["app_id"]
    app_secret = _cfg(db, "facebook_app_secret")

    async with httpx.AsyncClient(timeout=15) as client:
        token_resp = await client.get(
            "https://graph.facebook.com/v21.0/oauth/access_token",
            params={
                "client_id": app_id,
                "client_secret": app_secret,
                "redirect_uri": _callback_url("instagram"),
                "code": code,
            },
        )
        token_resp.raise_for_status()
        tokens = token_resp.json()

    return await _finish_oauth("instagram", tokens["access_token"], db)


# ═══════════════════════════════════════════════════════════════════════════
#  Facebook
# ═══════════════════════════════════════════════════════════════════════════

@router.get("/facebook/authorize")
def facebook_authorize(db: Session = Depends(get_db)):
    app_id = _cfg(db, "facebook_app_id")
    if not app_id:
        raise HTTPException(400, "FACEBOOK_APP_ID not configured — add it in Settings")

    state = secrets.token_urlsafe(32)
    _oauth_state[state] = {"platform": "facebook", "app_id": app_id}

    params = {
        "client_id": app_id,
        "redirect_uri": _callback_url("facebook"),
        "scope": "pages_show_list,pages_read_engagement,pages_manage_posts",
        "response_type": "code",
        "state": state,
    }
    return {"url": f"https://www.facebook.com/v19.0/dialog/oauth?{urlencode(params)}"}


@router.get("/facebook/callback")
async def facebook_callback(
    code: str = Query(...),
    state: str = Query(...),
    db: Session = Depends(get_db),
):
    stored = _oauth_state.pop(state, None)
    if not stored:
        raise HTTPException(400, "Invalid or expired state")

    app_id = stored["app_id"]
    app_secret = _cfg(db, "facebook_app_secret")

    async with httpx.AsyncClient(timeout=15) as client:
        token_resp = await client.get(
            "https://graph.facebook.com/v19.0/oauth/access_token",
            params={
                "client_id": app_id,
                "client_secret": app_secret,
                "redirect_uri": _callback_url("facebook"),
                "code": code,
            },
        )
        token_resp.raise_for_status()
        tokens = token_resp.json()

    return await _finish_oauth("facebook", tokens.get("access_token", ""), db)


# ───────────────────────────────────────────────────────────────────────────
#  Shared: finish OAuth, fetch data, create account, redirect to frontend
# ───────────────────────────────────────────────────────────────────────────

async def _finish_oauth(platform: str, access_token: str, db: Session) -> RedirectResponse:
    record = AccountRecord(
        platform=platform,
        handle="(resolving…)",
        api_token=access_token,
        status="syncing",
    )
    db.add(record)
    db.commit()
    db.refresh(record)

    try:
        data = await fetch_platform_data(platform, access_token, "")
        profile = data.get("profile", {})
        record.handle = profile.get("handle") or profile.get("name") or f"@{platform}_user"
        record.profile_data = profile
        record.imported_posts = data.get("posts", [])
        record.post_count = len(data.get("posts", []))
        record.data_health_percent = data.get("data_health_percent", 0)
        record.status = "connected"
        record.last_sync_at = datetime.now(timezone.utc)

        anthropic_key = get_config(db, "anthropic_api_key")
        if anthropic_key and record.imported_posts:
            try:
                from app.services.llm import analyze_account_posts
                inferences = analyze_account_posts(record.imported_posts, platform)
                record.inferences = inferences
            except Exception:
                log.warning("Post analysis failed during OAuth connect")
                record.inferences = {}

        db.commit()
    except Exception as exc:
        log.exception("OAuth data fetch failed for %s", platform)
        record.status = "error"
        record.profile_data = {"error": str(exc)}
        record.handle = f"@{platform}_user"
        db.commit()

    return RedirectResponse(
        url=f"{settings.frontend_url}/accounts?connected={platform}&account_id={record.id}",
        status_code=302,
    )
