"""LLM-only baseline for the side-by-side comparison.

The LLM gets the same Qloo taste data the agent uses, but none of the agent's
structured analysis or code scoring, so the comparison shows what the agent adds.
"""
from __future__ import annotations

import json

from . import config, llm, qloo_client as qloo


def run_baseline(request: dict) -> dict:
    artist = (request.get("artist") or "").strip() or "the artist"
    song_id = request.get("song_id")
    genre = request.get("genre")
    countries = request.get("countries") or []

    qloo_tags: list[str] = []
    related: list[str] = []
    try:
        r = qloo.search(artist, ["urn:entity:artist"])
        if r.get("candidates"):
            eid = r["candidates"][0]["id"]
            ta = qloo.entity_tags(eid, limit=15)
            if ta.get("ok"):
                qloo_tags = [t.get("name") for t in ta["tags"] if t.get("name")]
            rel = qloo.related("urn:entity:artist", eid, limit=6)
            if rel.get("ok"):
                related = [e.get("name") for e in rel["entities"] if e.get("name")]
    except Exception:  # noqa: BLE001
        pass

    prompt = (
        "You are a release planner with access to Qloo taste data. Write a release plan "
        "based only on the data provided; do not invent artists, countries, or numbers outside it. "
        f"Data: {json.dumps({'artist': artist, 'genre': genre, 'qloo_taste_tags': qloo_tags, 'related_artists': related, 'candidate_markets': countries}, default=str)}. "
        'Reply JSON only: {"fit_estimate": <int 0-100>, "markets": [{"country": "...", "score": <int>, "reason": "..."}], '
        '"collaborators": [{"name": "...", "why": "..."}], "blurb": "...", "caveat": "..."}. '
        "Ground every market score and collaborator in the provided tags or related artists."
    )

    out = llm.chat_json(
        [{"role": "user", "content": prompt}],
        fallback={"fit_estimate": None, "markets": [], "collaborators": [], "blurb": f"A new release from {artist}.", "caveat": "LLM-only baseline could not be generated."},
    )

    return {
        "artist": artist,
        "song": song_id,
        "data_mode": config.QLOO_MODE,
        "fit_score": out.get("fit_estimate"),
        "markets": out.get("markets") or [],
        "collaborators": out.get("collaborators") or [],
        "blurb": out.get("blurb") or "",
        "caveat": out.get("caveat") or "LLM-only plan, grounded in Qloo data but not scored by the agent.",
        "source": "llm_only",
    }
