"""
Real platform connectors — fetch profile + recent posts using API tokens.

Each connector returns a standardized dict:
{
  "profile": { "name": ..., "handle": ..., "bio": ..., "followers": ..., "avatar_url": ... },
  "posts": [ { "id": ..., "text": ..., "date": ..., "type": ..., "engagement": {...} } ],
  "data_health_percent": int,
}
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone

import httpx

log = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# X / Twitter  (API v2 with Bearer Token)
# ---------------------------------------------------------------------------

async def fetch_x_account(bearer_token: str, handle: str) -> dict:
    handle = handle.lstrip("@")
    headers = {"Authorization": f"Bearer {bearer_token}"}
    async with httpx.AsyncClient(timeout=15) as client:
        user_resp = await client.get(
            f"https://api.twitter.com/2/users/by/username/{handle}",
            headers=headers,
            params={
                "user.fields": "name,description,profile_image_url,public_metrics",
            },
        )
        user_resp.raise_for_status()
        user_data = user_resp.json()["data"]

        profile = {
            "name": user_data.get("name", handle),
            "handle": f"@{user_data['username']}",
            "bio": user_data.get("description", ""),
            "followers": user_data.get("public_metrics", {}).get("followers_count", 0),
            "avatar_url": user_data.get("profile_image_url", ""),
        }

        tweets_resp = await client.get(
            f"https://api.twitter.com/2/users/{user_data['id']}/tweets",
            headers=headers,
            params={
                "max_results": 20,
                "tweet.fields": "created_at,public_metrics,entities",
                "exclude": "retweets,replies",
            },
        )
        tweets_resp.raise_for_status()
        raw_tweets = tweets_resp.json().get("data", [])

    posts = []
    for t in raw_tweets:
        metrics = t.get("public_metrics", {})
        engagement_total = (
            metrics.get("like_count", 0)
            + metrics.get("retweet_count", 0)
            + metrics.get("reply_count", 0)
            + metrics.get("quote_count", 0)
        )
        posts.append({
            "id": t["id"],
            "text": t["text"],
            "date": t.get("created_at", ""),
            "type": _classify_tweet(t),
            "engagement": {
                "likes": metrics.get("like_count", 0),
                "retweets": metrics.get("retweet_count", 0),
                "replies": metrics.get("reply_count", 0),
                "total": engagement_total,
            },
        })

    return {
        "profile": profile,
        "posts": posts,
        "data_health_percent": min(100, len(posts) * 5),
    }


def _classify_tweet(tweet: dict) -> str:
    text = tweet.get("text", "")
    if text.startswith("RT "):
        return "retweet"
    if "\n" in text and len(text) > 200:
        return "thread"
    if "https://t.co/" in text:
        return "link"
    return "text"


# ---------------------------------------------------------------------------
# LinkedIn  (Community Management API or Profile API)
# ---------------------------------------------------------------------------

async def fetch_linkedin_account(access_token: str, handle: str) -> dict:
    """
    Uses LinkedIn's OpenID Connect userinfo endpoint (works with `openid profile` scopes)
    and the versioned REST Posts API for fetching recent posts.
    """
    headers = {"Authorization": f"Bearer {access_token}"}
    async with httpx.AsyncClient(timeout=15) as client:
        # /v2/userinfo works with modern openid+profile scopes
        me_resp = await client.get(
            "https://api.linkedin.com/v2/userinfo",
            headers=headers,
        )
        me_resp.raise_for_status()
        me = me_resp.json()

        profile = {
            "name": me.get("name", "") or handle,
            "handle": handle,
            "bio": "",
            "followers": 0,
            "avatar_url": me.get("picture", ""),
        }

        person_id = me.get("sub", "")
        urn = f"urn:li:person:{person_id}" if person_id else ""

        posts: list[dict] = []
        if urn:
            try:
                rest_headers = {
                    **headers,
                    "LinkedIn-Version": "202401",
                    "X-Restli-Protocol-Version": "2.0.0",
                }
                posts_resp = await client.get(
                    "https://api.linkedin.com/rest/posts",
                    headers=rest_headers,
                    params={"author": urn, "q": "author", "count": 20},
                )
                if posts_resp.status_code == 200:
                    for item in posts_resp.json().get("elements", []):
                        posts.append({
                            "id": item.get("id", ""),
                            "text": item.get("commentary", ""),
                            "date": datetime.fromtimestamp(
                                item.get("createdAt", 0) / 1000, tz=timezone.utc
                            ).isoformat() if item.get("createdAt") else "",
                            "type": "post",
                            "engagement": {"likes": 0, "comments": 0, "total": 0},
                        })
            except Exception:
                log.warning("Could not fetch LinkedIn posts, token may lack w_member_social scope")

    return {
        "profile": profile,
        "posts": posts,
        "data_health_percent": 80 if profile["name"] != handle else 40,
    }


# ---------------------------------------------------------------------------
# Instagram  (Meta Graph API)
# ---------------------------------------------------------------------------

async def fetch_instagram_account(access_token: str, handle: str) -> dict:
    async with httpx.AsyncClient(timeout=15) as client:
        me_resp = await client.get(
            "https://graph.instagram.com/me",
            params={
                "fields": "id,username,account_type,media_count",
                "access_token": access_token,
            },
        )
        me_resp.raise_for_status()
        me = me_resp.json()

        profile = {
            "name": me.get("username", handle),
            "handle": f"@{me.get('username', handle)}",
            "bio": "",
            "followers": 0,
            "avatar_url": "",
        }

        media_resp = await client.get(
            "https://graph.instagram.com/me/media",
            params={
                "fields": "id,caption,timestamp,media_type,like_count,comments_count,permalink",
                "limit": 20,
                "access_token": access_token,
            },
        )
        media_resp.raise_for_status()
        raw_media = media_resp.json().get("data", [])

    posts = []
    for m in raw_media:
        likes = m.get("like_count", 0)
        comments = m.get("comments_count", 0)
        posts.append({
            "id": m["id"],
            "text": m.get("caption", ""),
            "date": m.get("timestamp", ""),
            "type": m.get("media_type", "IMAGE").lower(),
            "engagement": {
                "likes": likes,
                "comments": comments,
                "total": likes + comments,
            },
        })

    return {
        "profile": profile,
        "posts": posts,
        "data_health_percent": min(100, len(posts) * 5) if posts else 30,
    }


# ---------------------------------------------------------------------------
# TikTok  (TikTok Research / Display API)
# ---------------------------------------------------------------------------

async def fetch_tiktok_account(access_token: str, handle: str) -> dict:
    handle = handle.lstrip("@")
    headers = {"Authorization": f"Bearer {access_token}"}
    async with httpx.AsyncClient(timeout=15) as client:
        user_resp = await client.get(
            "https://open.tiktokapis.com/v2/user/info/",
            headers=headers,
            params={"fields": "display_name,avatar_url,follower_count,bio_description"},
        )
        user_resp.raise_for_status()
        user_data = user_resp.json().get("data", {}).get("user", {})

        profile = {
            "name": user_data.get("display_name", handle),
            "handle": f"@{handle}",
            "bio": user_data.get("bio_description", ""),
            "followers": user_data.get("follower_count", 0),
            "avatar_url": user_data.get("avatar_url", ""),
        }

        posts: list[dict] = []
        try:
            videos_resp = await client.post(
                "https://open.tiktokapis.com/v2/video/list/",
                headers=headers,
                json={"max_count": 20},
                params={"fields": "id,title,create_time,like_count,comment_count,share_count,view_count"},
            )
            if videos_resp.status_code == 200:
                for v in videos_resp.json().get("data", {}).get("videos", []):
                    likes = v.get("like_count", 0)
                    comments = v.get("comment_count", 0)
                    shares = v.get("share_count", 0)
                    posts.append({
                        "id": v.get("id", ""),
                        "text": v.get("title", ""),
                        "date": datetime.fromtimestamp(
                            v.get("create_time", 0), tz=timezone.utc
                        ).isoformat() if v.get("create_time") else "",
                        "type": "video",
                        "engagement": {
                            "likes": likes,
                            "comments": comments,
                            "shares": shares,
                            "views": v.get("view_count", 0),
                            "total": likes + comments + shares,
                        },
                    })
        except Exception:
            log.warning("Could not fetch TikTok videos")

    return {
        "profile": profile,
        "posts": posts,
        "data_health_percent": min(100, len(posts) * 5) if posts else 30,
    }


# ---------------------------------------------------------------------------
# Dispatcher
# ---------------------------------------------------------------------------

PLATFORM_FETCHERS = {
    "x": fetch_x_account,
    "linkedin": fetch_linkedin_account,
    "instagram": fetch_instagram_account,
    "tiktok": fetch_tiktok_account,
}


async def fetch_platform_data(platform: str, api_token: str, handle: str) -> dict:
    fetcher = PLATFORM_FETCHERS.get(platform)
    if not fetcher:
        raise ValueError(f"Unsupported platform: {platform}")
    return await fetcher(api_token, handle)
