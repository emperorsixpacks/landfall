"""Lyrics → theme → Qloo tag pipeline.

Transcribes the song with Groq's Whisper (same key as the LLM), extracts
themes/mood/language with the LLM, and resolves themes to Qloo tags via
GET /v2/tags (fuzzy >= 85, unresolved dropped). Best-effort: never blocks a run,
and no transcript text is ever logged or cached.
"""
from __future__ import annotations

import httpx
import rapidfuzz

from . import audio, config, llm, qloo_client as qloo

GROQ_TRANSCRIBE = "https://api.groq.com/openai/v1/audio/transcriptions"
WHISPER_MODEL = "whisper-large-v3-turbo"


def transcribe(song_id: str):
    """Return {text, segments} or None. Segments carry start/end timestamps."""
    src = audio._file_for(song_id)
    if src is None:
        return None
    try:
        with open(src, "rb") as f:
            r = httpx.post(
                GROQ_TRANSCRIBE,
                headers={"Authorization": f"Bearer {config.LLM_API_KEY}"},
                files={"file": (src.name, f, "application/octet-stream")},
                data={"model": WHISPER_MODEL, "response_format": "verbose_json"},
                timeout=config.TOOL_TIMEOUT_SECONDS,
            )
        if r.status_code != 200:
            return None
        d = r.json()
        text = (d.get("text") or "").strip()
        segments = [
            {
                "start": round(s.get("start", 0), 2),
                "end": round(s.get("end", 0), 2),
                "text": (s.get("text") or "").strip(),
            }
            for s in (d.get("segments") or [])
            if (s.get("text") or "").strip()
        ]
        return {"text": text, "segments": segments}
    except Exception:  # noqa: BLE001
        return None


def _extract_themes(transcript: str) -> dict:
    prompt = (
        "You analyze song lyrics. Extract: (a) abstract themes, (b) the mood, (c) the language, "
        "and (d) any SPECIFIC named entities mentioned (people, places, brands, products, events). "
        f"Lyrics: {transcript[:3000]}. "
        'Reply JSON only: {"themes": ["3-8 short theme words"], "mood": "one or two words", "language": "...", '
        '"entities": [{"name": "specific named thing", "type": "person|place|brand|event|product"}]}. '
        "Themes should be simple words a taste graph would tag. Entities must be specific named things "
        "(e.g. 'Lagos', 'Nike', 'Muhammad Ali', 'Champagne'), not generic words; return [] if none."
    )
    return llm.chat_json(
        [{"role": "user", "content": prompt}],
        fallback={"themes": [], "mood": "", "language": "", "entities": []},
    )


def _resolve_themes(themes: list[str]) -> list[dict]:
    tags = []
    seen: set[str] = set()
    for theme in themes:
        key = theme.lower().strip()
        if not key or key in seen:
            continue
        seen.add(key)
        res = qloo.search_tags(theme, limit=5)
        best = None
        best_ratio = 0
        for c in (res.get("candidates") or []):
            ratio = rapidfuzz.fuzz.ratio(key, (c.get("name") or "").lower())
            if ratio >= 85 and ratio > best_ratio:
                best = c
                best_ratio = ratio
        if best:
            tags.append({"id": best["id"], "name": best["name"], "term": theme})
    return tags


_ENTITY_TYPE_MAP = {
    "person": "urn:entity:person",
    "place": "urn:entity:place",
    "brand": "urn:entity:brand",
    "event": "urn:entity:person",
    "product": "urn:entity:brand",
}


def _resolve_entities(entities: list[dict]) -> list[dict]:
    resolved = []
    seen: set[str] = set()
    for e in entities:
        name = (e.get("name") or "").strip()
        if not name or name.lower() in seen:
            continue
        seen.add(name.lower())
        qtype = _ENTITY_TYPE_MAP.get(e.get("type", "person"), "urn:entity:person")
        r = qloo.search(name, [qtype], limit=3)
        best = None
        best_ratio = 0
        for c in (r.get("candidates") or []):
            ratio = rapidfuzz.fuzz.ratio(name.lower(), (c.get("name") or "").lower())
            if ratio >= 85 and ratio > best_ratio:
                best = c
                best_ratio = ratio
        if best:
            resolved.append({"name": best["name"], "id": best["id"], "type": e.get("type", "person"), "mentioned_as": name})
    return resolved


def analyze_lyrics(song_id: str) -> dict:
    if not config.lyrics_ready():
        return {"ok": False, "reason": "lyrics disabled or no LLM key"}

    tr = transcribe(song_id)
    if not tr or len(tr.get("text", "")) < 5:
        return {
            "ok": False,
            "reason": "no usable transcript",
            "transcript": tr.get("text", "") if tr else "",
            "segments": tr.get("segments", []) if tr else [],
        }

    data = _extract_themes(tr["text"])
    themes = [t for t in (data.get("themes") or []) if t][:8]
    tags = _resolve_themes(themes)
    entities = _resolve_entities(data.get("entities") or [])

    return {
        "ok": bool(tags) or bool(entities),
        "transcript": tr["text"],
        "segments": tr["segments"],
        "themes": themes,
        "mood": data.get("mood") or "",
        "language": data.get("language") or "",
        "tags": tags,
        "entities": entities,
    }
