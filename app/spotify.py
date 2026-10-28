"""Spotify Web API client (client-credentials flow, no user login).

Used to enrich artist lookup with discography + genres and to power the live
autocomplete. Fails soft — every call returns empty/None on error so the run
never crashes.
"""
from __future__ import annotations

import base64
import threading
import time

import httpx

from . import config

TOKEN_URL = "https://accounts.spotify.com/api/token"
API = "https://api.spotify.com/v1"

_lock = threading.Lock()
_token: str | None = None
_token_exp = 0.0


def _get_token() -> str | None:
    global _token, _token_exp
    with _lock:
        if _token and time.time() < _token_exp - 30:
            return _token
        if not config.spotify_ready():
            return None
        auth = base64.b64encode(
            f"{config.SPOTIFY_CLIENT_ID}:{config.SPOTIFY_CLIENT_SECRET}".encode()
        ).decode()
        try:
            r = httpx.post(
                TOKEN_URL,
                data={"grant_type": "client_credentials"},
                headers={"Authorization": f"Basic {auth}", "Content-Type": "application/x-www-form-urlencoded"},
                timeout=20,
            )
            r.raise_for_status()
            d = r.json()
            _token = d["access_token"]
            _token_exp = time.time() + d.get("expires_in", 3600)
            return _token
        except Exception:  # noqa: BLE001
            return None


def _get(path: str, params: dict | None = None):
    tok = _get_token()
    if not tok:
        return None
    try:
        r = httpx.get(f"{API}{path}", params=params, headers={"Authorization": f"Bearer {tok}"}, timeout=20)
        r.raise_for_status()
        return r.json()
    except Exception:  # noqa: BLE001
        return None


def search_artists(query: str, limit: int = 8) -> list[dict]:
    if not config.spotify_ready():
        return []
    d = _get("/search", {"q": query, "type": "artist", "limit": limit})
    if not d:
        return []
    return [{"name": a.get("name"), "id": a.get("id")} for a in d.get("artists", {}).get("items", []) if a.get("name")]


def get_artist(artist_id: str) -> dict | None:
    d = _get(f"/artists/{artist_id}")
    if not d:
        return None
    return {
        "name": d.get("name"),
        "id": d.get("id"),
        "genres": d.get("genres") or [],
        "popularity": d.get("popularity"),
        "image": (d.get("images") or [{}])[0].get("url") if d.get("images") else None,
    }


def get_albums(artist_id: str, limit: int = 8) -> list[dict]:
    d = _get(f"/artists/{artist_id}/albums", {"include_groups": "album,single", "limit": limit})
    if not d:
        return []
    out = []
    seen: set[str] = set()
    for a in d.get("items", []):
        name = a.get("name")
        if not name or name.lower() in seen:
            continue
        seen.add(name.lower())
        out.append(
            {
                "name": name,
                "release_date": a.get("release_date"),
                "total_tracks": a.get("total_tracks"),
                "type": a.get("album_type") or a.get("type"),
            }
        )
    return out


def find_artist(query: str) -> dict | None:
    if not config.spotify_ready():
        return None
    cands = search_artists(query, 1)
    if not cands:
        return None
    top = cands[0]
    info = get_artist(top["id"]) or {}
    albums = get_albums(top["id"])
    return {
        "name": info.get("name") or top.get("name"),
        "id": top.get("id"),
        "genres": info.get("genres", []),
        "image": info.get("image"),
        "albums": albums,
        "source": "Spotify",
    }
