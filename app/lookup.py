"""Artist lookup via ytmusicapi (unofficial, unauthenticated).

Cached on disk for 24h. If the lookup is blocked from the host, we fall back to
bundled YouTube Music data for the sample artists. NOTE: bundled data is only
YouTube Music info (public), never Qloo response data (see Qloo cache terms).
"""
from __future__ import annotations

import time
from concurrent.futures import ThreadPoolExecutor
from typing import Any, Optional

from . import cache, config, http_log

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
    t0 = time.monotonic()
    try:
        from ytmusicapi import YTMusic

        yt = YTMusic()
        artists = yt.search(query, filter="artists") or []
        if not artists:
            http_log.record("youtube", f"search {query}", (time.monotonic() - t0) * 1000, True)
            return None
        best = artists[0]
        browse_id = best.get("browseId")
        if not browse_id:
            http_log.record("youtube", f"search {query}", (time.monotonic() - t0) * 1000, True)
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
        http_log.record("youtube", f"artist {best.get('artist') or query}", (time.monotonic() - t0) * 1000, True)
        return {
            "name": page.get("name") or page.get("artist") or best.get("artist") or query,
            "browse_id": browse_id,
            "description": page.get("description"),
            "top_songs": songs,
            "related": related,
        }
    except Exception:  # noqa: BLE001
        http_log.record("youtube", f"search {query}", (time.monotonic() - t0) * 1000, False)
        return None


def _spotify_find(query: str) -> Optional[dict]:
    try:
        from . import spotify

        return spotify.find_artist(query)
    except Exception:  # noqa: BLE001
        return None


def find_artist(query: str) -> dict:
    """Return {ok, artist{...}, source}. Never raises. Spotify is used to enrich
    the artist with discography + genres when credentials are present."""
    parts = {"query": query}
    cached = cache.get("yt_artist", parts, YT_TTL)
    if cached:
        return {"ok": True, "artist": cached["artist"], "source": cached.get("source", YT_SOURCE)}

    artist = None
    source = YT_SOURCE
    # Run YouTube Music and Spotify in parallel to cut lookup latency.
    with ThreadPoolExecutor(max_workers=2) as ex:
        f_yt = ex.submit(_lookup_live, query)
        f_sp = ex.submit(_spotify_find, query)
        artist = f_yt.result()
        spotify = f_sp.result()

    if artist is None and spotify:
        artist = {
            "name": spotify["name"],
            "top_songs": [],
            "related": [],
            "albums": spotify.get("albums", []),
            "genres": spotify.get("genres", []),
            "image": spotify.get("image"),
            "spotify_top_songs": spotify.get("spotify_top_songs", []),
        }
        source = "Spotify"
    elif artist is not None and spotify:
        artist["albums"] = spotify.get("albums", [])
        artist["genres"] = spotify.get("genres", [])
        artist["image"] = spotify.get("image")
        artist["spotify_top_songs"] = spotify.get("spotify_top_songs", [])
        source = "YouTube Music + Spotify"

    if artist:
        cache.put("yt_artist", parts, {"artist": artist, "source": source})
        return {"ok": True, "artist": artist, "source": source}

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
    """Live artist autocomplete: YouTube Music first (instant), Spotify enrichment."""
    if not query or not query.strip():
        return []
    results = []
    seen: set[str] = set()

    def add(name):
        if name and name.lower() not in seen:
            seen.add(name.lower())
            results.append({"name": name, "type": "Artist"})

    # YouTube Music first — no token, instant.
    try:
        from ytmusicapi import YTMusic

        for r in (YTMusic().search(query, filter="artists") or [])[:limit]:
            add(r.get("artist") or r.get("name"))
    except Exception:  # noqa: BLE001
        pass

    # Spotify enrichment (deduped).
    try:
        from . import spotify

        for a in spotify.search_artists(query, limit):
            add(a.get("name"))
    except Exception:  # noqa: BLE001
        pass

    return results[:limit]
