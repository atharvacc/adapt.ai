"""
Content generation service. Routes through Claude for real generation,
with a local fallback when ANTHROPIC_API_KEY is not set.
"""
from __future__ import annotations

import logging
import uuid

from app.schemas.run import Platform, PlatformOutput, Variant

log = logging.getLogger(__name__)

STYLE_GUIDE: dict[Platform, str] = {
    "linkedin": "Professional, insight-led, 3-5 hashtags, no emojis.",
    "x": "Punchy, concise, first-line hook, 1-2 hashtags.",
    "instagram": "Visual, story-driven, CTA at end, 15-25 hashtags.",
    "tiktok": "Spoken-word, high-energy hook, short lines, 5-10 hashtags.",
}


def _has_anthropic_key() -> bool:
    try:
        from app.db.session import SessionLocal
        from app.core.config_store import get_config
        db = SessionLocal()
        try:
            return bool(get_config(db, "anthropic_api_key"))
        finally:
            db.close()
    except Exception:
        from app.core.settings import settings
        return bool(settings.anthropic_api_key)


def generate_platform_output(source_content: str, platform: Platform) -> PlatformOutput:
    if _has_anthropic_key():
        return _generate_with_claude(source_content, platform)
    return _generate_fallback(source_content, platform)


def regenerate_variant_text(
    source_content: str,
    platform: Platform,
    label: str,
    context: str | None,
    current_text: str | None = None,
) -> tuple[str, str]:
    if _has_anthropic_key():
        return _regenerate_with_claude(source_content, platform, label, context, current_text)
    return _regenerate_fallback(source_content, platform, label, context)


# ---------------------------------------------------------------------------
# Claude-powered generation
# ---------------------------------------------------------------------------

def _generate_with_claude(source_content: str, platform: Platform) -> PlatformOutput:
    from app.services.llm import generate_variants_for_platform

    try:
        raw_variants = generate_variants_for_platform(source_content, platform)
        variants = [
            Variant(
                id=str(uuid.uuid4()),
                label=v["label"],
                text=v["text"],
                rationale=v["rationale"],
            )
            for v in raw_variants
        ]
        return PlatformOutput(platform=platform, variants=variants)
    except Exception:
        log.exception("Claude generation failed for %s, falling back", platform)
        return _generate_fallback(source_content, platform)


def _regenerate_with_claude(
    source_content: str,
    platform: Platform,
    label: str,
    context: str | None,
    current_text: str | None = None,
) -> tuple[str, str]:
    from app.services.llm import regenerate_single_variant

    try:
        result = regenerate_single_variant(
            source_content, platform, label, context, current_text
        )
        return result["text"], result["rationale"]
    except Exception:
        log.exception("Claude regen failed, falling back")
        return _regenerate_fallback(source_content, platform, label, context)


# ---------------------------------------------------------------------------
# Local fallback (no API key needed)
# ---------------------------------------------------------------------------

def _generate_fallback(source_content: str, platform: Platform) -> PlatformOutput:
    style = STYLE_GUIDE[platform]
    variants = [
        Variant(
            id=str(uuid.uuid4()),
            label="A",
            text=f"[{platform.upper()} A] {source_content[:220]}",
            rationale=f"Optimized for {platform}: hook-first framing with style `{style}`",
        ),
        Variant(
            id=str(uuid.uuid4()),
            label="B",
            text=f"[{platform.upper()} B] {source_content[:180]}",
            rationale=f"Alternative narrative structure for {platform} using the same core message.",
        ),
        Variant(
            id=str(uuid.uuid4()),
            label="C",
            text=f"[{platform.upper()} C] {source_content[:200]}",
            rationale=f"Question-led variant to test engagement on {platform}.",
        ),
    ]
    return PlatformOutput(platform=platform, variants=variants)


def _regenerate_fallback(
    source_content: str, platform: Platform, label: str, context: str | None
) -> tuple[str, str]:
    suffix = f" | context: {context}" if context else ""
    text = f"[{platform.upper()} {label}] Reframed: {source_content[:210]}{suffix}"
    rationale = f"Regenerated for {platform} to preserve core message while adjusting tone and pacing."
    return text, rationale
