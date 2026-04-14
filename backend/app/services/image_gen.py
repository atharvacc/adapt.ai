"""
Image generation service using OpenAI GPT Image 1.5.

The image *prompt* is crafted by an LLM call that receives all
available context (voice, persona, audience, research, rules,
source-image analysis).  The prompt is then sent to GPT Image.
"""
from __future__ import annotations

import base64
import io
import json
import logging
import os
from typing import Any

try:
    from langsmith import traceable
except ImportError:
    def traceable(**_kw):  # type: ignore[misc]
        def _id(fn):       # noqa: E301
            return fn
        return _id

log = logging.getLogger(__name__)

PLATFORM_IMAGE_SPECS: dict[str, dict] = {
    "linkedin": {"size": "1536x1024", "quality": "medium"},
    "x":        {"size": "1024x1024", "quality": "medium"},
    "instagram": {"size": "1024x1536", "quality": "high"},
    "facebook": {"size": "1024x1024", "quality": "high"},
}


# ── OpenAI key helper ────────────────────────────────────────────────────────

def _get_openai_key() -> str:
    try:
        from app.db.session import SessionLocal
        from app.core.config_store import get_config
        db = SessionLocal()
        try:
            return get_config(db, "openai_api_key")
        finally:
            db.close()
    except Exception:
        return os.getenv("OPENAI_API_KEY", "")


# ── LLM-based image prompt builder ───────────────────────────────────────────

def build_image_prompt_via_llm(
    variant_text: str,
    platform: str,
    voice_profile: dict[str, Any] | None = None,
    persona_profile: dict[str, Any] | None = None,
    audience_profiles: list[dict] | None = None,
    research_briefs: list[dict] | None = None,
    rule_set: dict[str, Any] | None = None,
    source_image_analysis: str = "",
    run_meta: dict | None = None,
) -> str:
    """Ask Claude to craft an image-generation prompt from full context.

    Falls back to a simple prompt if the LLM call fails.
    """
    voice_block = ""
    if voice_profile:
        name = voice_profile.get("name", "")
        attrs = json.dumps(
            voice_profile.get("attributes", {}), indent=1,
        )[:400]
        overrides = json.dumps(
            voice_profile.get("overrides", {}), indent=1,
        )[:300]
        avoid = ", ".join(
            str(a) for a in (voice_profile.get("avoid_list") or [])[:6]
        )
        voice_block = (
            f"Brand: {name}\n"
            f"Voice attributes: {attrs}\n"
            f"Voice overrides: {overrides}\n"
        )
        if avoid:
            voice_block += f"Avoid: {avoid}\n"

    persona_block = ""
    if persona_profile:
        persona_block = (
            f"Writing persona: {persona_profile.get('name', '')}\n"
            f"Approach: {persona_profile.get('writing_approach', '')}\n"
            f"Tone: {json.dumps(persona_profile.get('tone', {}))[:200]}\n"
        )

    audience_block = ""
    if audience_profiles:
        lines = []
        for a in (audience_profiles or [])[:3]:
            lines.append(
                f"- {a.get('name', 'Unknown')}: "
                f"{a.get('description', '')[:150]}"
            )
        audience_block = "Audiences:\n" + "\n".join(lines) + "\n"

    research_block = ""
    if research_briefs:
        findings: list[str] = []
        for b in research_briefs[:5]:
            summary = str(b.get("summary", ""))[:200]
            for f in (b.get("key_findings") or [])[:2]:
                if isinstance(f, dict):
                    findings.append(f.get("claim", "")[:120])
            if summary:
                findings.append(summary)
        if findings:
            research_block = (
                "Key research findings:\n- "
                + "\n- ".join(findings[:6]) + "\n"
            )

    rules_block = ""
    if rule_set:
        rules = rule_set.get("rules", [])
        if isinstance(rules, list) and rules:
            rs = [
                str(r.get("description", r) if isinstance(r, dict) else r)
                for r in rules[:5]
            ]
            rules_block = "Rules to respect:\n- " + "\n- ".join(rs) + "\n"

    image_ref_block = ""
    if source_image_analysis:
        image_ref_block = (
            f"Source image analysis:\n{source_image_analysis[:600]}\n"
            "Maintain the same subject and aesthetic feel.\n"
        )

    system = (
        "You are an expert visual creative director. "
        "Given context about a brand, a social post, and its target "
        "audience, write a single detailed image-generation prompt "
        "that will produce a platform-native visual for the post.\n\n"
        "Requirements:\n"
        "- The image must complement and reinforce the post text.\n"
        "- Reflect the brand voice and tone in the visual style.\n"
        "- Consider the audience demographics and interests.\n"
        "- Incorporate visual themes from the research findings.\n"
        "- Respect any content rules provided.\n"
        "- If source images are described, adapt their visual feel.\n"
        "- Specify composition, color palette, mood, style, "
        "subjects, and any text overlays explicitly.\n"
        "- No watermarks, no stock-photo text overlays.\n\n"
        "Respond with ONLY the image prompt text. Nothing else."
    )

    user_msg = (
        f"Platform: {platform}\n\n"
        f"Post text:\n\"{variant_text[:1000]}\"\n\n"
        f"{voice_block}{persona_block}{audience_block}"
        f"{research_block}{rules_block}{image_ref_block}"
        f"\nWrite the image-generation prompt."
    )

    try:
        from app.services.workflow_engine import _claude_call
        meta = dict(run_meta or {})
        meta["agent"] = "ImagePromptDirector"
        meta["step"] = "image_prompt_crafting"
        raw, _usage = _claude_call(
            system, user_msg, max_tokens=1024, run_meta=meta,
        )
        prompt = raw.strip()
        if len(prompt) > 20:
            return prompt
    except Exception:
        log.exception("LLM image-prompt crafting failed, using fallback")

    return (
        f"Create a visually striking image for a {platform} post. "
        f"The post says: \"{variant_text[:500]}\". "
        f"Make it platform-native, engaging, and professional."
    )


# ── Reference image helpers ──────────────────────────────────────────────────

def _normalize_reference_urls(urls: list[str]) -> list[str]:
    """Normalize source image URLs into absolute HTTP URLs."""
    refs: list[str] = []
    backend = "http://localhost:8000"
    for url in urls[:4]:
        if url.startswith("/uploads/"):
            url = f"{backend}{url}"
        if url.startswith("http"):
            refs.append(url)
    return refs


def _download_reference_image(url: str) -> tuple[io.BytesIO, str]:
    """Download reference image and return file-like bytes + mime."""
    import httpx

    resp = httpx.get(url, timeout=30)
    resp.raise_for_status()
    content_type = resp.headers.get("content-type", "image/png")
    return io.BytesIO(resp.content), content_type


# ── Image generation ─────────────────────────────────────────────────────────

@traceable(
    run_type="tool",
    name="GPT Image 1.5",
    tags=["image_generation"],
)
def generate_image(
    prompt: str,
    platform: str,
    reference_images: list[str] | None = None,
    run_meta: dict | None = None,
) -> str | None:
    """Generate an image via GPT Image 1.5.

    Returns a stored URL or None.
    """
    api_key = _get_openai_key()
    if not api_key:
        log.info("No OpenAI key — skipping image generation")
        return None

    try:
        from openai import OpenAI
        client = OpenAI(api_key=api_key)
        spec = PLATFORM_IMAGE_SPECS.get(
            platform,
            {"size": "1024x1024", "quality": "medium"},
        )

        refs = _normalize_reference_urls(reference_images or [])

        if refs:
            log.info(
                "Using source-controlled images.edit with %d reference(s)",
                len(refs),
            )
            # Source-controlled mode: always anchor output to source imagery.
            # Current SDK expects `image` file input
            # (not `images=[{image_url:...}]`).
            ref_stream, ref_mime = _download_reference_image(refs[0])
            try:
                result = client.images.edit(
                    model="gpt-image-1.5",
                    image=("source.png", ref_stream, ref_mime),
                    prompt=prompt[:32000],
                    size=spec["size"],
                    quality=spec["quality"],
                    n=1,
                )
            except TypeError:
                # Compatibility fallback for SDK variants
                # that accept file-like `image`.
                ref_stream.seek(0)
                result = client.images.edit(
                    model="gpt-image-1.5",
                    image=ref_stream,
                    prompt=prompt[:32000],
                    size=spec["size"],
                    quality=spec["quality"],
                    n=1,
                )
        else:
            result = client.images.generate(
                model="gpt-image-1.5",
                prompt=prompt[:32000],
                size=spec["size"],
                quality=spec["quality"],
                n=1,
            )

        b64 = result.data[0].b64_json
        if b64:
            return _store_base64(b64)
        url = getattr(result.data[0], "url", None)
        if url:
            return _download_and_store(url)
        log.warning("GPT Image returned no b64 or url")
        return None
    except Exception:
        log.exception("GPT Image 1.5 generation failed")
        return None


def _store_base64(b64_data: str) -> str:
    from app.services.storage import upload_image
    image_bytes = base64.b64decode(b64_data)
    return upload_image(image_bytes, "generated.png")


def _download_and_store(url: str) -> str:
    try:
        import httpx
        from app.services.storage import upload_image
        resp = httpx.get(url, timeout=30)
        resp.raise_for_status()
        return upload_image(resp.content, "generated.png")
    except Exception:
        log.warning(
            "Failed to download/store image, returning URL",
        )
        return url
