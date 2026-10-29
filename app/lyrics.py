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
        "You analyze song lyrics. Extract the core themes, mood, and language. "
        f"Lyrics: {transcript[:3000]}. "
        'Reply JSON only: {"themes": ["3-8 short theme words or phrases"], "mood": "one or two words", "language": "..."}. '
        "Themes should be simple words a taste graph would tag, e.g. hustle, celebration, street life, heartbreak, faith."
    )
    return llm.chat_json(
        [{"role": "user", "content": prompt}],
        fallback={"themes": [], "mood": "", "language": ""},
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

    return {
        "ok": bool(tags),
        "transcript": tr["text"],
        "segments": tr["segments"],
        "themes": themes,
        "mood": data.get("mood") or "",
        "language": data.get("language") or "",
        "tags": tags,
    }
