"""Quick CLI test for the browser scraper."""
import asyncio
import json
import logging
import sys
import os

sys.path.insert(0, os.path.dirname(__file__))

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-7s  %(name)s  %(message)s",
)

from app.services.browser_agent import scrape_profile


async def main():
    url = sys.argv[1] if len(sys.argv) > 1 else "https://x.com/LandingAI"
    print(f"\n{'='*60}")
    print(f"  Scraping: {url}")
    print(f"{'='*60}\n")

    result = await scrape_profile(url)

    profile = result.get("profile", {})
    posts = result.get("posts", [])

    print(f"\n{'='*60}")
    print("  PROFILE")
    print(f"{'='*60}")
    print(json.dumps(profile, indent=2, ensure_ascii=False))

    print(f"\n{'='*60}")
    print(f"  POSTS  ({len(posts)} captured)")
    print(f"{'='*60}")
    for i, p in enumerate(posts):
        print(f"\n--- Post {i+1} ---")
        print(f"  Type : {p.get('type', 'unknown')}")
        print(f"  Date : {p.get('date', 'n/a')}")
        text = (p.get("text") or "")[:300]
        print(f"  Text : {text}")
        eng = p.get("engagement", {})
        print(f"  Likes: {eng.get('likes',0)}  Comments: {eng.get('comments',0)}  Shares: {eng.get('shares',0)}")
        media = p.get("media", [])
        if media:
            print(f"  Media: {len(media)} item(s)")
            for m in media[:3]:
                print(f"         {m[:120]}")

    print(f"\n{'='*60}")
    print(f"  DATA HEALTH: {result.get('data_health_percent', 0)}%")
    print(f"  Platform   : {result.get('platform')}")
    print(f"  Handle     : {result.get('handle')}")
    print(f"  Source URL  : {result.get('source_url')}")
    print(f"{'='*60}\n")

    with open("scrape_result.json", "w") as f:
        json.dump(result, f, indent=2, ensure_ascii=False)
    print("Full JSON saved to scrape_result.json")


if __name__ == "__main__":
    asyncio.run(main())
