"""Artist lookup via ytmusicapi (unofficial, unauthenticated).

Cached on disk for 24h. If the lookup is blocked from the host, we fall back to
bundled YouTube Music data for the sample artists. NOTE: bundled data is only
YouTube Music info (public), never Qloo response data (see Qloo cache terms).
"""
from __future__ import annotations

from typing import Any, Optional

from . import cache, config

YT_TTL = 24 * 3600
YT_SOURCE = "YouTube Music (unofficial)"
BUNDLE_SOURCE = "YouTube Music (bundled fallback)"
BUNDLE_FILE = "ytmusic_fallback.json"


def _normalize(raw: dict) -> dict:
    return {
        "name": raw.get("name"),
        "browse_id": raw.get("browse_id"),
        "description": raw.get("description"),
        "top_songs": raw.get("top_songs", [])[:10],
        "related": raw.get("related", [])[:10],
    }


def _lookup_live(query: str) -> Optional[dict]:
    try:
        from ytmusicapi import YTMusic

        yt = YTMusic()
        artists = yt.search(query, filter="artists") or []
        if not artists:
            return None
        best = artists[0]
        browse_id = best.get("browseId")
        if not browse_id:
            return None
        page = yt.get_artist(browse_id)
        songs = []
        for s in (page.get("songs", {}).get("results") or [])[:10]:
            songs.append(
                {
                    "title": s.get("title"),
                    "video_id": s.get("videoId"),
                    "views": s.get("views"),
                }
            )
        related = [
            r.get("title") or r.get("name")
            for r in (page.get("related", {}).get("results") or [])
            if (r.get("title") or r.get("name"))
        ]
        return {
            "name": page.get("name") or page.get("artist") or best.get("artist") or query,
            "browse_id": browse_id,
            "description": page.get("description"),
            "top_songs": songs,
            "related": related,
        }
    except Exception:  # noqa: BLE001
        return None


def find_artist(query: str) -> dict:
    """Return {ok, artist{...}, source}. Never raises."""
    parts = {"query": query}
    cached = cache.get("yt_artist", parts, YT_TTL)
    if cached:
        return {"ok": True, "artist": cached["artist"], "source": cached.get("source", YT_SOURCE)}

    artist = _lookup_live(query)
    if artist:
        cache.put("yt_artist", parts, {"artist": artist, "source": YT_SOURCE})
        return {"ok": True, "artist": artist, "source": YT_SOURCE}

    bundled = _bundled(query)
    if bundled:
        return {"ok": True, "artist": bundled, "source": BUNDLE_SOURCE}

    return {"ok": False, "artist": None, "source": None, "error": "not_found"}


def _bundled(query: str) -> Optional[dict]:
    data = cache.load_bundled(BUNDLE_FILE)
    if not data:
        return None
    artists = data.get("artists", [])
    q = query.lower().strip()
    for a in artists:
        if a.get("name", "").lower().strip() == q:
            return _normalize(a)
    # fuzzy: prefix match as a last resort
    for a in artists:
        if a.get("name", "").lower().startswith(q):
            return _normalize(a)
    return None


def bundled_artists() -> list[str]:
    data = cache.load_bundled(BUNDLE_FILE)
    if not data:
        return []
    return [a.get("name") for a in data.get("artists", []) if a.get("name")]


def search_artists(query: str, limit: int = 8) -> list[dict]:
    """Live artist autocomplete via YouTube Music search (unofficial)."""
    if not query or not query.strip():
        return []
    try:
        from ytmusicapi import YTMusic

        yt = YTMusic()
        results = yt.search(query, filter="artists") or []
        out = []
        for r in results:
            name = r.get("artist") or r.get("name")
            if name:
                out.append({"name": name, "type": "Artist"})
            if len(out) >= limit:
                break
        return out
    except Exception:  # noqa: BLE001
        return []
