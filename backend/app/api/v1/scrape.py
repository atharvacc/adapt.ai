"""
API router for browser-based profile scraping.

POST /v1/accounts/scrape   — kick off scrape (returns immediately with status=syncing)
POST /v1/accounts/{id}/rescrape — re-scrape using the stored URL
"""
from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.db.models import AccountRecord
from app.db.session import get_db, SessionLocal

log = logging.getLogger(__name__)

router = APIRouter(prefix="/v1", tags=["scrape"])


class ScrapeRequest(BaseModel):
    url: str


def _safe_dict(row: AccountRecord) -> dict:
    d = {c.key: getattr(row, c.key) for c in row.__table__.columns}
    d.pop("api_token", None)
    return d


def _run_scrape_in_background(record_id: str, url: str, platform: str) -> None:
    """Run the browser scrape + Claude analysis in a separate thread with its own event loop and DB session."""
    asyncio.run(_do_scrape(record_id, url, platform))


async def _do_scrape(record_id: str, url: str, platform: str) -> None:
    from app.services.browser_agent import scrape_profile

    db = SessionLocal()
    try:
        record = db.get(AccountRecord, record_id)
        if not record:
            log.error("Account %s vanished before scrape started", record_id)
            return

        data = await scrape_profile(url)

        profile = data.get("profile", {})
        profile["source_url"] = url
        posts = data.get("posts", [])

        record.profile_data = profile
        record.imported_posts = posts
        record.post_count = len(posts)
        record.data_health_percent = data.get("data_health_percent", 0)
        record.status = "connected"
        record.last_sync_at = datetime.now(timezone.utc)

        if posts:
            try:
                from app.services.llm import analyze_account_posts
                record.inferences = analyze_account_posts(posts, platform)
            except Exception:
                log.warning("Post analysis failed after scrape, skipping inferences")
                record.inferences = {}

        db.commit()
        log.info("Scrape completed for %s — %d posts, %d%% health",
                 url, len(posts), data.get("data_health_percent", 0))

        try:
            from app.services.embeddings import embed_and_store
            chunks = [p.get("text", p.get("content", "")) for p in posts if isinstance(p, dict)]
            chunks = [c for c in chunks if c]
            if chunks:
                embed_and_store(db, "post", record_id, chunks, {"platform": platform})
        except Exception:
            log.warning("Post auto-indexing failed for %s", record_id)

    except Exception as exc:
        log.exception("Browser scrape failed for %s", url)
        try:
            record = db.get(AccountRecord, record_id)
            if record:
                record.status = "error"
                record.profile_data = {
                    **(record.profile_data or {}),
                    "error": str(exc),
                }
                db.commit()
        except Exception:
            pass
    finally:
        db.close()


@router.post("/accounts/scrape", status_code=201)
def scrape_account(
    payload: ScrapeRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
) -> dict:
    """
    Accept a public profile URL, create an account record immediately (status=syncing),
    and kick off the browser scrape as a background task.
    """
    from app.services.browser_agent import detect_platform

    url = payload.url.strip()
    if not url:
        raise HTTPException(400, "URL is required")

    try:
        platform, handle = detect_platform(url)
    except ValueError as exc:
        raise HTTPException(400, str(exc))

    record = AccountRecord(
        platform=platform,
        handle=handle,
        status="syncing",
        profile_data={"source_url": url},
    )
    db.add(record)
    db.commit()
    db.refresh(record)

    background_tasks.add_task(_run_scrape_in_background, record.id, url, platform)

    return _safe_dict(record)


@router.post("/accounts/{account_id}/scrape-followers")
def scrape_followers_endpoint(
    account_id: str,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
) -> dict:
    """Kick off follower scraping for an existing account."""
    record = db.get(AccountRecord, account_id)
    if not record:
        raise HTTPException(404, "Account not found")

    source_url = (record.profile_data or {}).get("source_url")
    if not source_url:
        raise HTTPException(400, "No source URL stored for this account.")

    follower_data = record.follower_data or {}
    follower_data["status"] = "scraping"
    record.follower_data = follower_data
    db.commit()
    db.refresh(record)

    background_tasks.add_task(
        _run_follower_scrape_in_background, record.id, source_url,
    )

    return _safe_dict(record)


def _run_follower_scrape_in_background(record_id: str, url: str) -> None:
    asyncio.run(_do_follower_scrape(record_id, url))


async def _do_follower_scrape(record_id: str, url: str) -> None:
    from app.services.browser_agent import scrape_followers

    db = SessionLocal()
    try:
        record = db.get(AccountRecord, record_id)
        if not record:
            log.error("Account %s vanished before follower scrape", record_id)
            return

        data = await scrape_followers(url, limit=20)

        record.follower_data = {
            "followers": data.get("followers", []),
            "top_commenters": data.get("top_commenters", []),
            "scraped_at": data.get("scraped_at"),
            "status": "done",
        }
        db.commit()
        log.info(
            "Follower scrape done for %s — %d followers",
            url, len(data.get("followers", [])),
        )

    except Exception as exc:
        log.exception("Follower scrape failed for %s", url)
        try:
            record = db.get(AccountRecord, record_id)
            if record:
                record.follower_data = {
                    **(record.follower_data or {}),
                    "status": "error",
                    "error": str(exc),
                }
                db.commit()
        except Exception:
            pass
    finally:
        db.close()


@router.post("/accounts/{account_id}/rescrape")
def rescrape_account(
    account_id: str,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
) -> dict:
    """Re-scrape an existing account using its stored source URL."""
    record = db.get(AccountRecord, account_id)
    if not record:
        raise HTTPException(404, "Account not found")

    source_url = (record.profile_data or {}).get("source_url")
    if not source_url:
        raise HTTPException(400, "No source URL stored for this account. Use /scrape to import first.")

    record.status = "syncing"
    db.commit()
    db.refresh(record)

    background_tasks.add_task(_run_scrape_in_background, record.id, source_url, record.platform)

    return _safe_dict(record)
