"""
Video generation service using xAI Grok Imagine Video.
Async polling: submit → poll until done → download and store.
"""
from __future__ import annotations

import logging
import os
import time

import httpx

try:
    from langsmith import traceable
except ImportError:
    def traceable(**_kw):  # type: ignore[misc]
        def _id(fn):       # noqa: E301
            return fn
        return _id

log = logging.getLogger(__name__)

XAI_BASE = "https://api.x.ai/v1"

PLATFORM_VIDEO_SPECS: dict[str, dict] = {
    "linkedin": {
        "duration": 8,
        "aspect_ratio": "16:9",
        "resolution": "720p",
    },
    "x": {
        "duration": 8,
        "aspect_ratio": "16:9",
        "resolution": "720p",
    },
    "instagram": {
        "duration": 10,
        "aspect_ratio": "9:16",
        "resolution": "720p",
    },
    "tiktok": {
        "duration": 10,
        "aspect_ratio": "9:16",
        "resolution": "720p",
    },
}

MAX_POLL_SECONDS = 300
POLL_INTERVAL = 5


def _get_xai_key() -> str:
    try:
        from app.db.session import SessionLocal
        from app.core.config_store import get_config
        db = SessionLocal()
        try:
            return get_config(db, "xai_api_key")
        finally:
            db.close()
    except Exception:
        return os.getenv("XAI_API_KEY", "")


@traceable(
    run_type="tool",
    name="Grok Imagine Video",
    tags=["video_generation"],
)
def generate_video(
    prompt: str,
    platform: str,
    run_meta: dict | None = None,
) -> dict | None:
    """Generate a video via Grok Imagine Video.

    Returns dict with keys: url, duration, resolution
    or None on failure / missing key.
    """
    api_key = _get_xai_key()
    if not api_key:
        log.info("No XAI key — skipping video generation")
        return None

    spec = PLATFORM_VIDEO_SPECS.get(
        platform,
        {"duration": 8, "aspect_ratio": "16:9", "resolution": "720p"},
    )
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }

    try:
        with httpx.Client(timeout=30) as client:
            resp = client.post(
                f"{XAI_BASE}/videos/generations",
                headers=headers,
                json={
                    "model": "grok-imagine-video",
                    "prompt": prompt[:4000],
                    "duration": spec["duration"],
                    "aspect_ratio": spec["aspect_ratio"],
                    "resolution": spec["resolution"],
                },
            )
            resp.raise_for_status()
            request_id = resp.json().get("request_id")
            if not request_id:
                log.error("No request_id in xAI response")
                return None

        result = _poll_for_result(request_id, headers)
        if not result:
            return None

        video_url = result.get("video", {}).get("url")
        if not video_url:
            return None

        stored_url = _download_and_store(video_url)
        return {
            "url": stored_url,
            "duration": result.get("video", {}).get(
                "duration", spec["duration"],
            ),
            "resolution": spec["resolution"],
            "aspect_ratio": spec["aspect_ratio"],
        }
    except Exception:
        log.exception("Grok video generation failed")
        return None


def _poll_for_result(
    request_id: str,
    headers: dict,
) -> dict | None:
    """Poll xAI until video is done or timeout."""
    deadline = time.time() + MAX_POLL_SECONDS
    with httpx.Client(timeout=30) as client:
        while time.time() < deadline:
            time.sleep(POLL_INTERVAL)
            try:
                resp = client.get(
                    f"{XAI_BASE}/videos/{request_id}",
                    headers=headers,
                )
                resp.raise_for_status()
                data = resp.json()
                status = data.get("status", "")
                progress = data.get("progress", 0)
                log.info(
                    "Video %s: status=%s progress=%d%%",
                    request_id[:8], status, progress,
                )
                if status == "done":
                    return data
                if status == "failed":
                    err = data.get("error", {})
                    log.error("Video generation failed: %s", err)
                    return None
            except Exception:
                log.warning("Poll error for %s, retrying", request_id[:8])
    log.error("Video generation timed out after %ds", MAX_POLL_SECONDS)
    return None


def _download_and_store(url: str) -> str:
    """Download generated video and store it."""
    try:
        from app.services.storage import upload_video
        resp = httpx.get(url, timeout=60)
        resp.raise_for_status()
        return upload_video(resp.content, "generated.mp4")
    except ImportError:
        return _download_local(url)
    except Exception:
        log.warning("Failed to store video, returning xAI URL")
        return url


def _download_local(url: str) -> str:
    """Fallback: save video to local uploads directory."""
    import uuid
    upload_dir = os.path.join(
        os.path.dirname(__file__), "..", "..", "uploads",
    )
    os.makedirs(upload_dir, exist_ok=True)
    key = f"{uuid.uuid4().hex}.mp4"
    path = os.path.join(upload_dir, key)
    resp = httpx.get(url, timeout=60)
    resp.raise_for_status()
    with open(path, "wb") as f:
        f.write(resp.content)
    host = os.getenv("BACKEND_HOST", "http://localhost:8000")
    return f"{host}/uploads/{key}"
