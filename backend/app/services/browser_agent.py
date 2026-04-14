"""
Browser-based profile scraper.

Launches a visible Playwright browser, navigates to a public social profile,
waits for the user to sign in if needed, extracts page text + media URLs,
and uses Claude to produce structured profile + posts data.
"""
from __future__ import annotations

import json
import logging
import re

log = logging.getLogger(__name__)

PLATFORM_PATTERNS: list[tuple[str, re.Pattern]] = [
    ("linkedin", re.compile(r"linkedin\.com/(?:in|company)/([^/?#]+)")),
    ("x",        re.compile(r"(?:x\.com|twitter\.com)/([^/?#]+)")),
    ("instagram", re.compile(r"instagram\.com/([^/?#]+)")),
    ("facebook", re.compile(r"facebook\.com/([^/?#]+)")),
]

MAX_TEXT_CHARS = 40_000
USER_WAIT_TIMEOUT_MS = 300_000  # 5 minutes for sign-in


def detect_platform(url: str) -> tuple[str, str]:
    """Return (platform, handle) from a profile URL."""
    for platform, pattern in PLATFORM_PATTERNS:
        match = pattern.search(url)
        if match:
            handle = match.group(1).strip().lstrip("@")
            return platform, handle
    raise ValueError(
        f"Could not detect platform from URL: {url}. "
        "Supported: LinkedIn (/in/ and /company/), X/Twitter, Instagram, Facebook"
    )


async def scrape_profile(url: str, *, headless: bool = False) -> dict:
    """
    Main entry point.  Returns::

        {
            "platform": "linkedin",
            "handle": "johndoe",
            "profile": { ... },
            "posts": [ ... ],
            "data_health_percent": int,
            "source_url": url,
        }
    """
    try:
        from playwright.async_api import async_playwright
    except ImportError:
        raise RuntimeError(
            "playwright is not installed. "
            "Run:  pip install playwright && playwright install chromium"
        )

    platform, handle = detect_platform(url)

    async with async_playwright() as pw:
        user_data = _get_profile_dir(platform)

        context = await pw.chromium.launch_persistent_context(
            user_data,
            headless=headless,
            channel="chrome",
            viewport={"width": 1280, "height": 900},
            locale="en-US",
            args=[
                "--disable-blink-features=AutomationControlled",
            ],
            ignore_default_args=["--enable-automation"],
        )

        page = context.pages[0] if context.pages else await context.new_page()
        await page.add_init_script("Object.defineProperty(navigator, 'webdriver', {get: () => undefined})")

        log.info("Navigating to %s", url)
        await page.goto(url, wait_until="domcontentloaded", timeout=30_000)
        await page.wait_for_timeout(2000)

        # --- Phase 1: let user sign in via a helper tab ---
        helper = await context.new_page()
        await helper.set_content(_build_helper_html(platform, handle, url))
        await page.bring_to_front()

        log.info("Waiting for user to click 'Start Capture' in helper tab (up to 5 min)…")
        await helper.wait_for_function(
            "window.__adaptReady === true",
            timeout=USER_WAIT_TIMEOUT_MS,
        )
        await helper.close()
        log.info("User clicked Start Capture — resuming scrape")

        # Re-navigate in case user went to a login page
        await page.bring_to_front()
        current = page.url
        if not _urls_same_profile(current, url):
            log.info("Re-navigating to %s", url)
            await page.goto(url, wait_until="domcontentloaded", timeout=30_000)
            await page.wait_for_timeout(3000)

        # --- Phase 2: platform-specific deep scrape ---
        await _dismiss_popups(page, platform)
        text_content, media_data, page_title = await _deep_scrape(
            page, platform, handle, url,
        )

        await context.close()

    log.info(
        "Extracted %d chars, %d images, %d videos from %s (%s)",
        len(text_content), len(media_data["images"]), len(media_data["videos"]),
        platform, handle,
    )

    structured = _extract_with_claude(
        text_content, media_data, platform, handle, url, page_title,
    )

    # --- Phase 4: visual media analysis with Claude vision ---
    posts = structured.get("posts", [])
    if posts:
        try:
            analyzed = _analyze_post_visuals(posts, platform)
            structured["posts"] = analyzed
            log.info("Visual media analysis complete for %d posts", len(analyzed))
        except Exception:
            log.warning("Visual media analysis failed, continuing without it", exc_info=True)

    return {
        "platform": platform,
        "handle": handle,
        "source_url": url,
        **structured,
    }


def _get_profile_dir(platform: str) -> str:
    """Return a persistent browser profile directory per platform."""
    import os
    base = os.path.expanduser("~/.adapt-ai/browser-profiles")
    profile_dir = os.path.join(base, platform)
    os.makedirs(profile_dir, exist_ok=True)
    return profile_dir


def _urls_same_profile(a: str, b: str) -> bool:
    """Loose check whether two URLs point to the same profile page."""
    from urllib.parse import urlparse
    pa, pb = urlparse(a), urlparse(b)
    return pa.netloc == pb.netloc and pa.path.rstrip("/") == pb.path.rstrip("/")


# ---------------------------------------------------------------------------
#  Deep scrape — platform-specific orchestration
# ---------------------------------------------------------------------------

async def _deep_scrape(page, platform: str, handle: str, url: str):
    """
    Dispatch to per-platform scraping logic.
    Returns (combined_text, media_data, page_title).
    """
    if platform == "linkedin":
        return await _scrape_linkedin(page, handle, url)
    elif platform == "x":
        return await _scrape_x(page, handle, url)
    elif platform == "instagram":
        return await _scrape_instagram(page, handle, url)
    elif platform == "facebook":
        return await _scrape_facebook(page, handle, url)
    else:
        return await _scrape_generic(page, platform)


# ---- LinkedIn ----

async def _scrape_linkedin(page, handle: str, url: str):
    await page.wait_for_timeout(1500)
    profile_text = await page.inner_text("body")
    profile_text = profile_text[:10_000]

    # Navigate to posts/activity page
    if "/company/" in url:
        posts_url = f"https://www.linkedin.com/company/{handle}/posts/"
    else:
        posts_url = f"https://www.linkedin.com/in/{handle}/recent-activity/all/"
    log.info("LinkedIn → navigating to %s", posts_url)
    await page.goto(posts_url, wait_until="domcontentloaded", timeout=30_000)
    await page.wait_for_timeout(2500)
    await _dismiss_popups(page, "linkedin")

    see_more_sels = [
        'button.see-more-less-button',
        'button:has-text("…see more")',
        'button:has-text("see more")',
        'button:has-text("…more")',
        'span.lt-line-clamp__more',
    ]

    # LinkedIn also virtualizes — capture incrementally
    chunks: list[str] = []
    all_media: dict = {"images": [], "videos": []}

    for i in range(15):
        await _click_all_see_more(page, see_more_sels, max_clicks=10)
        chunk = await page.inner_text("body")
        chunks.append(chunk)
        media = await _extract_media(page)
        all_media["images"].extend(media.get("images", []))
        all_media["videos"].extend(media.get("videos", []))
        await page.evaluate("window.scrollBy(0, window.innerHeight)")
        await page.wait_for_timeout(1200)
        if i % 5 == 4:
            log.info("LinkedIn scroll %d / 15", i + 1)

    title = await page.title()
    posts_text = _dedupe_chunks(chunks)

    text = f"=== PROFILE PAGE ===\n{profile_text}\n\n=== POSTS PAGE ===\n{posts_text[:MAX_TEXT_CHARS]}"
    return text, all_media, title


# ---- X / Twitter ----

async def _scrape_x(page, handle: str, url: str):
    await page.wait_for_timeout(2000)
    profile_text = await page.inner_text("body")
    profile_text = profile_text[:15_000]

    see_more_sels = [
        '[data-testid="tweet-text-show-more-link"]',
        'button:has-text("Show more")',
    ]

    # X virtualizes its timeline — tweets scrolled past are removed from the
    # DOM. We must capture text + media incrementally at each scroll step.
    chunks: list[str] = []
    all_media: dict = {"images": [], "videos": []}

    for i in range(20):
        # Expand any truncated tweets currently in the viewport
        await _click_all_see_more(page, see_more_sels, max_clicks=10)
        # Capture current viewport text
        chunk = await page.inner_text("body")
        chunks.append(chunk)
        # Capture media currently in the DOM
        media = await _extract_media(page)
        all_media["images"].extend(media.get("images", []))
        all_media["videos"].extend(media.get("videos", []))
        # Scroll one viewport
        await page.evaluate("window.scrollBy(0, window.innerHeight)")
        await page.wait_for_timeout(1400)
        if i % 5 == 4:
            log.info("X scroll %d / 20", i + 1)

    title = await page.title()
    posts_text = _dedupe_chunks(chunks)

    text = f"=== PROFILE PAGE ===\n{profile_text}\n\n=== POSTS (incremental capture) ===\n{posts_text[:MAX_TEXT_CHARS]}"
    return text, all_media, title


# ---- Instagram ----

_IG_POST_URL_JS = """
(() => {
    const urls = new Set();
    document.querySelectorAll('a[href*="/p/"], a[href*="/reel/"]').forEach(a => {
        const href = a.getAttribute('href');
        if (href) urls.add(href);
    });
    return [...urls];
})();
"""

async def _scrape_instagram(page, handle: str, url: str):
    await page.wait_for_timeout(2000)
    await _dismiss_popups(page, "instagram")
    profile_text = await page.inner_text("body")
    profile_text = profile_text[:15_000]

    # Phase 1: Scroll the grid incrementally, collecting post URLs at each step.
    # Instagram virtualizes the grid — links scrolled past are removed from DOM.
    collected_hrefs: list[str] = []
    seen_hrefs: set[str] = set()

    for i in range(12):
        try:
            hrefs = await page.evaluate(_IG_POST_URL_JS)
            for h in hrefs:
                if h not in seen_hrefs:
                    seen_hrefs.add(h)
                    collected_hrefs.append(h)
        except Exception:
            pass
        await page.evaluate("window.scrollBy(0, window.innerHeight)")
        await page.wait_for_timeout(1200)
        if i % 4 == 3:
            log.info("IG grid scroll %d / 12 — %d URLs collected", i + 1, len(collected_hrefs))

    max_posts = min(len(collected_hrefs), 50)
    log.info("Instagram: collected %d unique post URLs, will visit up to %d", len(collected_hrefs), max_posts)

    # Phase 2: Visit each post page directly to get full caption, engagement, media
    post_details: list[str] = []
    all_media: dict = {"images": [], "videos": []}

    for idx, href in enumerate(collected_hrefs[:max_posts]):
        post_url = href if href.startswith("http") else f"https://www.instagram.com{href}"
        try:
            await page.goto(post_url, wait_until="domcontentloaded", timeout=20_000)
            await page.wait_for_timeout(1500)
            await _dismiss_popups(page, "instagram")

            # Expand truncated caption
            await _click_all_see_more(page, [
                'button:has-text("more")',
                'span[role="link"]:has-text("more")',
                'a:has-text("more")',
            ], max_clicks=3)

            detail_text = await page.inner_text("body")
            post_details.append(f"--- IG POST {idx+1} ({post_url}) ---\n{detail_text[:4000]}")

            post_media = await _extract_media(page)
            all_media["images"].extend(post_media.get("images", []))
            all_media["videos"].extend(post_media.get("videos", []))

            if (idx + 1) % 10 == 0:
                log.info("IG posts visited: %d / %d", idx + 1, max_posts)

        except Exception as exc:
            log.debug("Instagram post %d (%s) failed: %s", idx, post_url, exc)

    title = await page.title()
    posts_text = "\n\n".join(post_details)

    text = f"=== PROFILE PAGE ===\n{profile_text}\n\n=== INDIVIDUAL POSTS ===\n{posts_text[:MAX_TEXT_CHARS]}"
    return text, all_media, title


# ---- Facebook ----

_FB_POST_URL_JS = """
(() => {
    const urls = new Set();
    document.querySelectorAll('a[href*="/posts/"], a[href*="/photos/"], a[href*="/videos/"]').forEach(a => {
        const href = a.getAttribute('href');
        if (href) urls.add(href);
    });
    return [...urls];
})();
"""

async def _scrape_facebook(page, handle: str, url: str):
    await page.wait_for_timeout(2000)
    await _dismiss_popups(page, "facebook")
    profile_text = await page.inner_text("body")
    profile_text = profile_text[:15_000]

    collected_hrefs: list[str] = []
    seen_hrefs: set[str] = set()

    for i in range(10):
        try:
            hrefs = await page.evaluate(_FB_POST_URL_JS)
            for h in hrefs:
                if h not in seen_hrefs:
                    seen_hrefs.add(h)
                    collected_hrefs.append(h)
        except Exception:
            pass
        await page.evaluate("window.scrollBy(0, window.innerHeight)")
        await page.wait_for_timeout(1500)
        if i % 4 == 3:
            log.info("FB page scroll %d / 10 — %d URLs collected", i + 1, len(collected_hrefs))

    max_posts = min(len(collected_hrefs), 50)
    log.info("Facebook: collected %d unique post URLs, will visit up to %d", len(collected_hrefs), max_posts)

    post_details: list[str] = []
    all_media: dict = {"images": [], "videos": []}

    for idx, href in enumerate(collected_hrefs[:max_posts]):
        post_url = href if href.startswith("http") else f"https://www.facebook.com{href}"
        try:
            await page.goto(post_url, wait_until="domcontentloaded", timeout=20_000)
            await page.wait_for_timeout(2000)
            await _dismiss_popups(page, "facebook")

            await _click_all_see_more(page, [
                'div[role="button"]:has-text("See more")',
                'span:has-text("See more")',
            ], max_clicks=3)

            detail_text = await page.inner_text("body")
            post_details.append(f"--- FB POST {idx+1} ({post_url}) ---\n{detail_text[:4000]}")

            post_media = await _extract_media(page)
            all_media["images"].extend(post_media.get("images", []))
            all_media["videos"].extend(post_media.get("videos", []))

            if (idx + 1) % 10 == 0:
                log.info("FB posts visited: %d / %d", idx + 1, max_posts)

        except Exception as exc:
            log.debug("Facebook post %d (%s) failed: %s", idx, post_url, exc)

    title = await page.title()
    posts_text = "\n\n".join(post_details)

    text = f"=== PROFILE PAGE ===\n{profile_text}\n\n=== INDIVIDUAL POSTS ===\n{posts_text[:MAX_TEXT_CHARS]}"
    return text, all_media, title


# ---- Generic fallback ----

async def _scrape_generic(page, platform: str):
    chunks: list[str] = []
    all_media: dict = {"images": [], "videos": []}
    for _ in range(12):
        chunks.append(await page.inner_text("body"))
        media = await _extract_media(page)
        all_media["images"].extend(media.get("images", []))
        all_media["videos"].extend(media.get("videos", []))
        await page.evaluate("window.scrollBy(0, window.innerHeight)")
        await page.wait_for_timeout(1200)
    title = await page.title()
    text = _dedupe_chunks(chunks)
    return text[:MAX_TEXT_CHARS], all_media, title


# ---------------------------------------------------------------------------
#  Shared helpers
# ---------------------------------------------------------------------------

def _dedupe_chunks(chunks: list[str]) -> str:
    """
    Merge overlapping text snapshots captured during incremental scrolling.
    Each chunk is a full page.inner_text() — consecutive chunks overlap heavily.
    We split each into lines and keep only lines we haven't seen before,
    preserving order.
    """
    seen: set[str] = set()
    unique_lines: list[str] = []
    for chunk in chunks:
        for line in chunk.splitlines():
            stripped = line.strip()
            if not stripped or stripped in seen:
                continue
            seen.add(stripped)
            unique_lines.append(line)
    return "\n".join(unique_lines)


async def _scroll_page(page, *, count: int = 12, pause_ms: int = 1200) -> None:
    """Scroll the page to trigger lazy-loaded content (no scroll-back)."""
    for i in range(count):
        await page.evaluate("window.scrollBy(0, window.innerHeight)")
        await page.wait_for_timeout(pause_ms)
        if i % 5 == 4:
            log.info("Scrolled %d / %d", i + 1, count)


async def _click_all_see_more(
    page, selectors: list[str], *, max_clicks: int = 30,
) -> None:
    """Click all 'see more' / 'show more' buttons matching any selector."""
    total_clicked = 0
    for sel in selectors:
        if total_clicked >= max_clicks:
            break
        try:
            buttons = page.locator(sel)
            count = await buttons.count()
            for i in range(min(count, max_clicks - total_clicked)):
                try:
                    btn = buttons.nth(i)
                    if await btn.is_visible(timeout=300):
                        await btn.scroll_into_view_if_needed()
                        await btn.click()
                        total_clicked += 1
                        await page.wait_for_timeout(300)
                except Exception:
                    pass
        except Exception:
            pass
    if total_clicked > 0:
        log.info("Clicked %d 'see more' buttons", total_clicked)


# ---------------------------------------------------------------------------
#  Helper tab — CSP-safe wait for user
# ---------------------------------------------------------------------------

def _build_helper_html(platform: str, handle: str, url: str) -> str:
    """Return a self-contained HTML page for the 'Continue' helper tab."""
    return f"""<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><title>Adapt AI — Capture</title></head>
<body style="margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;
background:linear-gradient(135deg,#f5f3ff,#ede9fe);font-family:system-ui,-apple-system,sans-serif;">
<div style="text-align:center;max-width:480px;padding:40px;">
    <div style="font-size:36px;margin-bottom:16px;">🔍</div>
    <h1 style="font-size:22px;font-weight:700;color:#1e1b4b;margin:0 0 8px;">
        Adapt AI — Profile Capture
    </h1>
    <p style="color:#6b7280;font-size:14px;line-height:1.6;margin:0 0 8px;">
        Importing <strong>{handle}</strong> from <strong>{platform.title()}</strong>
    </p>
    <p style="color:#6b7280;font-size:13px;line-height:1.6;margin:0 0 24px;">
        Switch to the <strong>other tab</strong> to sign in if needed.<br>
        When the profile page is loaded, come back here and click below.
    </p>
    <button onclick="window.__adaptReady=true;this.disabled=true;this.textContent='Capturing…';"
        style="background:linear-gradient(135deg,#4F46E5,#7C3AED);color:#fff;border:none;
        padding:14px 36px;border-radius:12px;font-size:15px;font-weight:600;cursor:pointer;
        box-shadow:0 4px 16px rgba(79,70,229,0.35);transition:transform .15s ease;"
        onmouseenter="this.style.transform='scale(1.04)'"
        onmouseleave="this.style.transform='scale(1)'"
    >Start Capture</button>
    <p style="color:#9ca3af;font-size:11px;margin-top:16px;">
        The browser will scroll through the profile and capture posts + media.
    </p>
</div>
</body></html>"""


# ---------------------------------------------------------------------------
#  Platform-specific helpers
# ---------------------------------------------------------------------------

async def _dismiss_popups(page, platform: str) -> None:
    """Best-effort click-away of cookie banners, login overlays, etc."""
    dismiss_selectors = [
        'button:has-text("Accept")',
        'button:has-text("Accept all")',
        'button:has-text("Accept All")',
        'button:has-text("Allow all cookies")',
        'button:has-text("Agree")',
        'button:has-text("Got it")',
        'button:has-text("OK")',
        '[data-testid="cookie-policy-manage-dialog-btn-accept"]',
    ]

    if platform == "linkedin":
        dismiss_selectors += [
            'button:has-text("Reject")',
            'button[action-type="DISMISS"]',
            'icon[type="cancel-icon"]',
        ]
    elif platform == "instagram":
        dismiss_selectors += [
            'button:has-text("Allow essential and optional cookies")',
            'button:has-text("Allow All Cookies")',
        ]
    elif platform == "x":
        dismiss_selectors += [
            '[data-testid="xMigrationBottomBar"] button',
        ]

    for sel in dismiss_selectors:
        try:
            btn = page.locator(sel).first
            if await btn.is_visible(timeout=500):
                await btn.click()
                await page.wait_for_timeout(500)
        except Exception:
            pass


# ---------------------------------------------------------------------------
#  Media extraction
# ---------------------------------------------------------------------------

MEDIA_EXTRACT_JS = """
(() => {
    const seen = new Set();

    // --- images ---
    const images = [];
    document.querySelectorAll('img').forEach(img => {
        const src = img.src || img.getAttribute('data-src') || '';
        if (!src || src.startsWith('data:') || seen.has(src)) return;
        const w = img.naturalWidth || img.width || 0;
        const h = img.naturalHeight || img.height || 0;
        // skip tiny icons / tracking pixels
        if (w > 0 && w < 48 && h > 0 && h < 48) return;
        seen.add(src);
        images.push({
            src,
            alt: (img.alt || '').slice(0, 200),
            width: w,
            height: h,
        });
    });

    // --- videos ---
    const videos = [];
    document.querySelectorAll('video').forEach(vid => {
        const src = vid.src
            || (vid.querySelector('source') || {}).src
            || '';
        const poster = vid.poster || '';
        if (!src && !poster) return;
        if (seen.has(src || poster)) return;
        seen.add(src || poster);
        videos.push({ src, poster });
    });

    // also grab background-image video thumbnails (Facebook, IG)
    document.querySelectorAll('[style*="background-image"]').forEach(el => {
        const match = el.style.backgroundImage.match(/url\\(['"]?(.*?)['"]?\\)/);
        if (!match) return;
        const bgUrl = match[1];
        if (seen.has(bgUrl) || bgUrl.startsWith('data:')) return;
        seen.add(bgUrl);
        images.push({ src: bgUrl, alt: '', width: 0, height: 0 });
    });

    return { images, videos };
})();
"""


async def _extract_media(page) -> dict:
    """Pull all meaningful image and video URLs from the current page."""
    try:
        return await page.evaluate(MEDIA_EXTRACT_JS)
    except Exception:
        log.warning("Media extraction JS failed, continuing with text only")
        return {"images": [], "videos": []}


# ---------------------------------------------------------------------------
#  Claude extraction
# ---------------------------------------------------------------------------

EXTRACTION_PROMPT = """You are extracting structured profile data from a {platform} public profile page.

You are given:
1. The raw visible text of the page
2. A list of image URLs found on the page
3. A list of video URLs / poster thumbnails found on the page

Extract the following:

**Profile**: name, handle/username, bio/headline/about, follower count, following count, avatar image URL (pick the best profile picture from the image list)

**Recent posts/content** (up to 50): for each post, extract:
- text content
- approximate date
- type: "text" | "image" | "video" | "carousel" | "thread" | "reel" | "article" | "document"
- engagement metrics (likes, comments, shares/reposts)
- media: array of image/video URLs that belong to THIS post (match by proximity in the text or by alt text). Include poster/thumbnail URLs for videos.

Rules:
- Extract ONLY what is explicitly present. Do NOT fabricate data.
- Convert shorthand numbers: "1.2K" → 1200, "3.5M" → 3500000.
- If a field is unavailable, use null for strings and 0 for numbers.
- For type: if a post has images, use "image"; if multiple images, "carousel"; if video, "video"; if it's a reshare of an article link, "article".
- Associate media URLs with their posts. If you can't determine which post an image belongs to, skip it.
- The page title was: "{page_title}"

Return **valid JSON only** (no markdown fencing):
{{
  "profile": {{
    "name": "Full Name",
    "handle": "{handle}",
    "bio": "Bio or headline text",
    "followers": 0,
    "following": 0,
    "avatar_url": "https://..."
  }},
  "posts": [
    {{
      "text": "Post content…",
      "date": "YYYY-MM-DD or descriptive (e.g. '2d ago')",
      "type": "image",
      "media": ["https://image1.jpg", "https://image2.jpg"],
      "engagement": {{"likes": 0, "comments": 0, "shares": 0, "total": 0}}
    }}
  ]
}}

--- PAGE TEXT from {platform} profile ({url}) ---
The text may contain two sections: "PROFILE PAGE" (main page with bio/about) and "POSTS PAGE" (dedicated posts/activity page with more posts). Extract profile info from the PROFILE PAGE section and posts from the POSTS PAGE section (or both if posts appear in both).
{text}
--- END TEXT ---

--- IMAGES found on page (src, alt, dimensions) ---
{images_json}
--- END IMAGES ---

--- VIDEOS found on page (src, poster) ---
{videos_json}
--- END VIDEOS ---"""


def _extract_with_claude(
    text: str,
    media: dict,
    platform: str,
    handle: str,
    url: str,
    page_title: str = "",
) -> dict:
    """Send page text + media info to Claude and return structured data."""
    from app.services.llm import _strip_code_fences

    # Deduplicate media collected across incremental scroll captures
    seen_srcs: set[str] = set()
    unique_images = []
    for img in media.get("images", []):
        src = img.get("src", "")
        if src and src not in seen_srcs:
            seen_srcs.add(src)
            unique_images.append(img)
    unique_videos = []
    for vid in media.get("videos", []):
        key = vid.get("src") or vid.get("poster", "")
        if key and key not in seen_srcs:
            seen_srcs.add(key)
            unique_videos.append(vid)

    images_json = json.dumps(unique_images[:80], indent=None)
    videos_json = json.dumps(unique_videos[:20], indent=None)

    prompt = EXTRACTION_PROMPT.format(
        platform=platform,
        handle=handle,
        url=url,
        text=text,
        page_title=page_title,
        images_json=images_json,
        videos_json=videos_json,
    )

    from app.services.llm import _call_claude
    response = _call_claude(
        model="claude-sonnet-4-5-20250929",
        max_tokens=16000,
        messages=[{"role": "user", "content": prompt}],
    )

    raw = _strip_code_fences(response.content[0].text.strip())

    # If the response was truncated (hit max_tokens), try to repair the JSON
    if response.stop_reason == "max_tokens":
        log.warning("Claude response was truncated — attempting JSON repair")
        raw = _repair_truncated_json(raw)

    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        log.error("Claude returned invalid JSON for profile extraction: %s", raw[:300])
        data = {
            "profile": {"name": handle, "handle": handle, "bio": "", "followers": 0},
            "posts": [],
        }

    profile = data.get("profile", {})
    posts = data.get("posts", [])

    for i, p in enumerate(posts):
        if "id" not in p:
            p["id"] = f"scraped-{i}"
        eng = p.get("engagement", {})
        if "total" not in eng or eng["total"] == 0:
            eng["total"] = (
                eng.get("likes", 0) + eng.get("comments", 0) + eng.get("shares", 0)
            )
            p["engagement"] = eng
        if "media" not in p:
            p["media"] = []

    health = 0
    if profile.get("name") and profile["name"] != handle:
        health += 15
    if profile.get("bio"):
        health += 15
    if profile.get("followers", 0) > 0:
        health += 10
    if profile.get("avatar_url"):
        health += 10
    if len(posts) >= 20:
        health += 30
    elif len(posts) >= 5:
        health += 20
    elif len(posts) >= 1:
        health += 10
    has_media = any(p.get("media") for p in posts)
    if has_media:
        health += 20

    return {
        "profile": profile,
        "posts": posts,
        "data_health_percent": min(health, 100),
    }


# ---------------------------------------------------------------------------
#  Visual media analysis with Claude vision
# ---------------------------------------------------------------------------

MAX_IMAGES_TO_ANALYZE = 15
IMAGE_BATCH_SIZE = 5


def _analyze_post_visuals(posts: list[dict], platform: str) -> list[dict]:
    """
    Download images from post media URLs and analyze them with Claude vision.
    Adds 'media_analysis' to each post that has analyzable media.
    """
    import base64
    import httpx

    posts_with_media = [
        (i, p) for i, p in enumerate(posts) if p.get("media")
    ]
    if not posts_with_media:
        log.info("No posts with media URLs to analyze visually")
        return posts

    # Collect (post_index, image_url) pairs — limit total
    image_tasks: list[tuple[int, str]] = []
    for idx, post in posts_with_media:
        for media_url in post["media"][:2]:
            if len(image_tasks) >= MAX_IMAGES_TO_ANALYZE:
                break
            if isinstance(media_url, str) and media_url.startswith("http"):
                image_tasks.append((idx, media_url))
        if len(image_tasks) >= MAX_IMAGES_TO_ANALYZE:
            break

    if not image_tasks:
        return posts

    log.info("Downloading %d images for visual analysis", len(image_tasks))

    # Download images
    downloaded: list[tuple[int, str, str, str]] = []  # (post_idx, url, base64, media_type)
    with httpx.Client(timeout=10.0, follow_redirects=True) as http:
        for post_idx, img_url in image_tasks:
            try:
                resp = http.get(img_url)
                if resp.status_code != 200:
                    continue
                ct = resp.headers.get("content-type", "image/jpeg")
                if "image" not in ct and "video" not in ct:
                    continue
                media_type = ct.split(";")[0].strip()
                if media_type not in ("image/jpeg", "image/png", "image/gif", "image/webp"):
                    media_type = "image/jpeg"
                b64 = base64.b64encode(resp.content).decode()
                if len(b64) > 5_000_000:
                    continue
                downloaded.append((post_idx, img_url, b64, media_type))
            except Exception as exc:
                log.debug("Failed to download %s: %s", img_url[:80], exc)

    if not downloaded:
        log.info("No images could be downloaded for visual analysis")
        return posts

    log.info("Downloaded %d images, sending to Claude vision in batches", len(downloaded))

    # Batch-analyze images
    analysis_results: dict[int, list[dict]] = {}
    for batch_start in range(0, len(downloaded), IMAGE_BATCH_SIZE):
        batch = downloaded[batch_start:batch_start + IMAGE_BATCH_SIZE]
        batch_analysis = _vision_analyze_batch(batch, platform)
        for post_idx, analysis in batch_analysis:
            analysis_results.setdefault(post_idx, []).append(analysis)

    # Merge analysis back into posts
    for post_idx, analyses in analysis_results.items():
        merged = {
            "visual_descriptions": [],
            "content_types": [],
            "visual_themes": [],
            "text_overlays": [],
            "brand_elements": [],
            "mood": "",
        }
        for a in analyses:
            if a.get("visual_description"):
                merged["visual_descriptions"].append(a["visual_description"])
            if a.get("content_type"):
                merged["content_types"].append(a["content_type"])
            merged["visual_themes"].extend(a.get("visual_themes", []))
            if a.get("text_overlay"):
                merged["text_overlays"].append(a["text_overlay"])
            merged["brand_elements"].extend(a.get("brand_elements", []))
            if a.get("mood"):
                merged["mood"] = a["mood"]

        # Dedupe lists
        merged["visual_themes"] = list(dict.fromkeys(merged["visual_themes"]))
        merged["brand_elements"] = list(dict.fromkeys(merged["brand_elements"]))
        merged["content_types"] = list(dict.fromkeys(merged["content_types"]))

        posts[post_idx]["media_analysis"] = merged

    return posts


VISION_PROMPT = """Analyze these {count} social media images from a {platform} account.

For EACH image (numbered 1 through {count}), provide:

1. **visual_description**: One-sentence description of what the image shows
2. **content_type**: Classify as one of: product_shot, infographic, lifestyle, screenshot, meme, quote_card, team_photo, event, tutorial, data_visualization, behind_the_scenes, user_generated, brand_asset, other
3. **visual_themes**: Array of 2-4 visual themes (e.g., "minimalist", "bold_typography", "dark_mode", "corporate", "vibrant_colors", "tech", "nature", "professional")
4. **text_overlay**: Any text visible in the image (empty string if none)
5. **brand_elements**: Array of brand signals (e.g., "logo_visible", "brand_colors", "product_ui", "mascot", "watermark")
6. **mood**: Overall mood (e.g., "professional", "playful", "urgent", "inspirational", "educational", "casual")

Return valid JSON only (no markdown fencing):
[
  {{
    "image_index": 1,
    "visual_description": "...",
    "content_type": "...",
    "visual_themes": ["...", "..."],
    "text_overlay": "...",
    "brand_elements": ["..."],
    "mood": "..."
  }}
]"""


def _vision_analyze_batch(
    batch: list[tuple[int, str, str, str]],
    platform: str,
) -> list[tuple[int, dict]]:
    """
    Send a batch of images to Claude vision and return (post_idx, analysis) pairs.
    """
    from app.services.llm import _strip_code_fences

    content_blocks: list[dict] = []
    post_indices: list[int] = []

    for i, (post_idx, _url, b64, media_type) in enumerate(batch):
        content_blocks.append({
            "type": "text",
            "text": f"Image {i+1}:",
        })
        content_blocks.append({
            "type": "image",
            "source": {
                "type": "base64",
                "media_type": media_type,
                "data": b64,
            },
        })
        post_indices.append(post_idx)

    content_blocks.append({
        "type": "text",
        "text": VISION_PROMPT.format(count=len(batch), platform=platform),
    })

    try:
        from app.services.llm import _call_claude
        response = _call_claude(
            model="claude-sonnet-4-5-20250929",
            max_tokens=4000,
            messages=[{"role": "user", "content": content_blocks}],
        )

        raw = _strip_code_fences(response.content[0].text.strip())
        analyses = json.loads(raw)

        results: list[tuple[int, dict]] = []
        for a in analyses:
            img_idx = a.get("image_index", 1) - 1
            if 0 <= img_idx < len(post_indices):
                results.append((post_indices[img_idx], a))
        return results

    except Exception as exc:
        log.warning("Vision analysis batch failed: %s", exc)
        return []


def _repair_truncated_json(raw: str) -> str:
    """
    Best-effort repair of JSON truncated mid-stream.
    Tries to close open arrays/objects so the partial data is still usable.
    """
    # Find the last complete post object by looking for the last "},"
    # and close the array/object around it.
    last_complete = raw.rfind("},")
    if last_complete == -1:
        last_complete = raw.rfind("}")
    if last_complete == -1:
        return raw

    trimmed = raw[: last_complete + 1]

    # Count unclosed brackets
    opens = trimmed.count("[") - trimmed.count("]")
    opens_obj = trimmed.count("{") - trimmed.count("}")

    trimmed += "]" * max(opens, 0)
    trimmed += "}" * max(opens_obj, 0)

    try:
        json.loads(trimmed)
        log.info("JSON repair succeeded — recovered partial data")
        return trimmed
    except json.JSONDecodeError:
        log.warning("JSON repair failed, returning original")
        return raw


# ---------------------------------------------------------------------------
#  Follower / commenter scraping
# ---------------------------------------------------------------------------

FOLLOWER_URLS = {
    "linkedin": lambda handle, url: (
        url.rstrip("/").replace("/company/", "/company/") + "/people/"
        if "/company/" in url
        else f"https://www.linkedin.com/in/{handle}/recent-activity/reactions/"
    ),
    "x": lambda handle, _url: f"https://x.com/{handle}/followers",
    "instagram": None,
}


async def scrape_followers(url: str, *, headless: bool = False, limit: int = 10) -> dict:
    """
    Scrape a small sample of followers from a social profile.
    Returns::

        {
            "platform": str,
            "handle": str,
            "followers": [{ "name", "handle", "headline", "profile_url", "industry_signals" }],
            "top_commenters": [{ "name", "handle", "comment_count" }],
            "scraped_at": str,
        }
    """
    try:
        from playwright.async_api import async_playwright
    except ImportError:
        raise RuntimeError("playwright is not installed.")

    from datetime import datetime, timezone

    platform, handle = detect_platform(url)

    async with async_playwright() as pw:
        user_data = _get_profile_dir(platform)
        context = await pw.chromium.launch_persistent_context(
            user_data,
            headless=headless,
            channel="chrome",
            viewport={"width": 1280, "height": 900},
            locale="en-US",
            args=["--disable-blink-features=AutomationControlled"],
            ignore_default_args=["--enable-automation"],
        )

        page = context.pages[0] if context.pages else await context.new_page()
        await page.add_init_script(
                "Object.defineProperty(navigator, 'webdriver', {get: () => undefined})"
            )

        follower_url_fn = FOLLOWER_URLS.get(platform)
        if platform == "instagram":
            target_url = url
        elif follower_url_fn:
            target_url = follower_url_fn(handle, url)
        else:
            target_url = url

        log.info("Navigating to followers page: %s", target_url)
        await page.goto(target_url, wait_until="domcontentloaded", timeout=30_000)
        await page.wait_for_timeout(2000)

        helper = await context.new_page()
        await helper.set_content(_build_follower_helper_html(platform, handle))
        await page.bring_to_front()

        log.info("Waiting for user to click 'Start Capture' for follower scrape…")
        await helper.wait_for_function(
            "window.__adaptReady === true", timeout=USER_WAIT_TIMEOUT_MS,
        )
        await helper.close()

        await page.bring_to_front()
        await _dismiss_popups(page, platform)

        if platform == "instagram":
            raw_text = await _scrape_instagram_followers(page, limit)
        elif platform == "linkedin":
            raw_text = await _scrape_linkedin_followers(page, limit)
        elif platform == "x":
            raw_text = await _scrape_x_followers(page, limit)
        else:
            raw_text = await page.inner_text("body")
            raw_text = raw_text[:MAX_TEXT_CHARS]

        log.info("Extracted %d chars of follower list from %s", len(raw_text), platform)

        # Phase 1: get handles from the list page via Claude
        preliminary = _extract_followers_with_claude(raw_text, platform, handle, limit)
        log.info("Identified %d follower handles, now visiting profiles…", len(preliminary))

        # Phase 2: visit each follower's profile for rich data
        enriched = await _enrich_follower_profiles(
            page, preliminary, platform, limit,
        )

        await context.close()

    return {
        "platform": platform,
        "handle": handle,
        "followers": enriched,
        "top_commenters": [],
        "scraped_at": datetime.now(timezone.utc).isoformat(),
    }


async def _scrape_linkedin_followers(page, limit: int) -> str:
    """
    Scroll the LinkedIn company /people/ page, clicking 'Show more results'
    pagination buttons until we have enough content for at least `limit` profiles.
    """
    _SHOW_MORE_SELECTORS = [
        'button:has-text("Show more results")',
        'button:has-text("Show more")',
        'button.scaffold-finite-scroll__load-button',
        'button[aria-label="Show more results"]',
        'button[aria-label="Next"]',
    ]

    chunks: list[str] = []
    prev_len = 0
    stale_count = 0
    max_pages = max(5, (limit // 10) + 2)

    for page_num in range(max_pages):
        await page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
        await page.wait_for_timeout(2000)

        text = await page.inner_text("body")
        if len(text) > prev_len:
            chunks.append(text[:20_000])
            stale_count = 0
            prev_len = len(text)
        else:
            stale_count += 1

        clicked = False
        for sel in _SHOW_MORE_SELECTORS:
            try:
                btn = page.locator(sel).first
                if await btn.is_visible(timeout=1500):
                    await btn.scroll_into_view_if_needed()
                    await btn.click()
                    clicked = True
                    log.info(
                        "LinkedIn followers: clicked '%s' (page %d)",
                        sel, page_num + 1,
                    )
                    await page.wait_for_timeout(3000)
                    break
            except Exception:
                pass

        if not clicked:
            stale_count += 1

        if stale_count >= 3:
            log.info(
                "LinkedIn followers: no more results after %d pages",
                page_num + 1,
            )
            break

    combined = "\n---PAGE_BREAK---\n".join(chunks)
    log.info(
        "LinkedIn followers: collected %d chars across %d pages",
        len(combined), len(chunks),
    )
    return combined[:MAX_TEXT_CHARS]


async def _scrape_x_followers(page, limit: int) -> str:
    """Scroll the X followers page to collect follower cards."""
    await page.wait_for_timeout(2000)

    scroll_rounds = max(5, limit)
    chunks: list[str] = []
    prev_len = 0
    stale_count = 0
    for _ in range(scroll_rounds):
        text = await page.inner_text("body")
        if len(text) > prev_len:
            chunks.append(text[:15_000])
            stale_count = 0
        else:
            stale_count += 1
        if stale_count >= 3:
            break
        prev_len = len(text)
        await page.evaluate("window.scrollBy(0, 1200)")
        await page.wait_for_timeout(2000)
    return "\n---PAGE_BREAK---\n".join(chunks)[:MAX_TEXT_CHARS]


async def _scrape_instagram_followers(page, limit: int) -> str:
    """Click the followers count on an Instagram profile, then scroll the modal."""
    try:
        followers_link = page.locator('a[href$="/followers/"]').first
        await followers_link.click(timeout=5000)
        await page.wait_for_timeout(3000)
    except Exception:
        log.warning("Could not click followers link on Instagram")
        return await page.inner_text("body")

    scroll_rounds = max(5, limit)
    chunks: list[str] = []
    modal = page.locator('[role="dialog"]').first
    prev_len = 0
    stale_count = 0
    for _ in range(scroll_rounds):
        try:
            text = await modal.inner_text(timeout=3000)
        except Exception:
            text = await page.inner_text("body")
        if len(text) > prev_len:
            chunks.append(text[:15_000])
            stale_count = 0
        else:
            stale_count += 1
        if stale_count >= 3:
            break
        prev_len = len(text)
        await page.evaluate(
            """() => {
                const d = document.querySelector('[role="dialog"] ul')
                    || document.querySelector('[role="dialog"]');
                if (d) d.scrollBy(0, 600);
            }"""
        )
        await page.wait_for_timeout(2000)
    return "\n---PAGE_BREAK---\n".join(chunks)[:MAX_TEXT_CHARS]


# ---------------------------------------------------------------------------
#  Profile enrichment — visit each follower's profile for rich data
# ---------------------------------------------------------------------------

_PROFILE_URL_TEMPLATES = {
    "x": "https://x.com/{handle}",
    "linkedin": "https://www.linkedin.com/in/{handle}",
    "instagram": "https://www.instagram.com/{handle}",
    "facebook": "https://www.facebook.com/{handle}",
}


async def _enrich_follower_profiles(
    page, followers: list[dict], platform: str, limit: int,
) -> list[dict]:
    """
    Visit each follower's profile page, extract their headline/bio,
    then use Claude to produce enriched follower data.
    """
    enriched: list[dict] = []
    for i, f in enumerate(followers[:limit]):
        fhandle = f.get("handle", "")
        if not fhandle:
            enriched.append(f)
            continue

        profile_url = f.get("profile_url", "")
        if not profile_url:
            tmpl = _PROFILE_URL_TEMPLATES.get(platform)
            if tmpl:
                profile_url = tmpl.format(handle=fhandle)
            else:
                enriched.append(f)
                continue

        log.info("  [%d/%d] Visiting profile: %s", i + 1, len(followers[:limit]), profile_url)
        try:
            await page.goto(profile_url, wait_until="domcontentloaded", timeout=15_000)
            await page.wait_for_timeout(2500)
            await _dismiss_popups(page, platform)

            profile_text = await _extract_profile_snippet(page, platform)
            if profile_text:
                f = _merge_profile_data(f, profile_text, platform)
        except Exception as exc:
            log.warning("  Could not visit %s: %s", profile_url, exc)

        f["profile_url"] = profile_url
        enriched.append(f)

        if i < len(followers[:limit]) - 1:
            await page.wait_for_timeout(1000)

    return enriched


async def _extract_profile_snippet(page, platform: str) -> str:
    """Grab the most relevant text from a follower's profile page."""
    if platform == "linkedin":
        return await _extract_linkedin_profile_snippet(page)

    selectors_by_platform = {
        "x": [
            '[data-testid="UserDescription"]',
            '[data-testid="UserProfileHeader_Items"]',
            'div[data-testid="UserName"]',
        ],
        "instagram": [
            "header section span",
            "header section div",
        ],
    }

    parts: list[str] = []

    for sel in selectors_by_platform.get(platform, []):
        try:
            elements = page.locator(sel)
            count = await elements.count()
            for j in range(min(count, 3)):
                text = await elements.nth(j).inner_text(timeout=2000)
                text = text.strip()
                if text and len(text) > 2:
                    parts.append(text)
        except Exception:
            pass

    if not parts:
        try:
            meta = await page.query_selector('meta[name="description"]')
            if meta:
                content = await meta.get_attribute("content")
                if content:
                    parts.append(content)
        except Exception:
            pass

    if not parts:
        try:
            body = await page.inner_text("body")
            parts.append(body[:3000])
        except Exception:
            pass

    return "\n".join(parts)[:5000]


async def _extract_linkedin_profile_snippet(page) -> str:
    """
    Extract headline, About section, and experience from a LinkedIn profile.
    Clicks 'see more' buttons to expand collapsed content.
    """
    parts: list[str] = []

    # 1. Name + headline (top card)
    for sel in [
        "h1.text-heading-xlarge",          # full name
        ".text-body-medium.break-words",   # headline under name
    ]:
        try:
            el = page.locator(sel).first
            if await el.is_visible(timeout=2000):
                text = (await el.inner_text(timeout=2000)).strip()
                if text:
                    parts.append(text)
        except Exception:
            pass

    # 2. Location / connection info
    for sel in [
        ".text-body-small.inline.t-black--light.break-words",
        "span.dist-value",
    ]:
        try:
            el = page.locator(sel).first
            if await el.is_visible(timeout=1000):
                text = (await el.inner_text(timeout=1000)).strip()
                if text:
                    parts.append(f"Location: {text}")
        except Exception:
            pass

    # 3. Scroll to About section and expand it
    try:
        about_section = page.locator(
            'section:has(#about), '
            'section:has(div[id="about"]), '
            'div.pv-about-section'
        ).first
        if await about_section.is_visible(timeout=2000):
            await about_section.scroll_into_view_if_needed()
            await page.wait_for_timeout(500)

            # Click "see more" inside the About section if collapsed
            for see_more_sel in [
                'section:has(#about) button.inline-show-more-text__button',
                'section:has(#about) button:has-text("see more")',
                'section:has(#about) button:has-text("…see more")',
                'div.pv-about-section button:has-text("see more")',
            ]:
                try:
                    btn = page.locator(see_more_sel).first
                    if await btn.is_visible(timeout=1000):
                        await btn.click()
                        await page.wait_for_timeout(500)
                        break
                except Exception:
                    pass

            about_text = (await about_section.inner_text(timeout=3000)).strip()
            if about_text and len(about_text) > 10:
                parts.append(f"About: {about_text}")
    except Exception:
        pass

    # 4. Experience section (first few entries)
    try:
        exp_section = page.locator(
            'section:has(#experience), '
            'section:has(div[id="experience"])'
        ).first
        if await exp_section.is_visible(timeout=2000):
            await exp_section.scroll_into_view_if_needed()
            await page.wait_for_timeout(500)
            exp_text = (await exp_section.inner_text(timeout=3000)).strip()
            if exp_text and len(exp_text) > 10:
                parts.append(f"Experience: {exp_text[:1500]}")
    except Exception:
        pass

    # 5. Fallback to meta description
    if not parts:
        try:
            meta = await page.query_selector('meta[name="description"]')
            if meta:
                content = await meta.get_attribute("content")
                if content:
                    parts.append(content)
        except Exception:
            pass

    return "\n\n".join(parts)[:6000]


def _merge_profile_data(
    follower: dict, profile_text: str, platform: str,
) -> dict:
    """Use Claude to extract structured info from a single profile page snippet."""
    from app.services.llm import _call_claude, _strip_code_fences

    prompt = (
        f"Extract structured info from this {platform} profile page text for "
        f"the user @{follower.get('handle', 'unknown')}.\n\n"
        f"## Profile Page Text\n{profile_text[:4000]}\n\n"
        f"Return JSON (no markdown fencing):\n"
        f'{{"headline": "their job title / bio / tagline",'
        f' "about": "their full About/bio section text (summarize to 2-3 sentences if very long)",'
        f' "industry_signals": ["keyword1", "keyword2", "keyword3", "keyword4"],'
        f' "location": "city/country if visible",'
        f' "company": "current company if visible",'
        f' "experience_summary": "brief summary of their work history (1-2 sentences)"}}\n'
        f"Return ONLY the JSON. Leave fields as empty string if not available."
    )

    try:
        response = _call_claude(
            model="claude-sonnet-4-5-20250929",
            max_tokens=800,
            messages=[{"role": "user", "content": prompt}],
        )
        raw = _strip_code_fences(response.content[0].text.strip())
        data = json.loads(raw)

        if data.get("headline"):
            follower["headline"] = data["headline"]
        if data.get("about"):
            follower["about"] = data["about"]
        if data.get("industry_signals"):
            follower["industry_signals"] = data["industry_signals"]
        if data.get("location"):
            follower["location"] = data["location"]
        if data.get("company"):
            follower["company"] = data["company"]
        if data.get("experience_summary"):
            follower["experience_summary"] = data["experience_summary"]
    except Exception as exc:
        log.warning("Profile enrichment failed for @%s: %s", follower.get("handle"), exc)

    return follower


def _build_follower_helper_html(platform: str, handle: str) -> str:
    return f"""<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><title>Adapt AI — Followers</title></head>
<body style="margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;
background:linear-gradient(135deg,#f0fdf4,#dcfce7);font-family:system-ui,-apple-system,sans-serif;">
<div style="text-align:center;max-width:480px;padding:40px;">
    <div style="font-size:36px;margin-bottom:16px;">👥</div>
    <h1 style="font-size:22px;font-weight:700;color:#14532d;margin:0 0 8px;">
        Adapt AI — Follower Capture
    </h1>
    <p style="color:#6b7280;font-size:14px;line-height:1.6;margin:0 0 8px;">
        Capturing followers for <strong>{handle}</strong> on <strong>{platform.title()}</strong>
    </p>
    <p style="color:#6b7280;font-size:13px;line-height:1.6;margin:0 0 24px;">
        Switch to the <strong>other tab</strong> to sign in if needed.<br>
        When the followers page is loaded, come back here and click below.
    </p>
    <button onclick="window.__adaptReady=true;this.disabled=true;this.textContent='Capturing…';"
        style="background:linear-gradient(135deg,#16a34a,#15803d);color:#fff;border:none;
        padding:14px 36px;border-radius:12px;font-size:15px;font-weight:600;cursor:pointer;
        box-shadow:0 4px 16px rgba(22,163,74,0.35);transition:transform .15s ease;"
        onmouseenter="this.style.transform='scale(1.04)'"
        onmouseleave="this.style.transform='scale(1)'"
    >Start Capture</button>
</div>
</body></html>"""


FOLLOWER_EXTRACTION_PROMPT = """You are analyzing a {platform} followers page for the account @{handle}.

Below is the raw text extracted from the followers list page. Extract up to {limit} individual follower profiles.

## Raw Page Text
{text}

## Task
Extract each follower as a JSON object. For each follower, extract:
- name: their display name
- handle: their username/handle (without @)
- headline: their bio, headline, or description (if visible)
- profile_url: their profile URL (construct from handle if not explicit)
- industry_signals: 2-4 keywords inferred from their headline/bio (e.g. "engineering", "marketing", "AI", "startup founder")

Return valid JSON (no markdown fencing):
{{
  "followers": [
    {{
      "name": "...",
      "handle": "...",
      "headline": "...",
      "profile_url": "...",
      "industry_signals": ["...", "..."]
    }}
  ]
}}

Return ONLY the JSON. Extract at most {limit} followers."""


def _extract_followers_with_claude(
    text: str, platform: str, handle: str, limit: int,
) -> list[dict]:
    """Use Claude to structure raw follower page text into follower profiles."""
    from app.services.llm import _call_claude, _strip_code_fences

    if not text.strip():
        return []

    prompt = FOLLOWER_EXTRACTION_PROMPT.format(
        platform=platform, handle=handle, limit=limit, text=text[:20_000],
    )

    response = _call_claude(
        model="claude-sonnet-4-5-20250929",
        max_tokens=4000,
        messages=[{"role": "user", "content": prompt}],
    )

    raw = _strip_code_fences(response.content[0].text.strip())
    try:
        data = json.loads(raw)
        return data.get("followers", [])[:limit]
    except json.JSONDecodeError:
        log.error("Failed to parse follower JSON: %s", raw[:200])
        return []
