"""
Claude-powered content generation via the Anthropic SDK.
All LLM calls route through Claude — no other model is used.
"""
from __future__ import annotations

import json
import logging
import re
import time

import anthropic

from app.core.settings import settings

log = logging.getLogger(__name__)

_client: anthropic.Anthropic | None = None
_client_key: str = ""

MAX_RETRIES = 5
INITIAL_BACKOFF_S = 10


def _get_api_key() -> str:
    """Read Anthropic key from DB config store first, then env var."""
    try:
        from app.db.session import SessionLocal
        from app.core.config_store import get_config
        db = SessionLocal()
        try:
            return get_config(db, "anthropic_api_key")
        finally:
            db.close()
    except Exception:
        return settings.anthropic_api_key


def _get_client() -> anthropic.Anthropic:
    global _client, _client_key
    api_key = _get_api_key()
    if not api_key:
        raise RuntimeError(
            "ANTHROPIC_API_KEY is not set. Add it in Settings or backend/.env."
        )
    if _client is None or api_key != _client_key:
        _client = anthropic.Anthropic(api_key=api_key)
        _client_key = api_key
    return _client


def _with_retries(fn):
    """Execute fn() with retry on 429 rate-limit / 529 overloaded errors.
    On 401 auth error, invalidate the cached client so the next call
    re-reads the API key from DB/env, then re-raise.
    """
    global _client, _client_key
    backoff = INITIAL_BACKOFF_S
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            return fn()
        except anthropic.AuthenticationError:
            log.error(
                "Authentication failed (401) — clearing cached client so "
                "the next call re-reads the API key."
            )
            _client = None
            _client_key = ""
            raise
        except anthropic.RateLimitError as exc:
            retry_after = _parse_retry_after(exc)
            wait = retry_after if retry_after else backoff
            log.warning(
                "Rate limited (attempt %d/%d) — waiting %.0fs before retry",
                attempt, MAX_RETRIES, wait,
            )
            if attempt == MAX_RETRIES:
                raise
            time.sleep(wait)
            backoff = min(backoff * 2, 120)
        except anthropic.APIStatusError as exc:
            if exc.status_code == 529:
                wait = backoff
                log.warning("API overloaded (529, attempt %d/%d) — waiting %.0fs", attempt, MAX_RETRIES, wait)
                if attempt == MAX_RETRIES:
                    raise
                time.sleep(wait)
                backoff = min(backoff * 2, 120)
            else:
                raise
    raise RuntimeError("Exhausted retries calling Claude")


def _call_claude(*, model: str, max_tokens: int, messages: list[dict]) -> anthropic.types.Message:
    """Central wrapper for non-agentic Claude API calls with retry."""
    client = _get_client()
    return _with_retries(lambda: client.messages.create(
        model=model, max_tokens=max_tokens, messages=messages,
    ))


def _parse_retry_after(exc: Exception) -> float | None:
    """Try to extract retry-after seconds from the exception or its headers."""
    try:
        resp = getattr(exc, "response", None)
        if resp is not None:
            val = resp.headers.get("retry-after")
            if val:
                return float(val)
    except Exception:
        pass
    return None


PLATFORM_STYLE_GUIDE: dict[str, str] = {
    "linkedin": (
        "Professional, insight-led, approachable. Use 3-5 strategic hashtags. "
        "No emojis. Start with a bold hook line. Use line breaks for readability. "
        "Ideal length: 150-300 words. End with a question or CTA."
    ),
    "x": (
        "Punchy, concise, first-line hook. Max 280 chars per tweet. "
        "Use 1-2 hashtags max. Contrarian or surprising angle. "
        "If content is long, structure as a thread (tweet 1/N format)."
    ),
    "instagram": (
        "Visual-first storytelling. Start with an attention-grabbing first line. "
        "Use line breaks and spacing. Include a clear CTA. "
        "15-25 relevant hashtags at the end. Emoji usage encouraged but tasteful. "
        "Ideal: 150-220 words."
    ),
    "facebook": (
        "Conversational, community-oriented, shareable. Lead with a relatable hook. "
        "Use 1-3 hashtags max. Encourage comments and shares. "
        "Mix personal stories with value. Use line breaks for readability. "
        "Ideal length: 100-250 words. End with a question or share prompt."
    ),
}

VARIANT_STRATEGIES = {
    "A": "Hook-first framing: lead with the most surprising or valuable insight.",
    "B": "Narrative/story structure: use a brief anecdote or scenario to frame the message.",
    "C": "Question-led: open with a thought-provoking question, then deliver the answer.",
}


def generate_variants_for_platform(
    source_content: str,
    platform: str,
) -> list[dict]:
    """Generate A/B/C variants for a single platform using Claude."""
    style = PLATFORM_STYLE_GUIDE.get(platform, PLATFORM_STYLE_GUIDE["linkedin"])

    prompt = f"""You are an expert social media content strategist. Your job is to adapt a single piece of source content into platform-native posts.

## Source Content
{source_content}

## Target Platform: {platform.upper()}

## Platform Style Guide
{style}

## Task
Generate exactly 3 variants (A, B, C) of this content adapted for {platform}. Each variant must use a different strategy:

- Variant A: {VARIANT_STRATEGIES["A"]}
- Variant B: {VARIANT_STRATEGIES["B"]}
- Variant C: {VARIANT_STRATEGIES["C"]}

## Requirements
1. Preserve the core message but adapt tone, structure, length, and format for {platform}
2. Each variant should feel native to {platform} — not like a cross-posted generic message
3. Include a brief rationale for each variant explaining your strategic choices

## Output Format
Return valid JSON (no markdown fencing) with this exact structure:
[
  {{
    "label": "A",
    "text": "The adapted post text...",
    "rationale": "Why this variant works for {platform}..."
  }},
  {{
    "label": "B",
    "text": "The adapted post text...",
    "rationale": "Why this variant works for {platform}..."
  }},
  {{
    "label": "C",
    "text": "The adapted post text...",
    "rationale": "Why this variant works for {platform}..."
  }}
]"""

    response = _call_claude(
        model="claude-sonnet-4-5-20250929",
        max_tokens=2000,
        messages=[{"role": "user", "content": prompt}],
    )

    raw_text = response.content[0].text.strip()
    raw_text = _strip_code_fences(raw_text)
    try:
        variants = json.loads(raw_text)
    except json.JSONDecodeError:
        log.error("Claude returned invalid JSON for %s: %s", platform, raw_text[:300])
        raise ValueError(f"LLM returned invalid JSON for {platform}")

    return variants


def regenerate_single_variant(
    source_content: str,
    platform: str,
    label: str,
    context: str | None,
    current_text: str | None = None,
) -> dict:
    """Regenerate a single variant with optional steering context."""
    style = PLATFORM_STYLE_GUIDE.get(platform, PLATFORM_STYLE_GUIDE["linkedin"])
    strategy = VARIANT_STRATEGIES.get(label, VARIANT_STRATEGIES["A"])

    context_instruction = ""
    if context:
        context_instruction = f"\n## Additional Direction\n{context}\n"
    if current_text:
        context_instruction += f"\n## Previous Version (improve upon this)\n{current_text}\n"

    prompt = f"""You are an expert social media content strategist. Regenerate a single variant for {platform}.

## Source Content
{source_content}

## Target Platform: {platform.upper()}

## Platform Style Guide
{style}

## Variant Strategy ({label})
{strategy}
{context_instruction}
## Requirements
1. Preserve the core message but adapt for {platform}
2. Make this feel native to the platform
3. If additional direction is given, incorporate it

## Output Format
Return valid JSON (no markdown fencing):
{{
  "label": "{label}",
  "text": "The adapted post text...",
  "rationale": "Why this variant works..."
}}"""

    response = _call_claude(
        model="claude-sonnet-4-5-20250929",
        max_tokens=1000,
        messages=[{"role": "user", "content": prompt}],
    )

    raw_text = response.content[0].text.strip()
    raw_text = _strip_code_fences(raw_text)
    try:
        return json.loads(raw_text)
    except json.JSONDecodeError:
        log.error("Claude returned invalid JSON on regen: %s", raw_text[:300])
        raise ValueError("LLM returned invalid JSON for regeneration")


def analyze_account_posts(posts: list[dict], platform: str) -> dict:
    """Use Claude to analyze imported posts and generate inferences including visual analysis."""
    empty = {
        "top_formats": [],
        "best_times": [],
        "hook_performance": [],
        "audience_signals": [],
        "visual_content_insights": {},
    }
    if not posts:
        return empty

    # Build rich post descriptions including visual analysis
    post_lines = []
    for p in posts[:30]:
        line = (
            f"- [{p.get('type', 'text')}] ({p.get('date', 'unknown')}) "
            f"Engagement: {p.get('engagement', {}).get('total', 0)} — "
            f"{p.get('text', '')[:200]}"
        )
        ma = p.get("media_analysis", {})
        if ma:
            descs = ma.get("visual_descriptions", [])
            ctypes = ma.get("content_types", [])
            themes = ma.get("visual_themes", [])
            mood = ma.get("mood", "")
            overlays = ma.get("text_overlays", [])
            if descs:
                line += f" | Visual: {descs[0][:100]}"
            if ctypes:
                line += f" | Content type: {', '.join(ctypes)}"
            if themes:
                line += f" | Themes: {', '.join(themes[:4])}"
            if mood:
                line += f" | Mood: {mood}"
            if overlays and overlays[0]:
                line += f" | Text overlay: {overlays[0][:60]}"
        post_lines.append(line)

    posts_text = "\n".join(post_lines)

    has_visual = any(p.get("media_analysis") for p in posts)
    visual_section = ""
    if has_visual:
        visual_section = """
  "visual_content_insights": {
    "dominant_visual_style": "Description of the dominant visual aesthetic",
    "top_content_types": ["content_type1 (XX%)", "content_type2 (XX%)", "content_type3 (XX%)"],
    "visual_themes": ["theme1", "theme2", "theme3"],
    "brand_consistency_score": "high/medium/low — explain why",
    "visual_vs_text_performance": "How visual posts perform vs text-only",
    "recommendations": ["actionable visual content rec 1", "rec 2", "rec 3"]
  },"""

    prompt = f"""Analyze these {platform} posts and provide comprehensive content intelligence insights.
Posts include text, engagement metrics, and visual analysis of images/videos where available.

## Posts
{posts_text}

## Task
Analyze patterns across text AND visual content. Return actionable insights as JSON:

{{{visual_section}
  "top_formats": ["format1 (avg engagement: N)", "format2 (avg engagement: N)", "format3 (avg engagement: N)"],
  "best_times": ["Day/period1 (engagement)", "Day/period2 (engagement)", "Day/period3 (engagement)"],
  "hook_performance": ["Hook style1: +XX% (why)", "Hook style2: +XX% (why)", "Hook style3: +XX% (why)"],
  "audience_signals": ["Audience segment1 (XX%)", "Audience segment2 (XX%)", "Audience segment3 (XX%)"],
  "summary": "A 3-sentence summary covering both text and visual content performance patterns."
}}

Return valid JSON only, no markdown fencing."""

    response = _call_claude(
        model="claude-sonnet-4-5-20250929",
        max_tokens=2000,
        messages=[{"role": "user", "content": prompt}],
    )

    raw_text = response.content[0].text.strip()
    raw_text = _strip_code_fences(raw_text)
    try:
        result = json.loads(raw_text)
        if "visual_content_insights" not in result:
            result["visual_content_insights"] = {}
        return result
    except json.JSONDecodeError:
        log.warning("Could not parse inference JSON: %s", raw_text[:200])
        return empty


# ---------------------------------------------------------------------------
#  LangGraph-powered brand voice generation
# ---------------------------------------------------------------------------

def _make_voice_tools(posts: list[dict]):
    """
    Factory that creates LangChain @tool functions closed over the post data.
    Returns a list of tool callables for the LangGraph agent.
    """
    from langchain_core.tools import tool as lc_tool

    @lc_tool
    def analyze_top_posts(platform: str = "", limit: int = 10) -> str:
        """Retrieve top-performing posts ranked by engagement.
        Can filter by platform (linkedin, x, instagram, facebook).
        Returns the highest-engagement posts with full text, metrics, and media analysis."""
        limit = min(limit, 20)
        filtered = posts
        if platform:
            filtered = [p for p in posts if p.get("platform") == platform]

        def _eng(p: dict) -> int:
            eng = p.get("engagement", {})
            return eng.get("total", 0) if isinstance(eng, dict) else 0

        ranked = sorted(filtered, key=_eng, reverse=True)[:limit]

        results = []
        for i, p in enumerate(ranked):
            entry = {
                "rank": i + 1,
                "platform": p.get("platform", "unknown"),
                "date": p.get("date", "unknown"),
                "type": p.get("type", "text"),
                "text": p.get("text", "")[:500],
                "engagement": p.get("engagement", {}),
                "has_media": bool(p.get("media")),
            }
            ma = p.get("media_analysis", {})
            if ma:
                entry["visual_themes"] = ma.get("visual_themes", [])
                entry["content_types"] = ma.get("content_types", [])
            results.append(entry)

        return json.dumps({
            "total_posts_in_filter": len(filtered),
            "showing": len(results),
            "platform_filter": platform or "all",
            "top_posts": results,
        }, indent=2)

    @lc_tool
    def get_engagement_stats(group_by: str = "all") -> str:
        """Get aggregated engagement statistics.
        group_by: 'platform' | 'type' | 'all'."""
        def _compute(post_list: list[dict]) -> dict:
            engagements, likes, comments, shares = [], [], [], []
            for p in post_list:
                eng = p.get("engagement", {})
                if isinstance(eng, dict):
                    engagements.append(eng.get("total", 0))
                    likes.append(eng.get("likes", 0))
                    comments.append(eng.get("comments", 0))
                    shares.append(eng.get("shares", 0))
            n = len(engagements) or 1
            return {
                "post_count": len(post_list),
                "total_engagement": sum(engagements),
                "avg_engagement": round(sum(engagements) / n, 1),
                "max_engagement": max(engagements, default=0),
                "avg_likes": round(sum(likes) / n, 1),
                "avg_comments": round(sum(comments) / n, 1),
                "avg_shares": round(sum(shares) / n, 1),
            }

        if group_by == "platform":
            groups: dict[str, list] = {}
            for p in posts:
                groups.setdefault(p.get("platform", "unknown"), []).append(p)
            return json.dumps(
                {"grouped_by": "platform", "stats": {k: _compute(v) for k, v in groups.items()}},
                indent=2,
            )
        elif group_by == "type":
            groups = {}
            for p in posts:
                groups.setdefault(p.get("type", "text"), []).append(p)
            return json.dumps(
                {"grouped_by": "type", "stats": {k: _compute(v) for k, v in groups.items()}},
                indent=2,
            )
        else:
            return json.dumps({"grouped_by": "all", "stats": _compute(posts)}, indent=2)

    return [analyze_top_posts, get_engagement_stats]


# ---------------------------------------------------------------------------
#  Message format converters: LangChain <-> Anthropic native API
# ---------------------------------------------------------------------------

def _langchain_to_anthropic(messages: list) -> tuple[str, list[dict]]:
    """
    Convert LangChain message objects into Anthropic API format.
    Returns (system_text, anthropic_messages).
    Preserves raw content blocks (server tool results, compaction blocks)
    stored in additional_kwargs for lossless round-tripping.
    """
    system_text = ""
    anthropic_msgs: list[dict] = []

    i = 0
    while i < len(messages):
        msg = messages[i]

        if msg.type == "system":
            system_text = msg.content
            i += 1
            continue

        if msg.type == "human":
            anthropic_msgs.append({"role": "user", "content": msg.content})
            i += 1
            continue

        if msg.type == "ai":
            raw_blocks = (msg.additional_kwargs or {}).get("raw_content_blocks")
            if raw_blocks:
                anthropic_msgs.append({"role": "assistant", "content": raw_blocks})
            else:
                blocks: list[dict] = []
                if msg.content:
                    blocks.append({"type": "text", "text": msg.content})
                for tc in (msg.tool_calls or []):
                    blocks.append({
                        "type": "tool_use",
                        "id": tc["id"],
                        "name": tc["name"],
                        "input": tc["args"],
                    })
                anthropic_msgs.append({
                    "role": "assistant",
                    "content": blocks or msg.content,
                })
            i += 1
            continue

        if msg.type == "tool":
            tool_results: list[dict] = []
            while i < len(messages) and messages[i].type == "tool":
                tm = messages[i]
                tool_results.append({
                    "type": "tool_result",
                    "tool_use_id": tm.tool_call_id,
                    "content": tm.content,
                })
                i += 1
            anthropic_msgs.append({"role": "user", "content": tool_results})
            continue

        i += 1

    return system_text, anthropic_msgs


def _anthropic_to_langchain(response, local_tool_names: set[str]):
    """
    Convert an Anthropic API response into a LangChain AIMessage.
    Local tool_use blocks (matching local_tool_names) become tool_calls;
    all content blocks are preserved as raw_content_blocks for round-tripping
    so server tool results and compaction blocks survive the conversion.
    """
    from langchain_core.messages import AIMessage

    text_parts: list[str] = []
    tool_calls: list[dict] = []
    raw_blocks: list[dict] = []

    for block in response.content:
        serialized = block.model_dump() if hasattr(block, "model_dump") else dict(block)
        raw_blocks.append(serialized)

        block_type = getattr(block, "type", None)
        if block_type == "text":
            text_parts.append(block.text)
        elif block_type == "tool_use" and block.name in local_tool_names:
            tool_calls.append({
                "name": block.name,
                "args": block.input,
                "id": block.id,
                "type": "tool_call",
            })

    return AIMessage(
        content="\n".join(text_parts),
        tool_calls=tool_calls,
        additional_kwargs={"raw_content_blocks": raw_blocks},
        response_metadata={"stop_reason": response.stop_reason},
    )


def _lc_tool_to_anthropic_schema(tool) -> dict:
    """Convert a LangChain @tool into Anthropic's tool definition format."""
    schema = tool.args_schema.model_json_schema() if tool.args_schema else {
        "type": "object", "properties": {},
    }
    schema.pop("title", None)
    schema.pop("description", None)
    return {
        "name": tool.name,
        "description": tool.description,
        "input_schema": schema,
    }


# ---------------------------------------------------------------------------
#  Hybrid LangGraph + Claude native API: voice graph builder
# ---------------------------------------------------------------------------

VOICE_MODEL = "claude-sonnet-4-5-20250929"
VOICE_BETAS = ["context-management-2025-06-27"]


def _build_voice_graph(local_tools: list):
    """
    Construct a LangGraph StateGraph using Claude's native API
    (with context editing, prompt caching, and web_search server tool)
    inside LangGraph's orchestration layer (tracing, ToolNode, routing).
    """
    from langgraph.graph import StateGraph, END
    from langgraph.graph.message import MessagesState  # used as StateGraph arg
    from langgraph.prebuilt import ToolNode

    local_tool_names = {t.name for t in local_tools}
    tool_schemas = [_lc_tool_to_anthropic_schema(t) for t in local_tools]

    def agent_node(state):
        client = _get_client()
        system_text, anthropic_msgs = _langchain_to_anthropic(state["messages"])

        system_blocks = []
        if system_text:
            system_blocks.append({
                "type": "text",
                "text": system_text,
                "cache_control": {"type": "ephemeral"},
            })

        response = _with_retries(lambda: client.beta.messages.create(
            model=VOICE_MODEL,
            system=system_blocks,
            messages=anthropic_msgs,
            tools=[
                {"type": "web_search_20250305", "name": "web_search", "max_uses": 5},
                *tool_schemas,
            ],
            max_tokens=4096,
            betas=VOICE_BETAS,
            context_management={
                "edits": [
                    {"type": "clear_tool_uses_20250919"},
                    # To enable compaction (requires Sonnet 4.6+ / Opus 4.6):
                    # 1. Add "compact-2026-01-12" to VOICE_BETAS
                    # 2. Uncomment: {"type": "compact_20260112", "trigger": {"input_tokens": 100000}},
                ]
            },
        ))

        return {"messages": [_anthropic_to_langchain(response, local_tool_names)]}

    tool_node = ToolNode(tools=local_tools)

    def should_continue(state):
        last = state["messages"][-1]
        if hasattr(last, "tool_calls") and last.tool_calls:
            return "tools"
        return END

    graph = StateGraph(MessagesState)
    graph.add_node("agent", agent_node)
    graph.add_node("tools", tool_node)
    graph.set_entry_point("agent")
    graph.add_conditional_edges("agent", should_continue, {"tools": "tools", END: END})
    graph.add_edge("tools", "agent")

    return graph.compile()


def generate_brand_voice(
    posts: list[dict],
    name: str,
    purpose: str,
    org_name: str = "",
    account_handles: list[dict] | None = None,
) -> dict:
    """
    Agentic brand voice generation: LangGraph orchestration + Claude native API.
    Uses Claude's server-side web_search + local tools for post analysis,
    with context editing for lean agent loops and prompt caching.
    """
    from langchain_core.messages import SystemMessage, HumanMessage

    empty_result = {
        "attributes": {},
        "avoid_list": [],
        "description": f"Brand voice '{name}' — no training posts available.",
        "consistency_score": 0,
    }
    if not posts:
        return empty_result

    api_key = _get_api_key()
    if not api_key:
        raise RuntimeError("ANTHROPIC_API_KEY is not set.")

    local_tools = _make_voice_tools(posts)
    app = _build_voice_graph(local_tools)

    handles_info = ""
    if account_handles:
        parts = [f"  - {h['platform']}: @{h['handle']}" for h in account_handles]
        handles_info = "\n## Source Accounts\n" + "\n".join(parts)

    system_prompt = f"""You are an expert brand voice analyst building a comprehensive brand voice profile.

## Voice Name: {name}
## Purpose: {purpose}
## Organization: {org_name or 'Unknown'}
{handles_info}
## Total Posts Available: {len(posts)}

You have access to tools to help you analyze the brand's voice. Use them strategically:

1. FIRST call `get_engagement_stats` to understand what content performs best across platforms.
2. THEN call `analyze_top_posts` (optionally per platform) to study the highest-performing content in detail.
3. THEN use the web_search tool to find public information about the organization — their website tone, blog posts, press releases, mission statement, or recent news that could inform voice recommendations.

After gathering enough data, produce your final brand voice profile as a JSON object with this EXACT structure:
{{
  "attributes": {{
    "formality": <0-100>,
    "confidence": <0-100>,
    "warmth": <0-100>,
    "technical_depth": <0-100>,
    "storytelling": <0-100>,
    "humor": <0-100>,
    "urgency": <0-100>,
    "authority": <0-100>
  }},
  "tone_descriptors": ["3-5 adjectives"],
  "vocabulary_patterns": ["common phrases or word choices observed"],
  "structure_patterns": ["how posts are typically structured"],
  "avoid_list": ["things this voice avoids"],
  "description": "A 3-4 sentence combined brand description synthesizing social media presence and public information. Explain what the brand does, how it communicates, and what makes its voice distinctive.",
  "consistency_score": <0-100>,
  "platform_nuances": {{
    "linkedin": "how the voice adapts for LinkedIn",
    "x": "how it adapts for X/Twitter",
    "instagram": "how it adapts for Instagram",
    "facebook": "how it adapts for Facebook"
  }},
  "web_research_notes": "Brief summary of what you found from web research and how it influenced your analysis.",
  "top_performing_patterns": "Description of patterns in the highest-engagement content and why they work."
}}"""

    messages = [
        SystemMessage(content=system_prompt),
        HumanMessage(content=(
            "Analyze this brand's voice using the available tools. "
            "Start by understanding engagement patterns, then study top posts, "
            "then research the brand online. "
            "Finally, produce the complete brand voice profile as JSON."
        )),
    ]

    log.info("Starting LangGraph voice agent for '%s' (%d posts)", name, len(posts))
    result = app.invoke({"messages": messages})

    final_msg = result["messages"][-1]
    raw_text = final_msg.content if isinstance(final_msg.content, str) else ""
    if not raw_text and isinstance(final_msg.content, list):
        raw_text = "".join(
            block.get("text", "") if isinstance(block, dict) else getattr(block, "text", "")
            for block in final_msg.content
        )

    log.info("Voice agent finished for '%s' — parsing result", name)
    return _parse_voice_json(raw_text, name)


def discover_audience_personas(accounts_data: list[dict]) -> list[dict]:
    """
    Analyze posts + follower data from connected accounts and suggest
    audience personas.  Returns a list of persona dicts ready for the frontend.
    """
    accounts_summary = []
    for acct in accounts_data:
        posts_sample = acct.get("posts", [])[:20]
        posts_text = "\n".join(
            f"- [{p.get('date','')}] ({p.get('engagement',{}).get('total',0)} eng) "
            f"{(p.get('text','') or '')[:200]}"
            for p in posts_sample
        )
        followers = acct.get("follower_data", {}).get("followers", [])
        followers_text = "\n".join(
            f"- {f.get('name','')} | {f.get('headline','')} | signals: {f.get('industry_signals',[])}"
            for f in followers[:10]
        )
        profile = acct.get("profile", {})
        accounts_summary.append(
            f"## {acct['platform'].title()} — @{acct['handle']}\n"
            f"Bio: {profile.get('bio','N/A')}\n"
            f"Followers count: {profile.get('followers',0)}\n\n"
            f"### Recent Posts\n{posts_text or 'No posts available'}\n\n"
            f"### Follower Profiles\n{followers_text or 'No follower data'}\n"
        )

    combined = "\n---\n".join(accounts_summary)

    prompt = f"""You are an audience research expert. Analyze the following social media account data
(posts, engagement patterns, and follower profiles) and suggest 3-5 distinct audience personas
that this creator/brand is attracting.

## Account Data
{combined}

## Task
For each persona, provide:
1. **name**: A short descriptive name (e.g. "Early-Stage Founders", "Marketing Professionals")
2. **description**: 2-3 sentence description of who they are and why they follow
3. **demographics**: JSON object with keys: age_range (str), seniority_level (str), company_size (str), industries (list of str)
4. **interests**: List of 4-8 interest keywords
5. **content_preferences**: JSON object with keys: format (list — e.g. "how-to", "case-study", "opinion"), length ("short"|"medium"|"long"), tone ("casual"|"professional"|"inspirational"|"educational")
6. **goals_and_triggers**: JSON object with keys: goals (list of str), pain_points (list of str), triggers (list — what makes them engage)
7. **tags_positive**: List of content themes they respond well to
8. **tags_negative**: List of content themes to avoid for this audience

Return valid JSON (no markdown fencing):
{{
  "personas": [
    {{
      "name": "...",
      "description": "...",
      "demographics": {{ ... }},
      "interests": ["..."],
      "content_preferences": {{ ... }},
      "goals_and_triggers": {{ ... }},
      "tags_positive": ["..."],
      "tags_negative": ["..."]
    }}
  ]
}}
Return ONLY the JSON."""

    response = _call_claude(
        model="claude-sonnet-4-5-20250929",
        max_tokens=4000,
        messages=[{"role": "user", "content": prompt}],
    )

    raw = _strip_code_fences(response.content[0].text.strip())
    try:
        data = json.loads(raw)
        return data.get("personas", [])
    except json.JSONDecodeError:
        log.error("Failed to parse discover personas JSON: %s", raw[:300])
        return []


def _parse_voice_json(text: str, name: str) -> dict:
    """Extract and parse the JSON voice profile from the agent's final response."""
    text = _strip_code_fences(text)
    json_match = re.search(r"\{[\s\S]*\}", text)
    if json_match:
        try:
            return json.loads(json_match.group())
        except json.JSONDecodeError:
            pass
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        log.error("Could not parse voice profile JSON: %s", text[:300])
        return {
            "attributes": {},
            "avoid_list": [],
            "description": f"Brand voice '{name}' — analysis produced unstructured output.",
            "consistency_score": 0,
        }


def _strip_code_fences(text: str) -> str:
    text = re.sub(r"^```(?:json)?\s*\n?", "", text)
    text = re.sub(r"\n?```\s*$", "", text)
    return text.strip()
