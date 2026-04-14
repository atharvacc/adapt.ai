"""
LangGraph multi-agent workflow engine for per-platform content generation.

Pipeline: planner -> parallel research agents (via Send fan-out) ->
          synthesizer -> validator (with conditional retry).

Research agents are driven by the Writing Persona's enabled_tools
(research activities).
"""
from __future__ import annotations

import json
import logging
import operator
import re
import time
import uuid
from typing import Annotated, Any, TypedDict

from langgraph.graph import StateGraph, START, END
from langgraph.types import Send
from pydantic import BaseModel, Field, ValidationError

from app.db.models import WorkflowAuditLog, WorkflowNodeStateRecord
from app.db.session import SessionLocal

log = logging.getLogger(__name__)

MAX_RETRY_ATTEMPTS = 2

# ─── Pipeline State ──────────────────────────────────────────────────────────

class PipelineState(TypedDict):
    source_content: str
    source_images: list[str]
    source_image_analysis: str
    platform: str
    voice_profile: dict
    persona_profile: dict
    audience_profiles: list[dict]
    rule_set: dict
    preference_summary: str

    research_plan: dict
    active_activities: list[str]
    research_briefs: Annotated[list[dict], operator.add]

    variants: list[dict]
    validation_results: list[dict]
    retry_feedback: list[dict]
    attempt: int

    audit_entries: Annotated[list[dict], operator.add]
    run_id: str
    node_id: str

    # for research worker dispatch
    current_activity: str
    activity_brief: dict


# ─── Structured Contracts ────────────────────────────────────────────────────

class ResearchPlanItem(BaseModel):
    query: str
    focus: str
    why_this_agent: str = ""
    expected_evidence_types: list[str] = Field(default_factory=list)
    success_criteria: str = ""


class EvidenceItem(BaseModel):
    evidence_id: str
    claim: str
    source_type: str = "derived"
    source_ref: str = ""
    snippet: str = ""
    confidence: float = 0.6


class ResearchOutput(BaseModel):
    activity: str
    summary: str
    key_findings: list[EvidenceItem] = Field(default_factory=list)
    recommended_hooks: list[str] = Field(default_factory=list)
    risks: list[str] = Field(default_factory=list)
    rationale: str = ""
    contract_valid: bool = True


class RationaleStruct(BaseModel):
    strategy: str
    audience_fit: str
    voice_alignment: str
    rules_alignment: str
    evidence_links: list[str] = Field(default_factory=list)
    open_questions: list[str] = Field(default_factory=list)


class VariantContract(BaseModel):
    label: str
    text: str
    rationale: str = ""
    hook_type: str = "question"
    consistency_score: int = 75
    rationale_struct: RationaleStruct | None = None
    image_prompt: str = ""


ACTIVITY_CAPABILITIES: dict[str, dict[str, Any]] = {
    "audience_platform": {
        "purpose": "Audience demographics, platform algorithm signals, "
                   "optimal formats, timing, and visual/copy best "
                   "practices.",
        "evidence_types": [
            "audience insight", "algorithm signal",
            "format spec", "timing window",
        ],
    },
    "trends_listening": {
        "purpose": "Trending topics, hashtags, hook/format "
                   "benchmarking, engagement triggers, CTAs, and "
                   "live social conversations.",
        "evidence_types": [
            "trending topic", "hook pattern",
            "engagement trigger", "conversation theme",
        ],
    },
    "competitor_industry": {
        "purpose": "Competitor content analysis, industry news, "
                   "supporting data/stats, and gaps to exploit.",
        "evidence_types": [
            "competitor insight", "industry news",
            "statistic", "gap/angle",
        ],
    },
    "brand_knowledge": {
        "purpose": "Brand voice guidelines, internal rules, "
                   "personal stories, and customer proof points.",
        "evidence_types": [
            "voice guideline", "rule", "story seed",
            "customer proof",
        ],
    },
}


# ─── Helpers ─────────────────────────────────────────────────────────────────

def _make_audit(state: dict, step: str, agent: str, summary: str,
                token_usage: dict | None = None, latency_ms: int = 0,
                status: str = "success") -> dict:
    return {
        "id": str(uuid.uuid4()),
        "run_id": state.get("run_id", ""),
        "node_id": state.get("node_id"),
        "step": step,
        "agent_name": agent,
        "platform": state.get("platform", ""),
        "input_summary": state.get("source_content", "")[:200],
        "output_summary": summary[:500],
        "token_usage": token_usage or {"input": 0, "output": 0},
        "latency_ms": latency_ms,
        "status": status,
    }


_chat_model = None
_chat_model_key = None


def _get_chat_model():
    """Get a ChatAnthropic instance (LangSmith-visible when tracing is on)."""
    global _chat_model, _chat_model_key
    from app.services.llm import _get_api_key
    api_key = _get_api_key()
    if not api_key:
        raise RuntimeError(
            "ANTHROPIC_API_KEY is not set. Add it in Settings or backend/.env."
        )
    if _chat_model is None or api_key != _chat_model_key:
        from langchain_anthropic import ChatAnthropic
        _chat_model = ChatAnthropic(
            model="claude-sonnet-4-20250514",
            api_key=api_key,
            max_retries=3,
        )
        _chat_model_key = api_key
    return _chat_model


def _claude_call(
    system: str,
    user: str,
    max_tokens: int = 2048,
    run_meta: dict | None = None,
) -> tuple[str, dict]:
    """Claude call via ChatAnthropic (auto-traced by LangSmith)."""
    global _chat_model, _chat_model_key
    from langchain_core.messages import SystemMessage, HumanMessage
    import anthropic as _anthropic_mod
    model = _get_chat_model().bind(max_tokens=max_tokens)
    messages = [SystemMessage(content=system), HumanMessage(content=user)]
    config: dict[str, Any] = {}
    if run_meta:
        config["metadata"] = run_meta
    try:
        resp = model.invoke(messages, config=config)
    except _anthropic_mod.AuthenticationError:
        _chat_model = None
        _chat_model_key = None
        model = _get_chat_model().bind(max_tokens=max_tokens)
        resp = model.invoke(messages, config=config)
    usage = {}
    if resp.usage_metadata:
        usage = {
            "input": resp.usage_metadata.get("input_tokens", 0),
            "output": resp.usage_metadata.get("output_tokens", 0),
        }
    return resp.content, usage


def _claude_web_search(
    query: str,
    system: str = "",
    run_meta: dict | None = None,
    max_tokens: int = 4096,
    max_web_uses: int = 8,
    mcp_servers: list[dict] | None = None,
) -> tuple[str, dict]:
    """Claude call with native web_search tool (auto-traced by LangSmith).

    Falls back to raw Anthropic SDK because ChatAnthropic doesn't
    support server-side tools like web_search_20250305.
    """
    from app.services.llm import _get_client, _with_retries
    client = _get_client()
    tools = [{"type": "web_search_20250305", "name": "web_search", "max_uses": max_web_uses}]
    create_kwargs: dict[str, Any] = {
        "model": "claude-sonnet-4-20250514",
        "max_tokens": max_tokens,
        "system": (
            system or
            "You are a research assistant. Provide factual, well-sourced findings."
        ),
        "messages": [{"role": "user", "content": query}],
        "tools": tools,
    }
    if mcp_servers:
        # Anthropic MCP servers are passed via extra_body in this SDK version.
        create_kwargs["extra_body"] = {"mcp_servers": mcp_servers}
    try:
        resp = _with_retries(lambda: client.messages.create(**create_kwargs))
    except Exception:
        if mcp_servers:
            log.warning(
                "Claude MCP server call failed; retrying without MCP servers.",
            )
            create_kwargs.pop("extra_body", None)
            resp = _with_retries(lambda: client.messages.create(**create_kwargs))
        else:
            raise
    text_parts = [b.text for b in resp.content if hasattr(b, "text")]
    usage = {"input": resp.usage.input_tokens, "output": resp.usage.output_tokens}
    return "\n".join(text_parts), usage


# ─── XPOZ MCP Integration ────────────────────────────────────────────────────

XPOZ_MCP_URL = "https://mcp.xpoz.ai/mcp"

XPOZ_PLATFORM_TOOLS: dict[str, list[str]] = {
    "x": [
        "searchTwitterUsers",
        "getTwitterUser",
        "getTwitterUsersByKeywords",
        "getTwitterPostsByKeywords",
        "getTwitterPostsByAuthor",
        "getTwitterPostComments",
        "getTwitterPostQuotes",
        "getTwitterPostRetweets",
        "getTwitterPostInteractingUsers",
        "countTweets",
    ],
    "instagram": [
        "searchInstagramUsers",
        "getInstagramUser",
        "getInstagramUsersByKeywords",
        "getInstagramPostsByKeywords",
        "getInstagramPostsByUser",
        "getInstagramCommentsByPostId",
        "getInstagramPostInteractingUsers",
    ],
    "facebook": [
        "searchFacebookUsers",
        "getFacebookUser",
        "getFacebookUsersByKeywords",
        "getFacebookPostsByKeywords",
        "getFacebookPostsByUser",
        "getFacebookCommentsByPostId",
        "getFacebookPostInteractingUsers",
    ],
}

XPOZ_ACTIVITY_HINTS: dict[str, dict[str, list[str]]] = {
    "audience_platform": {
        "x": [
            "getTwitterUsersByKeywords",
            "getTwitterPostsByKeywords",
            "getTwitterPostInteractingUsers",
        ],
        "instagram": [
            "getInstagramUsersByKeywords",
            "getInstagramPostsByKeywords",
            "getInstagramPostInteractingUsers",
        ],
        "facebook": [
            "getFacebookUsersByKeywords",
            "getFacebookPostsByKeywords",
            "getFacebookPostInteractingUsers",
        ],
    },
    "trends_listening": {
        "x": [
            "getTwitterPostsByKeywords",
            "countTweets",
            "getTwitterPostComments",
        ],
        "instagram": [
            "getInstagramPostsByKeywords",
            "getInstagramCommentsByPostId",
        ],
        "facebook": [
            "getFacebookPostsByKeywords",
            "getFacebookCommentsByPostId",
        ],
    },
    "competitor_industry": {
        "x": [
            "getTwitterPostsByAuthor",
            "getTwitterPostsByKeywords",
            "getTwitterPostQuotes",
        ],
        "instagram": [
            "getInstagramPostsByUser",
            "getInstagramPostsByKeywords",
        ],
        "facebook": [
            "getFacebookPostsByUser",
            "getFacebookPostsByKeywords",
        ],
    },
    "brand_knowledge": {},
}

XPOZ_QUESTION_TEMPLATES: dict[str, dict[str, str]] = {
    "audience_platform": {
        "x": (
            "Search recent tweets about '{topic}' to find: "
            "which user segments engage most, what content "
            "formats get the highest engagement (threads, "
            "images, video), and what posting times drive "
            "the most interaction. Use getTwitterPostsByKeywords "
            "and getTwitterPostInteractingUsers."
        ),
        "instagram": (
            "Search recent Instagram posts about '{topic}' to "
            "find: which creators' audiences engage most, what "
            "formats (carousel, reel, single image) perform best, "
            "and engagement patterns. Use "
            "getInstagramPostsByKeywords and "
            "getInstagramPostInteractingUsers."
        ),
        "facebook": (
            "Search recent Facebook posts about '{topic}' to find: "
            "which audience segments engage most, what content "
            "formats get the highest engagement (links, photos, "
            "videos, groups), and what posting patterns drive "
            "the most interaction. Use getFacebookPostsByKeywords "
            "and getFacebookPostInteractingUsers."
        ),
    },
    "trends_listening": {
        "x": (
            "Find trending conversations and hashtags about "
            "'{topic}' on Twitter/X. Look for: viral hooks, "
            "engagement triggers (polls, hot takes, questions), "
            "and active debates. Use getTwitterPostsByKeywords "
            "and countTweets."
        ),
        "instagram": (
            "Find trending Instagram content about '{topic}'. "
            "Look for: popular hashtags, hook patterns in "
            "captions, and high-engagement comment threads. "
            "Use getInstagramPostsByKeywords."
        ),
        "facebook": (
            "Find trending Facebook content about '{topic}'. "
            "Look for: viral shares, hook patterns in first "
            "lines, trending topics in groups, and high-engagement "
            "comment threads. Use getFacebookPostsByKeywords "
            "and getFacebookCommentsByPostId."
        ),
    },
    "competitor_industry": {
        "x": (
            "Analyze competitor and thought-leader tweets "
            "about '{topic}'. Find: what angles get engagement, "
            "what falls flat, gaps they haven't covered, and "
            "supporting data/stats they reference. Use "
            "getTwitterPostsByKeywords and "
            "getTwitterPostsByAuthor."
        ),
        "instagram": (
            "Analyze competitor Instagram content about "
            "'{topic}'. Find: formats that drive engagement, "
            "captions and hooks used, and content gaps. "
            "Use getInstagramPostsByKeywords and "
            "getInstagramPostsByUser."
        ),
        "facebook": (
            "Analyze competitor Facebook content about "
            "'{topic}'. Find: what hooks and formats drive "
            "engagement, what topics generate shares, gaps in "
            "coverage, and community engagement patterns. "
            "Use getFacebookPostsByKeywords and "
            "getFacebookPostsByUser."
        ),
    },
}


def _xpoz_supported(platform: str, activity: str) -> bool:
    """Check if XPOZ supports the platform for this activity."""
    if platform not in XPOZ_PLATFORM_TOOLS:
        return False
    hints = XPOZ_ACTIVITY_HINTS.get(activity, {})
    return platform in hints and len(hints[platform]) > 0


_xpoz_client = None
_xpoz_client_key = None


def _get_xpoz_api_key() -> str:
    """Fetch XPOZ API key from runtime config store or env settings."""
    from app.core.settings import settings
    from app.core.config_store import get_config
    db = SessionLocal()
    try:
        return get_config(db, "xpoz_api_key") or settings.xpoz_api_key
    finally:
        db.close()


def _get_xpoz_mcp_server() -> dict[str, Any] | None:
    """Build Anthropic MCP server config for XPOZ."""
    api_key = _get_xpoz_api_key()
    if not api_key:
        return None
    return {
        "type": "url",
        "name": "xpoz",
        "url": XPOZ_MCP_URL,
        "authorization_token": api_key,
    }


def _get_xpoz_client():
    """Lazy-init an MCP HTTP client for XPOZ."""
    global _xpoz_client, _xpoz_client_key
    api_key = _get_xpoz_api_key()

    if not api_key:
        log.warning(
            "XPOZ API key is missing. Set xpoz_api_key in Settings or backend/.env.",
        )
        return None

    if _xpoz_client is not None and api_key == _xpoz_client_key:
        return _xpoz_client
    try:
        import httpx
        _xpoz_client = httpx.Client(
            base_url=XPOZ_MCP_URL,
            timeout=30.0,
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {api_key}",
            },
        )
        _xpoz_client_key = api_key
        return _xpoz_client
    except Exception:
        log.exception("Failed to create XPOZ MCP client")
        return None


def _xpoz_call_tool(
    tool_name: str,
    arguments: dict,
    run_meta: dict | None = None,
) -> str | None:
    """Call a single XPOZ MCP tool. Returns text or None on failure."""
    client = _get_xpoz_client()
    if client is None:
        return None
    try:
        payload = {
            "jsonrpc": "2.0",
            "id": str(uuid.uuid4()),
            "method": "tools/call",
            "params": {
                "name": tool_name,
                "arguments": arguments,
            },
        }
        resp = client.post("", json=payload)
        resp.raise_for_status()
        data = resp.json()
        result = data.get("result", {})
        content = result.get("content", [])
        text_parts = []
        for block in content:
            if isinstance(block, dict) and block.get("type") == "text":
                text_parts.append(block["text"])
            elif isinstance(block, str):
                text_parts.append(block)
        combined = "\n".join(text_parts)
        if run_meta:
            log.info(
                "XPOZ tool=%s platform=%s returned %d chars",
                tool_name,
                run_meta.get("platform", "?"),
                len(combined),
            )
        return combined if combined.strip() else None
    except Exception:
        log.exception("XPOZ MCP call failed: tool=%s", tool_name)
        return None


def _xpoz_research(
    platform: str,
    activity: str,
    topic: str,
    run_meta: dict | None = None,
) -> str | None:
    """Run an XPOZ query for the given activity and platform.
    Returns raw text context or None if unsupported/failed."""
    if not _xpoz_supported(platform, activity):
        return None

    hints = XPOZ_ACTIVITY_HINTS.get(activity, {}).get(platform, [])
    primary_tool = hints[0] if hints else None
    if not primary_tool:
        return None

    template = (
        XPOZ_QUESTION_TEMPLATES.get(activity, {}).get(platform, "")
    )
    query_text = template.format(topic=topic) if template else topic

    kw_tools = {
        "getTwitterPostsByKeywords",
        "getInstagramPostsByKeywords",
        "getFacebookPostsByKeywords",
    }
    user_tools = {
        "getTwitterUsersByKeywords",
        "getInstagramUsersByKeywords",
        "getFacebookUsersByKeywords",
    }
    author_tools = {
        "getTwitterPostsByAuthor",
        "getInstagramPostsByUser",
        "getFacebookPostsByUser",
    }

    if primary_tool in kw_tools:
        args = {"query": topic, "count": 20}
    elif primary_tool in user_tools:
        args = {"query": topic, "count": 10}
    elif primary_tool in author_tools:
        args = {"username": topic, "count": 15}
    elif primary_tool == "countTweets":
        args = {"query": topic}
    else:
        args = {"query": topic, "count": 15}

    result = _xpoz_call_tool(primary_tool, args, run_meta=run_meta)
    if not result:
        return None

    if len(hints) > 1:
        secondary = hints[1]
        if secondary in kw_tools:
            extra = _xpoz_call_tool(
                secondary, {"query": topic, "count": 10},
                run_meta=run_meta,
            )
            if extra:
                result = f"{result}\n\n--- Additional ({secondary}) ---\n{extra}"

    return result


def _meta(state: dict) -> dict:
    """Extract trace metadata from pipeline state for LangSmith tagging."""
    return {
        "run_id": state.get("run_id", ""),
        "node_id": state.get("node_id", ""),
        "platform": state.get("platform", ""),
    }


def _rag_retrieve(query: str, entity_type: str, top_k: int = 5) -> list[dict]:
    """RAG retrieval from the vector store."""
    try:
        from app.services.embeddings import retrieve
        db = SessionLocal()
        try:
            return retrieve(db, query, filters={"entity_type": entity_type}, top_k=top_k)
        finally:
            db.close()
    except Exception:
        log.exception("RAG retrieval failed for entity_type=%s", entity_type)
        return []


def _parse_json(text: str, fallback: Any = None) -> Any:
    """Extract JSON from Claude's response text."""
    try:
        match = re.search(r'[\[{].*[\]}]', text, re.DOTALL)
        if match:
            return json.loads(match.group())
    except json.JSONDecodeError:
        pass
    return fallback


def _normalize_research_contract(
    activity: str,
    payload: dict[str, Any],
) -> dict[str, Any]:
    """Coerce worker outputs into a strict explainability contract.

    Handles both contract-conforming outputs (summary, key_findings, etc.)
    and domain-specific outputs (audience_insights, trending_topics, etc.)
    by extracting and converting domain keys into standardized findings.
    """
    summary = str(payload.get("summary") or "")[:2000]
    rationale = str(payload.get("rationale") or "")[:2000]
    hooks = payload.get("recommended_hooks")
    risks = payload.get("risks")

    # ── Extract findings from explicit key_findings first ────────────
    findings: list[dict[str, Any]] = []
    raw_findings = payload.get("key_findings")
    if isinstance(raw_findings, list):
        for i, item in enumerate(raw_findings[:12], start=1):
            if isinstance(item, dict):
                findings.append({
                    "evidence_id": item.get("evidence_id") or f"{activity}:{i}",
                    "claim": str(item.get("claim") or item.get("snippet") or ""),
                    "source_type": str(item.get("source_type") or "derived"),
                    "source_ref": str(item.get("source_ref") or ""),
                    "snippet": str(item.get("snippet") or ""),
                    "confidence": float(item.get("confidence") or 0.6),
                })
            elif isinstance(item, str):
                findings.append({
                    "evidence_id": f"{activity}:{i}",
                    "claim": item,
                    "source_type": "derived",
                    "source_ref": "",
                    "snippet": item[:400],
                    "confidence": 0.6,
                })

    # ── Fallback: extract from domain-specific keys ──────────────────
    # Workers return keys like audience_insights, trending_topics, etc.
    # Convert these into standardized findings.
    _SKIP_KEYS = {
        "summary", "rationale", "key_findings", "recommended_hooks",
        "risks", "_research_source", "error", "contract_valid",
        "raw_payload", "activity",
    }
    if not findings:
        idx = 1
        for key, value in payload.items():
            if key in _SKIP_KEYS:
                continue
            category = key.replace("_", " ").title()
            if isinstance(value, list):
                for item in value[:6]:
                    text = str(item.get("claim", "")) if isinstance(item, dict) else str(item)
                    if not text.strip():
                        text = json.dumps(item)[:400] if isinstance(item, dict) else str(item)[:400]
                    source_ref = ""
                    if isinstance(item, dict):
                        source_ref = str(item.get("source", item.get("source_ref", item.get("url", ""))))
                    findings.append({
                        "evidence_id": f"{activity}:{idx}",
                        "claim": text[:600],
                        "source_type": category,
                        "source_ref": source_ref,
                        "snippet": text[:400],
                        "confidence": 0.7,
                    })
                    idx += 1
            elif isinstance(value, str) and len(value.strip()) > 10:
                findings.append({
                    "evidence_id": f"{activity}:{idx}",
                    "claim": value[:600],
                    "source_type": category,
                    "source_ref": "",
                    "snippet": value[:400],
                    "confidence": 0.7,
                })
                idx += 1
            elif isinstance(value, dict):
                for sub_key, sub_val in value.items():
                    text = str(sub_val)[:600] if sub_val else ""
                    if text.strip():
                        findings.append({
                            "evidence_id": f"{activity}:{idx}",
                            "claim": f"{sub_key.replace('_', ' ').title()}: {text}",
                            "source_type": category,
                            "source_ref": "",
                            "snippet": text[:400],
                            "confidence": 0.6,
                        })
                        idx += 1

    if not findings:
        base_claim = summary or rationale or "No specific findings extracted."
        findings = [{
            "evidence_id": f"{activity}:1",
            "claim": base_claim[:600],
            "source_type": "derived",
            "source_ref": "",
            "snippet": base_claim[:400],
            "confidence": 0.5,
        }]

    # ── Build summary from domain content if not explicitly provided ──
    if not summary:
        summary_parts: list[str] = []
        for key, value in payload.items():
            if key in _SKIP_KEYS:
                continue
            if isinstance(value, str) and len(value) > 20:
                summary_parts.append(value[:300])
            elif isinstance(value, list) and value:
                first_items = value[:3]
                for item in first_items:
                    text = str(item) if isinstance(item, str) else (
                        item.get("claim", item.get("insight", str(item)))
                        if isinstance(item, dict) else str(item)
                    )
                    summary_parts.append(str(text)[:200])
        summary = " | ".join(summary_parts)[:2000] if summary_parts else (
            findings[0]["claim"][:500] if findings else "Research completed."
        )

    # ── Extract hooks from domain-specific keys if not provided ──────
    if not isinstance(hooks, list) or not hooks:
        hooks = []
        hook_keys = {"hook_patterns", "engagement_triggers", "optimal_formats",
                     "recommended_hooks", "hooks"}
        for hk in hook_keys:
            raw_hooks = payload.get(hk)
            if isinstance(raw_hooks, list):
                for h in raw_hooks[:4]:
                    text = str(h) if isinstance(h, str) else (
                        h.get("pattern", h.get("hook", h.get("format", str(h))))
                        if isinstance(h, dict) else str(h)
                    )
                    hooks.append(str(text)[:200])

    # ── Extract risks from domain-specific keys if not provided ──────
    if not isinstance(risks, list) or not risks:
        risks = []
        risk_keys = {"risks", "gaps_to_exploit", "warnings", "concerns"}
        for rk in risk_keys:
            raw_risks = payload.get(rk)
            if isinstance(raw_risks, list):
                for r in raw_risks[:4]:
                    text = str(r) if isinstance(r, str) else (
                        r.get("risk", r.get("gap", str(r)))
                        if isinstance(r, dict) else str(r)
                    )
                    risks.append(str(text)[:200])

    merged = {
        "activity": activity,
        "summary": summary,
        "key_findings": findings[:12],
        "recommended_hooks": hooks[:8],
        "risks": risks[:6],
        "rationale": rationale or "Research synthesized from available context.",
        "contract_valid": True,
    }
    try:
        return ResearchOutput.model_validate(merged).model_dump()
    except ValidationError:
        return {
            "activity": activity,
            "summary": str(summary)[:500],
            "key_findings": findings[:3],
            "recommended_hooks": hooks[:3],
            "risks": risks[:3],
            "rationale": "Contract coercion fallback.",
            "contract_valid": False,
        }


def _format_voice_profile(voice: dict, platform: str) -> str:
    """Build a structured, human-readable voice profile for LLM prompts.

    Replaces the old json.dumps(voice)[:800] approach so that every voice
    dimension is represented without arbitrary truncation.
    """
    if not voice:
        return "(No brand voice configured)"

    overrides = voice.get("overrides") or {}
    sections: list[str] = []

    name = voice.get("name")
    if name:
        sections.append(f"Brand: {name}")

    purpose = voice.get("purpose")
    if purpose:
        sections.append(f"Purpose: {purpose}")

    description = voice.get("description")
    if description:
        sections.append(f"Description: {description}")

    attrs = voice.get("attributes") or {}
    if attrs:
        pairs = ", ".join(f"{k}={v}" for k, v in attrs.items())
        sections.append(f"Voice Attributes: {pairs}")

    tone = overrides.get("tone_descriptors") or []
    if tone:
        sections.append(f"Tone: {', '.join(str(t) for t in tone)}")

    avoid = voice.get("avoid_list") or []
    if avoid:
        sections.append(f"Avoid: {', '.join(str(a) for a in avoid)}")

    vocab = overrides.get("vocabulary_patterns") or []
    if vocab:
        items = "\n".join(f'- "{v}"' for v in vocab)
        sections.append(f"Vocabulary Patterns:\n{items}")

    structure = overrides.get("structure_patterns") or []
    if structure:
        items = "\n".join(f'- "{s}"' for s in structure)
        sections.append(f"Structure Patterns:\n{items}")

    nuances = overrides.get("platform_nuances") or {}
    plat_nuance = nuances.get(platform)
    if plat_nuance:
        sections.append(f"Platform Voice ({platform}): {plat_nuance}")

    top_patterns = overrides.get("top_performing_patterns")
    if top_patterns:
        sections.append(f"Top-Performing Content Patterns: {top_patterns}")

    web_notes = overrides.get("web_research_notes")
    if web_notes:
        sections.append(f"Web Research Insights: {web_notes}")

    return "\n\n".join(sections) if sections else "(Brand voice has no data)"


def _format_persona_profile(persona: dict) -> str:
    """Build a structured, human-readable writing persona for LLM prompts."""
    if not persona:
        return "(No writing persona configured)"

    sections: list[str] = []

    name = persona.get("name")
    if name:
        sections.append(f"Persona: {name}")

    desc = persona.get("description")
    if desc:
        sections.append(f"Description: {desc}")

    approach = persona.get("writing_approach")
    if approach:
        sections.append(f"Writing Approach: {approach}")

    tone = persona.get("tone")
    if tone:
        sections.append(f"Tone: {tone}")

    structure = persona.get("structure_preference")
    if structure:
        sections.append(f"Structure Preference: {structure}")

    style_examples = persona.get("style_examples")
    if style_examples:
        if isinstance(style_examples, list):
            items = "\n".join(f'- "{ex}"' for ex in style_examples[:5])
        else:
            items = str(style_examples)
        sections.append(f"Style Examples:\n{items}")

    platform_rules = persona.get("platform_specific_rules") or {}
    if platform_rules:
        for plat, rule in platform_rules.items():
            sections.append(f"Platform Rule ({plat}): {rule}")

    enabled_tools = persona.get("enabled_tools") or []
    if enabled_tools:
        sections.append(f"Research Activities: {', '.join(enabled_tools)}")

    return "\n\n".join(sections) if sections else "(Writing persona has no data)"


def _format_audience_profiles(audiences: list[dict]) -> str:
    """Build a structured, human-readable audience summary for LLM prompts."""
    if not audiences:
        return "(No audience personas configured)"

    blocks: list[str] = []
    for i, aud in enumerate(audiences, 1):
        parts: list[str] = []
        name = aud.get("name", f"Audience {i}")
        parts.append(f"### Audience {i}: {name}")

        desc = aud.get("description")
        if desc:
            parts.append(f"Description: {desc}")

        demo = aud.get("demographics")
        if demo:
            if isinstance(demo, dict):
                pairs = ", ".join(f"{k}: {v}" for k, v in demo.items())
                parts.append(f"Demographics: {pairs}")
            else:
                parts.append(f"Demographics: {demo}")

        interests = aud.get("interests") or aud.get("tags_positive") or []
        if interests:
            parts.append(f"Interests: {', '.join(str(t) for t in interests[:10])}")

        pain_points = aud.get("pain_points") or aud.get("tags_negative") or []
        if pain_points:
            parts.append(f"Pain Points / Avoid: {', '.join(str(t) for t in pain_points[:10])}")

        platforms = aud.get("platforms") or []
        if platforms:
            parts.append(f"Active Platforms: {', '.join(platforms)}")

        behavior = aud.get("behavior_notes") or aud.get("notes")
        if behavior:
            parts.append(f"Behavior Notes: {behavior}")

        blocks.append("\n".join(parts))

    return "\n\n".join(blocks)


def _format_rule_set(rule_set: dict) -> str:
    """Build a structured, human-readable rule set for LLM prompts."""
    if not rule_set:
        return "(No rule set configured)"

    sections: list[str] = []
    name = rule_set.get("name")
    if name:
        sections.append(f"Rule Set: {name}")

    desc = rule_set.get("description")
    if desc:
        sections.append(f"Description: {desc}")

    rules = rule_set.get("rules") or []
    if rules:
        lines: list[str] = []
        for r in rules:
            if isinstance(r, dict):
                enforcement = r.get("enforcement", "suggested")
                rname = r.get("name", "Unnamed")
                rdesc = r.get("description") or r.get("condition", "")
                lines.append(f"- [{enforcement.upper()}] {rname}: {rdesc}")
        if lines:
            sections.append("Rules:\n" + "\n".join(lines))

    return "\n\n".join(sections) if sections else "(Rule set has no data)"


# ─── 0. Source Image Analyzer ────────────────────────────────────────────────

def _analyze_source_images_vision(  # noqa: C901
    image_urls: list[str],
) -> str:
    """Use Claude Vision to describe source images in detail."""
    import base64
    import httpx

    content_blocks: list[dict] = []
    for url in image_urls[:4]:
        try:
            if url.startswith("data:"):
                mt, b64 = url.split(",", 1)
                media_type = mt.split(":")[1].split(";")[0]
                content_blocks.append({
                    "type": "image",
                    "source": {
                        "type": "base64",
                        "media_type": media_type,
                        "data": b64,
                    },
                })
                continue
            resp = httpx.get(url, timeout=15, follow_redirects=True)
            if resp.status_code != 200:
                continue
            ct = resp.headers.get(
                "content-type", "image/jpeg"
            ).split(";")[0].strip()
            if ct not in (
                "image/jpeg", "image/png",
                "image/gif", "image/webp",
            ):
                ct = "image/jpeg"
            b64 = base64.b64encode(resp.content).decode()
            if len(b64) > 5_000_000:
                continue
            content_blocks.append({
                "type": "image",
                "source": {
                    "type": "base64",
                    "media_type": ct,
                    "data": b64,
                },
            })
        except Exception:
            log.debug("Failed to fetch source image: %s", url[:80])

    if not content_blocks:
        return ""

    content_blocks.append({
        "type": "text",
        "text": (
            "Describe each image in detail: subject, composition, "
            "color palette, mood, style, text/logos visible, and "
            "anything notable. Be specific so a designer could "
            "recreate a similar image from your description alone."
        ),
    })

    from app.services.llm import _get_client, _with_retries
    client = _get_client()
    resp = _with_retries(lambda: client.messages.create(
        model="claude-sonnet-4-20250514",
        max_tokens=1500,
        messages=[{"role": "user", "content": content_blocks}],
    ))
    return resp.content[0].text


def image_analyzer_agent(state: PipelineState) -> dict:
    """Analyze source images with Claude Vision (runs before planner)."""
    images = state.get("source_images") or []
    if not images:
        return {"source_image_analysis": "", "audit_entries": []}

    start = time.time()
    meta = _meta(state)
    meta["agent"] = "ImageAnalyzer"
    try:
        analysis = _analyze_source_images_vision(images)
    except Exception:
        log.exception("Source image analysis failed")
        analysis = ""

    latency = int((time.time() - start) * 1000)
    return {
        "source_image_analysis": analysis,
        "audit_entries": [_make_audit(
            state, "image_analysis", "ImageAnalyzer",
            f"Analyzed {len(images)} source images",
            latency_ms=latency,
        )],
    }


# ─── 1. Planner Agent ────────────────────────────────────────────────────────

def planner_agent(state: PipelineState) -> dict:
    """Read persona's research activities, produce targeted research queries."""
    start = time.time()

    persona = state.get("persona_profile") or {}
    raw_activities: list[str] = persona.get("enabled_tools", [])
    migrated: set[str] = set()
    for a in raw_activities:
        migrated.add(_OLD_TO_NEW_ACTIVITY.get(a, a))
    activities = sorted(
        migrated & ACTIVITY_HANDLERS.keys(),
    ) if migrated else list(ACTIVITY_HANDLERS.keys())

    voice_ctx = _format_voice_profile(state.get("voice_profile") or {}, state["platform"])
    persona_ctx = _format_persona_profile(persona)
    audience_ctx = _format_audience_profiles(state.get("audience_profiles") or [])
    rules_ctx = _format_rule_set(state.get("rule_set") or {})

    pref_block = ""
    if state.get("preference_summary"):
        pref_block = f"\n\nUser Preference History:\n{state['preference_summary']}"

    capability_registry = "\n".join(
        f"- {k}: {v['purpose']} | evidence={v['evidence_types']}"
        for k, v in ACTIVITY_CAPABILITIES.items()
    )
    system = "You are a content strategy planner. Output valid JSON only."
    user = f"""Given this source content for {state['platform']}:
"{state['source_content'][:800]}"

## Brand Voice
{voice_ctx}

## Writing Persona
{persona_ctx}

## Target Audiences
{audience_ctx}

## Rules
{rules_ctx}
{pref_block}

The writer's research activities are: {json.dumps(activities)}
Agent capability registry:
{capability_registry}

For EACH activity, produce a targeted research query and focus area that
directly addresses the brand voice, audience needs, and persona style above.
Output JSON object where keys are the activity names:
{{
  "activity_name": {{
    "query": "specific search/retrieval query informed by the voice, audience, and persona",
    "focus": "what to look for and why — reference specific voice attributes or audience traits",
    "why_this_agent": "why this activity is best suited given the context",
    "expected_evidence_types": ["type1", "type2"],
    "success_criteria": "what good output looks like for this specific brief"
  }}
}}"""

    meta = _meta(state)
    raw, usage = _claude_call(system, user, max_tokens=1024, run_meta=meta)
    raw_plan = _parse_json(raw, {})
    plan: dict[str, dict] = {}
    for activity in activities:
        item = raw_plan.get(activity, {}) if isinstance(raw_plan, dict) else {}
        if not isinstance(item, dict):
            item = {}
        try:
            valid = ResearchPlanItem.model_validate({
                "query": item.get("query") or activity,
                "focus": item.get("focus") or f"Research {activity} for better adaptation",
                "why_this_agent": item.get("why_this_agent") or "",
                "expected_evidence_types": (
                    item.get("expected_evidence_types")
                    if isinstance(item.get("expected_evidence_types"), list)
                    else ACTIVITY_CAPABILITIES.get(activity, {}).get("evidence_types", [])
                ),
                "success_criteria": item.get("success_criteria") or "",
            })
            plan[activity] = valid.model_dump()
        except ValidationError:
            plan[activity] = ResearchPlanItem(
                query=activity,
                focus=f"Research {activity} for content adaptation",
            ).model_dump()

    latency = int((time.time() - start) * 1000)
    return {
        "research_plan": plan,
        "active_activities": activities,
        "audit_entries": [_make_audit(
            state, "plan", "PlannerAgent",
            f"Planned {len(activities)} research activities",
            usage, latency,
        )],
    }


# ─── 2. Research Worker (dispatches per activity) ────────────────────────────

def _research_audience_platform(state: dict, brief: dict) -> dict:
    """Audience & Platform Intelligence: audience demographics,
    platform algorithm signals, optimal formats, timing, and
    visual/copy best practices."""
    platform = state.get("platform", "linkedin")
    audiences = state.get("audience_profiles", [])
    audience_text = (
        json.dumps(audiences, indent=2)[:2000]
        if audiences else "General audience"
    )
    posts = _rag_retrieve(
        brief.get("query", "audience engagement"), "post", top_k=5,
    )
    post_ctx = "\n".join(
        f"- {p['chunk_text'][:200]}" for p in posts[:4]
    )
    meta = _meta(state)
    meta["agent"] = "research_audience_platform"

    topic = brief.get("query", "audience engagement")
    mcp_servers = None
    if _xpoz_supported(platform, "audience_platform"):
        xpoz_server = _get_xpoz_mcp_server()
        if xpoz_server:
            mcp_servers = [xpoz_server]
    if mcp_servers:
        meta["research_source"] = "xpoz_mcp+claude_web_search"
    else:
        meta["research_source"] = "claude_web_search"

    raw, _ = _claude_web_search(
        f"Research for {platform} content.\n"
        f"Query: {brief.get('query', '')}\n"
        f"Focus: {brief.get('focus', '')}\n\n"
        f"Audience profiles:\n{audience_text}\n\n"
        f"Engagement data from past posts:\n{post_ctx}\n\n"
        f"If XPOZ MCP tools are available, use them for live {platform} evidence.",
        f"You are an audience & platform intelligence analyst "
        f"for {platform}. Research ALL of the following:\n"
        f"1. Audience segments — who engages most and why\n"
        f"2. Platform algorithm — what signals {platform} "
        f"currently rewards (saves, shares, dwell time, etc.)\n"
        f"3. Optimal formats — image vs carousel vs video, "
        f"caption length, CTA placement\n"
        f"4. Timing — best posting windows for the audience\n\n"
        f"Output JSON with EXACTLY these keys:\n"
        f'{{"summary": "2-3 sentence overview of your findings",'
        f' "key_findings": [{{"evidence_id": "aud:1", "claim": "finding text", '
        f'"source_type": "audience insight|algorithm signal|format spec|timing window", '
        f'"source_ref": "URL or source name", "snippet": "supporting detail", '
        f'"confidence": 0.8}}, ...],'
        f' "recommended_hooks": ["hook pattern 1", "hook pattern 2"],'
        f' "risks": ["risk or gap 1"],'
        f' "rationale": "why these findings matter for the content brief"}}',
        run_meta=meta,
        mcp_servers=mcp_servers,
    )
    result = _parse_json(raw, {
        "summary": "Audience & platform research completed.",
        "key_findings": [],
        "recommended_hooks": [],
        "risks": [],
        "rationale": "Audience & platform analysis",
    })
    result["_research_source"] = meta.get("research_source", "unknown")
    return result


def _research_trends_listening(state: dict, brief: dict) -> dict:
    """Trends & Social Listening: trending topics, hashtags,
    hook/format benchmarking, engagement triggers, and CTAs."""
    platform = state.get("platform", "linkedin")
    meta = _meta(state)
    meta["agent"] = "research_trends_listening"

    topic = brief.get("query", f"{platform} trending content")
    mcp_servers = None
    if _xpoz_supported(platform, "trends_listening"):
        xpoz_server = _get_xpoz_mcp_server()
        if xpoz_server:
            mcp_servers = [xpoz_server]
    if mcp_servers:
        meta["research_source"] = "xpoz_mcp+claude_web_search"
    else:
        meta["research_source"] = "claude_web_search"

    raw, _ = _claude_web_search(
        f"Research for {platform} content.\n"
        f"Query: {brief.get('query', '')}\n"
        f"Focus: {brief.get('focus', '')}\n\n"
        f"If XPOZ MCP tools are available, use them for live {platform} trend signals.",
        f"You are a trends & social listening analyst "
        f"for {platform}. Research ALL of the following:\n"
        f"1. Trending topics & hashtags in this niche right "
        f"now — not just viral, but actively engaging\n"
        f"2. Hook & format benchmarking — opening lines, "
        f"storytelling structures, and formats that high-"
        f"performing creators in this space are using\n"
        f"3. Engagement triggers — CTAs, question framing, "
        f"controversial takes, polls, 'tag someone' patterns "
        f"that lower friction to interact\n"
        f"4. Conversations — what people are actively "
        f"discussing and debating in this topic area\n\n"
        f"Output JSON with EXACTLY these keys:\n"
        f'{{"summary": "2-3 sentence overview of current trends",'
        f' "key_findings": [{{"evidence_id": "trend:1", "claim": "finding text", '
        f'"source_type": "trending topic|hook pattern|engagement trigger|conversation theme", '
        f'"source_ref": "URL or source name", "snippet": "supporting detail", '
        f'"confidence": 0.8}}, ...],'
        f' "recommended_hooks": ["specific hook pattern or opening line to use"],'
        f' "risks": ["trend risk or potential backlash"],'
        f' "rationale": "why these trends matter for this content brief"}}',
        run_meta=meta,
        mcp_servers=mcp_servers,
    )
    result = _parse_json(raw, {
        "summary": "Trends & social listening research completed.",
        "key_findings": [],
        "recommended_hooks": [],
        "risks": [],
        "rationale": "Trends & social listening",
    })
    result["_research_source"] = meta.get("research_source", "unknown")
    return result


def _research_competitor_industry(
    state: dict, brief: dict,
) -> dict:
    """Competitor & Industry Analysis: competitor content,
    industry news, data/stats, gaps to exploit, credibility
    sources."""
    platform = state.get("platform", "linkedin")
    query = brief.get("query", "competitor content analysis")
    posts = _rag_retrieve(query, "post", top_k=8)
    post_ctx = "\n".join(
        f"- {p['chunk_text'][:200]}" for p in posts[:5]
    )
    meta = _meta(state)
    meta["agent"] = "research_competitor_industry"

    mcp_servers = None
    if _xpoz_supported(platform, "competitor_industry"):
        xpoz_server = _get_xpoz_mcp_server()
        if xpoz_server:
            mcp_servers = [xpoz_server]
    if mcp_servers:
        meta["research_source"] = "xpoz_mcp+claude_web_search"
    else:
        meta["research_source"] = "claude_web_search"

    raw, _ = _claude_web_search(
        f"Research: {query}\n"
        f"Focus: {brief.get('focus', '')}\n\n"
        f"Known competitor/peer posts:\n{post_ctx}\n\n"
        f"If XPOZ MCP tools are available, use them for live {platform} competitor data.",
        "You are a competitive intelligence and industry "
        "analyst. Research ALL of the following:\n"
        "1. Competitor analysis — what peers and thought "
        "leaders are posting, what gets engagement, what "
        "falls flat, and gaps/angles they haven't covered\n"
        "2. Industry news — recent events, announcements, "
        "shifts that are relevant to the topic\n"
        "3. Data & credibility — supporting statistics, "
        "studies, benchmarks, or case studies that make "
        "claims feel grounded rather than generic\n\n"
        "Output JSON with EXACTLY these keys:\n"
        '{"summary": "2-3 sentence overview of competitive landscape",'
        ' "key_findings": [{"evidence_id": "comp:1", "claim": "finding text", '
        '"source_type": "competitor insight|industry news|statistic|gap/angle", '
        '"source_ref": "URL or source name", "snippet": "supporting detail", '
        '"confidence": 0.8}, ...],'
        ' "recommended_hooks": ["angle or hook inspired by competitor gaps"],'
        ' "risks": ["competitive risk or market concern"],'
        ' "rationale": "why these competitive insights matter for the content brief"}',
        run_meta=meta,
        mcp_servers=mcp_servers,
    )
    result = _parse_json(raw, {
        "summary": "Competitor & industry research completed.",
        "key_findings": [],
        "recommended_hooks": [],
        "risks": [],
        "rationale": "Competitor & industry analysis",
    })
    result["_research_source"] = meta.get("research_source", "unknown")
    return result


def _research_brand_knowledge(state: dict, brief: dict) -> dict:
    """Brand & Internal Knowledge: brand voice, past content,
    personal anecdotes, customer stories, internal guidelines."""
    query = brief.get(
        "query", state.get("source_content", "")[:300],
    )
    voices = _rag_retrieve(query, "voice", top_k=3)
    rules = _rag_retrieve(query, "rule_set", top_k=3)
    personas = _rag_retrieve(query, "persona", top_k=3)
    posts = _rag_retrieve(
        brief.get("query", "customer story personal"), "post",
        top_k=5,
    )
    internal = "\n".join(
        f"[{c['entity_type']}] {c['chunk_text'][:200]}"
        for c in (voices + rules + personas)
    )
    post_ctx = "\n".join(
        f"- {p['chunk_text'][:200]}" for p in posts[:4]
    )
    persona_examples = json.dumps(
        state.get("persona_profile", {}).get(
            "per_platform_config", {},
        ),
        indent=2,
    )[:500]
    meta = _meta(state)
    meta["agent"] = "research_brand_knowledge"
    meta["research_source"] = "rag+claude_call"
    raw, _ = _claude_call(
        "Compile brand & internal knowledge. Research ALL of "
        "the following:\n"
        "1. Voice guidelines — tone, style, words to use "
        "and avoid from brand voice docs\n"
        "2. Rules to enforce — formatting rules, compliance "
        "requirements, content policies\n"
        "3. Personal stories — relevant anecdotes, founder "
        "narratives, or personal experiences from past posts\n"
        "4. Customer proof — customer success stories, "
        "testimonials, and case studies\n\n"
        "Output JSON with EXACTLY these keys:\n"
        '{"summary": "2-3 sentence overview of brand knowledge relevant to this content",'
        ' "key_findings": [{"evidence_id": "brand:1", "claim": "finding text", '
        '"source_type": "voice guideline|rule|story seed|customer proof", '
        '"source_ref": "internal docs", "snippet": "supporting detail", '
        '"confidence": 0.8}, ...],'
        ' "recommended_hooks": ["hook or angle rooted in brand story/proof points"],'
        ' "risks": ["brand consistency risk or guideline concern"],'
        ' "rationale": "why this brand knowledge is relevant to the content brief"}',
        f"Internal knowledge:\n{internal}\n\n"
        f"Past posts:\n{post_ctx}\n\n"
        f"Writing persona examples:\n{persona_examples}\n\n"
        f"Focus: {brief.get('focus', '')}",
        max_tokens=4096,
        run_meta=meta,
    )
    result = _parse_json(raw, {
        "summary": "Brand & internal knowledge compiled.",
        "key_findings": [],
        "recommended_hooks": [],
        "risks": [],
        "rationale": "Brand & internal knowledge",
    })
    result["_research_source"] = meta.get("research_source", "unknown")
    return result


def _research_generic(state: dict, brief: dict) -> dict:
    """Handles custom user-defined activities with web search + RAG."""
    platform = state.get("platform", "linkedin")
    activity = state.get("current_activity", "generic")
    query = brief.get("query", state.get("current_activity", "research"))
    rag_results = _rag_retrieve(query, "post", top_k=3)
    rag_text = "\n".join(f"- {r['chunk_text'][:150]}" for r in rag_results)
    meta = _meta(state)
    meta["agent"] = "research_generic"

    mcp_servers = None
    if _xpoz_supported(platform, activity):
        xpoz_server = _get_xpoz_mcp_server()
        if xpoz_server:
            mcp_servers = [xpoz_server]
    if mcp_servers:
        meta["research_source"] = "xpoz_mcp+claude_web_search"
    else:
        meta["research_source"] = "claude_web_search"

    raw, _ = _claude_web_search(
        f"Research: {query}\nFocus: {brief.get('focus', '')}\n\n"
        f"Existing context:\n{rag_text}\n\n"
        f"If XPOZ MCP tools are available, use them for live {platform} research.",
        "You are a content researcher. Output JSON with: findings, rationale.",
        run_meta=meta,
        mcp_servers=mcp_servers,
    )
    result = _parse_json(raw, {"findings": raw[:500], "rationale": "Generic research"})
    result["_research_source"] = meta.get("research_source", "unknown")
    return result


ACTIVITY_HANDLERS: dict[str, Any] = {
    "audience_platform": _research_audience_platform,
    "trends_listening": _research_trends_listening,
    "competitor_industry": _research_competitor_industry,
    "brand_knowledge": _research_brand_knowledge,
}

_OLD_TO_NEW_ACTIVITY: dict[str, str] = {
    "competitor_analysis": "competitor_industry",
    "industry_news": "competitor_industry",
    "data_research": "competitor_industry",
    "audience_signals": "audience_platform",
    "platform_trends": "audience_platform",
    "social_listening": "trends_listening",
    "personal_experience": "brand_knowledge",
    "internal_knowledge": "brand_knowledge",
    "customer_stories": "brand_knowledge",
}


def _run_research_activity(state: PipelineState, activity: str) -> dict:
    """Run one research activity with consistent audit formatting."""
    start = time.time()
    brief = state.get("activity_brief", {"query": activity, "focus": activity})
    handler = ACTIVITY_HANDLERS.get(activity, _research_generic)
    local_state = {**state, "current_activity": activity}
    research_source = "unknown"
    try:
        raw_result = handler(local_state, brief)
        research_source = raw_result.pop(
            "_research_source", "claude_web_search",
        ) if isinstance(raw_result, dict) else "claude_web_search"
    except Exception:
        log.exception("Research worker failed for activity=%s", activity)
        raw_result = {
            "error": f"Research failed for {activity}",
            "rationale": "Error during research",
        }
        research_source = "error"
    result = _normalize_research_contract(
        activity, raw_result if isinstance(raw_result, dict) else {},
    )

    latency = int((time.time() - start) * 1000)
    source_tag = f" [{research_source}]"
    return {
        "research_briefs": [{"activity": activity, **result}],
        "audit_entries": [_make_audit(
            state, "research", f"Research:{activity}",
            f"{activity}{source_tag}: {json.dumps(result)[:280]}",
            latency_ms=latency,
        )],
    }


def research_worker_node(state: PipelineState) -> dict:
    """Dispatched per activity via Send(). Runs the appropriate handler."""
    activity = state.get("current_activity", "unknown")
    return _run_research_activity(state, activity)


def _named_research_node(activity: str):
    def _node(state: PipelineState) -> dict:
        return _run_research_activity(state, activity)
    return _node


# ─── 3. Synthesizer Agent ───────────────────────────────────────────────────

def synthesizer_agent(state: PipelineState) -> dict:
    """Merge research briefs, generate A/B/C variants + image prompts."""
    start = time.time()
    platform = state["platform"]

    from app.services.llm import PLATFORM_STYLE_GUIDE

    # ── Format research briefs fully (no aggressive truncation) ──────────
    briefs_text = ""
    for brief in state.get("research_briefs", []):
        activity = brief.get("activity", "unknown")
        summary = str(brief.get("summary", ""))[:1500]
        rationale = str(brief.get("rationale", ""))
        findings = brief.get("key_findings", []) if isinstance(
            brief.get("key_findings"), list
        ) else []
        links = []
        for f in findings[:8]:
            if isinstance(f, dict):
                claim = f.get("claim", "")
                snippet = f.get("snippet", "")
                src = f.get("source_ref", "")
                conf = f.get("confidence", 0.6)
                entry = f"- [{f.get('evidence_id', '?')}] {claim}"
                if snippet and snippet != claim:
                    entry += f"\n  Snippet: {snippet[:300]}"
                if src:
                    entry += f"\n  Source: {src}"
                entry += f" (confidence: {conf})"
                links.append(entry)
        link_block = "\n".join(links)
        hooks = brief.get("recommended_hooks", [])
        hooks_line = f"\nRecommended Hooks: {', '.join(str(h) for h in hooks)}" if hooks else ""
        risks = brief.get("risks", [])
        risks_line = f"\nRisks: {', '.join(str(r) for r in risks)}" if risks else ""
        briefs_text += (
            f"\n### {activity}\n{summary}\n"
            f"Evidence:\n{link_block or '- (none)'}"
            f"{hooks_line}{risks_line}\n"
        )

    # ── Format all context using structured helpers (no raw JSON) ────────
    voice_desc = _format_voice_profile(state.get("voice_profile") or {}, platform)
    persona_desc = _format_persona_profile(state.get("persona_profile") or {})
    audience_desc = _format_audience_profiles(state.get("audience_profiles") or [])
    rules_desc = _format_rule_set(state.get("rule_set") or {})

    platform_style = PLATFORM_STYLE_GUIDE.get(platform, PLATFORM_STYLE_GUIDE.get("linkedin", ""))

    retry_block = ""
    if state.get("retry_feedback"):
        failures = "\n".join(
            f"- Variant {f.get('variant_label', '?')}: {f.get('rule_name', '?')} — {f.get('message', '')}"
            for f in state["retry_feedback"]
        )
        retry_block = f"\n\n## VALIDATION FAILURES FROM PREVIOUS ATTEMPT — FIX THESE:\n{failures}"

    pref_block = ""
    if state.get("preference_summary"):
        pref_block = f"\n\n## User Preferences (from past sessions):\n{state['preference_summary']}"

    image_block = ""
    img_analysis = state.get("source_image_analysis") or ""
    has_source_images = bool(state.get("source_images"))
    if img_analysis:
        image_block = (
            f"\n\n## Source Reference Images\n"
            f"The user uploaded {len(state.get('source_images', []))} "
            f"reference image(s). Detailed analysis:\n"
            f"{img_analysis}\n\n"
            f"Your image_prompt MUST describe a variation/adaptation "
            f"of these source visuals for {platform} — keep the same "
            f"subject, style, and brand feel. Do NOT invent unrelated "
            f"imagery."
        )
    elif has_source_images:
        image_block = (
            f"\n\nNote: {len(state['source_images'])} reference "
            f"images are attached. Adapt content to complement them."
        )

    # Prompt order: platform context → voice → persona → audience → rules →
    #               research → preferences → retry → instructions
    system = f"""You are a content adaptation specialist for {platform.upper()}.

## Platform: {platform.upper()}
{platform_style}

## Brand Voice
{voice_desc}

## Writing Persona
{persona_desc}

## Target Audiences
{audience_desc}

## Rules & Constraints
{rules_desc}

## Research Findings
{briefs_text}
{retry_block}{pref_block}{image_block}

## Your Task
Generate exactly 3 variants (A, B, C) adapted for {platform}.
Each variant MUST use a different hook strategy.

CRITICAL INSTRUCTIONS — follow ALL of these:
1. WRITE IN THE BRAND VOICE. Match the tone descriptors, vocabulary patterns,
   and structure patterns from the Brand Voice section above. If vocabulary
   patterns are listed, USE THEM. If structure patterns are listed, FOLLOW THEM.
2. WRITE AS THE PERSONA. Adopt the writing approach, tone, and structure
   preference defined in the Writing Persona section.
3. WRITE FOR THE AUDIENCES. Tailor language complexity, references, and
   pain-point framing to the Target Audiences listed above.
4. OBEY ALL RULES. Every rule marked [REQUIRED] must be satisfied. Rules
   marked [SUGGESTED] should be followed unless they conflict with voice/persona.
5. USE THE RESEARCH. Reference specific findings, data points, and trends from
   the Research Findings section. Cite evidence_ids in your rationale.
6. ADAPT FOR {platform.upper()}. Follow the Platform style guide above for
   format, length, hashtag usage, and structure conventions.

For each variant, provide a DETAILED rationale that:
- References specific evidence_ids from Research Findings that informed the approach
- Explains why this hook type works for the target audience on {platform}
- Notes how brand voice attributes, vocabulary patterns, and structure patterns were incorporated
- Describes persona alignment — how the writing approach and tone match
- Lists which rules were applied and how
- Mentions any platform-specific adaptations applied

Also include:
- image_prompt: a prompt for generating a platform-native image.
  {"IMPORTANT: base this on the source reference images described above — adapt them for " + platform + ", keeping the core subject and feel." if has_source_images else ""}
- rationale_struct object with:
  - strategy: the hook strategy used and why
  - audience_fit: how content matches audience needs and pain points
  - voice_alignment: specific voice attributes, vocabulary, and structure patterns applied
  - rules_alignment: which rules were satisfied and how
  - evidence_links: list of evidence_id values from Research Findings used
  - open_questions: remaining uncertainties or trade-offs

Respond in JSON array format ONLY:
[
  {{
    "label": "A",
    "text": "...",
    "rationale": "...",
    "hook_type": "question|statistic|story|contrarian|list",
    "consistency_score": 85,
    "rationale_struct": {{...}},
    "image_prompt": "A professional, clean image depicting..."
  }},
  ...
]"""

    meta = _meta(state)
    meta["agent"] = "SynthesizerAgent"
    raw, usage = _claude_call(
        system,
        f"Adapt for {platform}:\n\n{state['source_content']}",
        max_tokens=4096,
        run_meta=meta,
    )

    variants_data = _parse_json(raw, [])
    if not isinstance(variants_data, list) or len(variants_data) == 0:
        variants_data = _fallback_variants(
            state["source_content"], platform,
        )
    validated_variants: list[dict[str, Any]] = []
    for v in variants_data:
        if not isinstance(v, dict):
            continue
        try:
            vv = VariantContract.model_validate(v)
            validated_variants.append(vv.model_dump())
        except ValidationError:
            # Best-effort contract repair without dropping generation.
            repaired = {
                "label": v.get("label", "A"),
                "text": v.get("text", ""),
                "rationale": v.get("rationale", ""),
                "hook_type": v.get("hook_type", "question"),
                "consistency_score": v.get("consistency_score", 70),
                "image_prompt": v.get("image_prompt", ""),
                "rationale_struct": {
                    "strategy": "General strategy from synthesized context",
                    "audience_fit": "Aligned to selected audience",
                    "voice_alignment": "Aligned to selected voice profile",
                    "rules_alignment": "Checked against current ruleset",
                    "evidence_links": [],
                    "open_questions": [],
                },
            }
            try:
                validated_variants.append(
                    VariantContract.model_validate(repaired).model_dump()
                )
            except ValidationError:
                pass
    if not validated_variants:
        validated_variants = _fallback_variants(state["source_content"], platform)

    source_imgs = state.get("source_images") or []
    gen_meta = {**meta, "step": "media_generation"}

    from app.services.image_gen import (
        generate_image,
        build_image_prompt_via_llm,
    )

    research_briefs_raw = state.get("research_briefs") or []

    # ── Media Voting: decide whether to generate images ────────────────
    # If source has images → always generate images for all platforms.
    has_source_images = bool(source_imgs)
    generate_images = has_source_images

    if not generate_images:
        for brief in research_briefs_raw:
            for finding in brief.get("key_findings", []):
                claim_lower = str(finding.get("claim", "")).lower()
                stype_lower = str(finding.get("source_type", "")).lower()
                if any(kw in claim_lower or kw in stype_lower for kw in
                       ("image", "visual", "carousel", "graphic", "infographic", "photo")):
                    generate_images = True
                    break
            for hook in brief.get("recommended_hooks", []):
                if any(kw in str(hook).lower() for kw in ("image", "visual", "carousel")):
                    generate_images = True
                    break
            if generate_images:
                break

    if not generate_images:
        generate_images = True

    log.info(
        "[%s] Media voting: images=%s (source_images=%d)",
        platform, generate_images, len(source_imgs),
    )

    variants = []
    for v in validated_variants:
        image_url = None
        llm_prompt = ""

        if generate_images:
            log.info(
                "[%s] Crafting image prompt for variant %s …",
                platform, v.get("label"),
            )
            llm_prompt = build_image_prompt_via_llm(
                variant_text=v.get("text", ""),
                platform=platform,
                voice_profile=state.get("voice_profile"),
                persona_profile=state.get("persona_profile"),
                audience_profiles=state.get("audience_profiles"),
                research_briefs=research_briefs_raw,
                rule_set=state.get("rule_set"),
                source_image_analysis=state.get(
                    "source_image_analysis", "",
                ),
                run_meta=gen_meta,
            )
            log.info(
                "[%s] Image prompt ready (%d chars), generating image …",
                platform, len(llm_prompt),
            )
            try:
                image_url = generate_image(
                    llm_prompt,
                    platform,
                    reference_images=source_imgs,
                    run_meta=gen_meta,
                )
                log.info(
                    "[%s] Image result for %s: %s",
                    platform, v.get("label"),
                    image_url or "None (generation returned empty)",
                )
            except Exception:
                log.exception(
                    "[%s] Image gen FAILED for variant %s",
                    platform, v.get("label"),
                )

        variants.append({
            "id": str(uuid.uuid4()),
            "label": v.get("label", "A"),
            "text": v.get("text", ""),
            "rationale": v.get("rationale", ""),
            "rationale_struct": v.get("rationale_struct") or {},
            "status": "generated",
            "hook_type": v.get("hook_type", "question"),
            "consistency_score": v.get("consistency_score", 75),
            "image_prompt": llm_prompt,
            "image_url": image_url,
        })

    latency = int((time.time() - start) * 1000)
    return {
        "variants": variants,
        "audit_entries": [_make_audit(
            state, "draft", "SynthesizerAgent",
            f"Generated {len(variants)} variants for {platform}",
            usage, latency,
        )],
    }


# ─── 4. Validator Agent ─────────────────────────────────────────────────────

def validator_agent(state: PipelineState) -> dict:
    """Validate variants against voice profile, writing persona, and rule sets."""
    start = time.time()
    platform = state["platform"]
    voice_profile = state.get("voice_profile") or {}
    persona_profile = state.get("persona_profile") or {}
    rule_set = state.get("rule_set") or {}
    rules = rule_set.get("rules", [])

    results: list[dict] = []

    variants_text = "\n\n".join(
        f"Variant {v.get('label', '?')}:\n{v.get('text', '')}"
        for v in state.get("variants", [])
    )

    # ── 1. Voice Profile checks ──────────────────────────────────────────────

    # Deterministic: avoid-list scan
    avoid_list = voice_profile.get("avoid_list") or []
    if avoid_list:
        for variant in state.get("variants", []):
            text_lower = variant.get("text", "").lower()
            label = variant.get("label", "?")
            for term in avoid_list:
                if isinstance(term, str) and term.lower() in text_lower:
                    results.append({
                        "variant_label": label,
                        "rule_name": "Avoid-List Violation",
                        "rule_type": "voice",
                        "enforcement": "suggested",
                        "status": "warn",
                        "message": f'Contains avoided term: "{term}"',
                    })

    vmeta = _meta(state)
    vmeta["agent"] = "ValidatorAgent"

    # LLM: voice consistency (tone, vocabulary, structure alignment)
    if voice_profile:
        voice_summary = _format_voice_profile(voice_profile, platform)
        try:
            raw, _ = _claude_call(
                "You are a brand voice auditor. For EACH variant, score its alignment with the brand voice profile. "
                "Check tone, vocabulary patterns, structure patterns, and platform voice. "
                "Output a JSON array where each entry has: variant (label), alignment_score (0-100), "
                "deviations (list of specific mismatches), status ('pass' if score >= 70, 'warn' otherwise).",
                f"Brand Voice Profile:\n{voice_summary}\n\nVariants:\n{variants_text[:3000]}",
                max_tokens=1024,
                run_meta={**vmeta, "check": "voice_consistency"},
            )
            checks = _parse_json(raw, [])
            if isinstance(checks, list):
                for chk in checks[:6]:
                    if isinstance(chk, dict):
                        score = chk.get("alignment_score", 75)
                        deviations = chk.get("deviations", [])
                        dev_msg = "; ".join(str(d) for d in deviations[:3]) if deviations else "Aligned"
                        results.append({
                            "variant_label": chk.get("variant", "?"),
                            "rule_name": "Voice Consistency",
                            "rule_type": "voice",
                            "enforcement": "suggested",
                            "status": "pass" if score >= 70 else "warn",
                            "message": f"Alignment: {score}/100. {dev_msg}",
                        })
        except Exception:
            log.warning("LLM voice consistency check failed, skipping")

    # ── 2. Writing Persona checks ────────────────────────────────────────────

    if persona_profile and persona_profile.get("name"):
        persona_ctx_parts = [f"Name: {persona_profile.get('name', '')}"]
        if persona_profile.get("description"):
            persona_ctx_parts.append(f"Description: {persona_profile['description']}")
        if persona_profile.get("writing_approach"):
            persona_ctx_parts.append(f"Writing approach: {persona_profile['writing_approach']}")
        if persona_profile.get("tone"):
            persona_ctx_parts.append(f"Tone: {persona_profile['tone']}")
        if persona_profile.get("structure_preference"):
            persona_ctx_parts.append(f"Structure preference: {persona_profile['structure_preference']}")
        persona_ctx = "\n".join(persona_ctx_parts)

        try:
            raw, _ = _claude_call(
                "You are a writing style auditor. For EACH variant, check if it follows the writing persona's approach, "
                "tone, and structure preference. Output a JSON array where each entry has: variant (label), "
                "alignment_score (0-100), issues (list of specific deviations from the persona), "
                "status ('pass' if score >= 70, 'warn' otherwise).",
                f"Writing Persona:\n{persona_ctx}\n\nVariants:\n{variants_text[:3000]}",
                max_tokens=1024,
                run_meta={**vmeta, "check": "persona_alignment"},
            )
            checks = _parse_json(raw, [])
            if isinstance(checks, list):
                for chk in checks[:6]:
                    if isinstance(chk, dict):
                        score = chk.get("alignment_score", 75)
                        issues = chk.get("issues", [])
                        issue_msg = "; ".join(str(i) for i in issues[:3]) if issues else "Aligned"
                        results.append({
                            "variant_label": chk.get("variant", "?"),
                            "rule_name": "Persona Alignment",
                            "rule_type": "persona",
                            "enforcement": "suggested",
                            "status": "pass" if score >= 70 else "warn",
                            "message": f"Alignment: {score}/100. {issue_msg}",
                        })
        except Exception:
            log.warning("LLM persona alignment check failed, skipping")

    # ── 3. Rule Set checks ───────────────────────────────────────────────────

    if rules:
        rules_text = "\n".join(
            f"- [{r.get('enforcement', 'suggested')}] {r.get('name', 'Rule')}: {r.get('description', r.get('condition', ''))}"
            for r in rules if isinstance(r, dict)
        )
        try:
            raw, _ = _claude_call(
                "You are a content compliance checker. For EACH variant, evaluate it against EACH rule. "
                "Output a JSON array where each entry has: variant (label), rule_name (string), "
                "status ('pass', 'warn', or 'fail'), message (brief explanation). "
                "Use 'fail' only for rules with enforcement='required' that are clearly violated.",
                f"Rules:\n{rules_text}\n\nVariants:\n{variants_text[:3000]}",
                max_tokens=2048,
                run_meta={**vmeta, "check": "ruleset_compliance"},
            )
            checks = _parse_json(raw, [])
            if isinstance(checks, list):
                for chk in checks[:30]:
                    if isinstance(chk, dict):
                        rule_name = chk.get("rule_name", "Custom Rule")
                        matching_rule = next(
                            (r for r in rules if isinstance(r, dict) and r.get("name") == rule_name),
                            {},
                        )
                        results.append({
                            "variant_label": chk.get("variant", "?"),
                            "rule_name": rule_name,
                            "rule_type": matching_rule.get("type", "ruleset"),
                            "enforcement": matching_rule.get("enforcement", "suggested"),
                            "status": chk.get("status", "pass"),
                            "message": chk.get("message", ""),
                        })
        except Exception:
            log.warning("LLM rule-set check failed, skipping")

    failures = [r for r in results if r["status"] == "fail"]
    latency = int((time.time() - start) * 1000)

    return {
        "validation_results": results,
        "retry_feedback": failures,
        "attempt": state.get("attempt", 0) + 1,
        "audit_entries": [_make_audit(
            state, "validate", "ValidatorAgent",
            f"{len(results)} checks: {len(failures)} failures",
            latency_ms=latency,
        )],
    }


# ─── Routing Functions ───────────────────────────────────────────────────────

def route_research(state: PipelineState) -> list[Send]:
    """Fan-out: emit one Send per active research activity."""
    plan = state.get("research_plan", {})
    activities = state.get("active_activities", [])
    sends = []
    for activity in activities:
        resolved = _OLD_TO_NEW_ACTIVITY.get(activity, activity)
        brief = plan.get(activity, plan.get(
            resolved, {"query": activity, "focus": activity},
        ))
        target = (
            f"research_{resolved}"
            if resolved in ACTIVITY_HANDLERS
            else "research_generic"
        )
        sends.append(Send(target, {
            **state,
            "current_activity": resolved,
            "activity_brief": brief,
        }))
    if not sends:
        sends.append(Send("research_brand_knowledge", {
            **state,
            "current_activity": "brand_knowledge",
            "activity_brief": {
                "query": "brand guidelines",
                "focus": "general",
            },
        }))
    return sends


def should_retry(state: PipelineState) -> str:
    failures = [r for r in state.get("validation_results", []) if r.get("status") == "fail"]
    if failures and state.get("attempt", 0) <= MAX_RETRY_ATTEMPTS:
        return "synthesizer"
    return END


# ─── Build the Graph ─────────────────────────────────────────────────────────

def build_pipeline_graph():
    graph = StateGraph(PipelineState)

    graph.add_node("image_analyzer", image_analyzer_agent)
    graph.add_node("planner", planner_agent)
    graph.add_node("research_worker", research_worker_node)
    for activity in ACTIVITY_HANDLERS.keys():
        graph.add_node(f"research_{activity}", _named_research_node(activity))
    graph.add_node("research_generic", _named_research_node("generic"))
    graph.add_node("synthesizer", synthesizer_agent)
    graph.add_node("validator", validator_agent)

    graph.add_edge(START, "image_analyzer")
    graph.add_edge("image_analyzer", "planner")
    research_nodes = [f"research_{a}" for a in ACTIVITY_HANDLERS.keys()]
    graph.add_conditional_edges("planner", route_research, research_nodes + ["research_generic"])
    graph.add_edge("research_worker", "synthesizer")
    for node_name in research_nodes + ["research_generic"]:
        graph.add_edge(node_name, "synthesizer")
    graph.add_edge("synthesizer", "validator")
    graph.add_conditional_edges(
        "validator", should_retry,
        {"synthesizer": "synthesizer", END: END},
    )

    return graph.compile()


_compiled_pipeline = None


def _get_pipeline():
    global _compiled_pipeline
    if _compiled_pipeline is None:
        _compiled_pipeline = build_pipeline_graph()
    return _compiled_pipeline


# ─── Fallback ────────────────────────────────────────────────────────────────

def _fallback_variants(source_content: str, platform: str) -> list[dict]:
    return [
        {
            "label": label, "text": f"[{platform.upper()} {label}] {source_content[:220]}",
            "rationale": f"Fallback variant for {platform}", "hook_type": hook,
            "consistency_score": 65, "image_prompt": "",
            "rationale_struct": {
                "strategy": "Fallback due to structured generation failure",
                "audience_fit": "Generic audience fit",
                "voice_alignment": "Best-effort alignment",
                "rules_alignment": "Best-effort rule compliance",
                "evidence_links": [],
                "open_questions": [],
            },
        }
        for label, hook in [("A", "question"), ("B", "statistic"), ("C", "story")]
    ]


# ─── Public Entry Point ─────────────────────────────────────────────────────

def run_platform_pipeline(
    run_id: str,
    node_id: str,
    platform: str,
    source_content: str,
    source_images: list[str],
    voice_profile: dict,
    persona_profile: dict,
    audience_profiles: list[dict],
    rule_set: dict,
    preference_summary: str = "",
) -> None:
    """Execute the full LangGraph pipeline for one platform. Updates DB."""
    db = SessionLocal()
    try:
        node = db.get(WorkflowNodeStateRecord, node_id)
        if not node:
            log.error("Node %s not found", node_id)
            return

        from datetime import datetime, timezone
        node.status = "running"
        node.started_at = datetime.now(timezone.utc)
        db.commit()

        initial_state: dict = {
            "source_content": source_content,
            "source_images": source_images,
            "source_image_analysis": "",
            "platform": platform,
            "voice_profile": voice_profile,
            "persona_profile": persona_profile,
            "audience_profiles": audience_profiles,
            "rule_set": rule_set,
            "preference_summary": preference_summary,
            "research_plan": {},
            "active_activities": [],
            "research_briefs": [],
            "variants": [],
            "validation_results": [],
            "retry_feedback": [],
            "attempt": 0,
            "audit_entries": [],
            "run_id": run_id,
            "node_id": node_id,
            "current_activity": "",
            "activity_brief": {},
        }

        pipeline = _get_pipeline()
        final_state = pipeline.invoke(initial_state)

        def _safe(obj):
            """Ensure object is JSON-serializable."""
            return json.loads(json.dumps(obj, default=str))

        node.variants = _safe(final_state.get("variants", []))
        node.validation_results = _safe(
            final_state.get("validation_results", []),
        )
        node.status = "done"

        validation = final_state.get("validation_results", [])
        node.composition = {
            **node.composition,
            "research_activities": final_state.get(
                "active_activities", [],
            ),
            "research_plan": _safe(
                final_state.get("research_plan", {}),
            ),
            "research_briefs": _safe(
                final_state.get("research_briefs", []),
            ),
            "research_briefs_count": len(
                final_state.get("research_briefs", []),
            ),
            "validation_summary": {
                "total": len(validation),
                "pass": sum(
                    1 for r in validation
                    if r.get("status") == "pass"
                ),
                "warn": sum(
                    1 for r in validation
                    if r.get("status") == "warn"
                ),
                "fail": sum(
                    1 for r in validation
                    if r.get("status") == "fail"
                ),
            },
            "attempts": final_state.get("attempt", 1),
        }

        for entry in final_state.get("audit_entries", []):
            db.add(WorkflowAuditLog(
                id=entry.get("id", str(uuid.uuid4())),
                run_id=entry.get("run_id", run_id),
                node_id=entry.get("node_id", node_id),
                step=entry.get("step", "unknown"),
                agent_name=entry.get("agent_name", "unknown"),
                platform=entry.get("platform", platform),
                input_summary=entry.get("input_summary", "")[:500],
                output_summary=entry.get("output_summary", "")[:500],
                token_usage=entry.get("token_usage", {}),
                latency_ms=entry.get("latency_ms", 0),
                status=entry.get("status", "success"),
            ))

        db.commit()
        log.info("Pipeline completed for %s [run=%s, node=%s]", platform, run_id, node_id)

    except Exception as exc:
        log.exception(
            "Pipeline failed for %s [run=%s, node=%s]",
            platform, run_id, node_id,
        )
        try:
            node = db.get(WorkflowNodeStateRecord, node_id)
            if node:
                node.status = "failed"
                err_msg = f"{type(exc).__name__}: {exc}"
                db.add(WorkflowAuditLog(
                    run_id=run_id, node_id=node_id,
                    step="pipeline",
                    agent_name="PipelineOrchestrator",
                    platform=platform,
                    input_summary="Pipeline execution",
                    output_summary=err_msg[:500],
                    status="error",
                ))
                db.commit()
        except Exception:
            log.exception("Failed to save error state")
    finally:
        db.close()

    _check_run_completion(run_id)


def _check_run_completion(run_id: str) -> None:
    from app.db.models import WorkflowRunRecord
    from sqlalchemy import select

    db = SessionLocal()
    try:
        nodes = db.execute(
            select(WorkflowNodeStateRecord).where(
                WorkflowNodeStateRecord.workflow_run_id == run_id,
                WorkflowNodeStateRecord.node_type == "platform",
            )
        ).scalars().all()
        if not nodes:
            return
        if all(n.status in ("done", "completed", "failed") for n in nodes):
            run = db.get(WorkflowRunRecord, run_id)
            if run:
                has_failure = any(n.status == "failed" for n in nodes)
                run.status = "review" if not has_failure else "failed"
                db.commit()
                log.info("Run %s completed with status=%s", run_id, run.status)
    except Exception:
        log.exception("Failed to check run completion for %s", run_id)
    finally:
        db.close()
