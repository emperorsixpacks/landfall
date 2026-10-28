"""Plain-LLM baseline for the side-by-side comparison.

Runs the same artist + song through the LLM with NO Qloo tools, so the demo can
show the difference between a taste-data-grounded plan and a plain model's guesses.
"""
from __future__ import annotations

import json

from . import config, llm, lookup


def run_baseline(request: dict) -> dict:
    artist = (request.get("artist") or "").strip() or "the artist"
    song_id = request.get("song_id")
    genre = request.get("genre")
    cities = request.get("cities") or []

    context = {"genre": genre, "artist": artist}
    if artist:
        r = lookup.find_artist(artist)
        if r.get("ok"):
            a = r["artist"]
            context["top_songs"] = a.get("top_songs", [])[:5]
            context["related"] = a.get("related", [])[:5]

    prompt = (
        "You are a plain LLM with NO access to taste data, streaming numbers, or geographic "
        "audience affinity. Produce a release plan for the artist using only general knowledge. "
        f"Context: {json.dumps(context, default=str)}. Candidate markets: {cities or '(none)'}. "
        "Be honest that everything is a guess. Reply JSON only with the shape: "
        '{"fit_estimate": <int 0-100>, "markets": [{"city": "...", "score": <int>, "reason": "..."}], '
        '"collaborators": [{"name": "...", "why": "..."}], "blurb": "...", "caveat": "..."}. '
        "Do not invent numbers that look precise; round them."
    )

    out = llm.chat_json(
        [{"role": "user", "content": prompt}],
        fallback={
            "fit_estimate": None,
            "markets": [],
            "collaborators": [],
            "blurb": f"A new release from {artist}.",
            "caveat": "Plain LLM baseline (no taste data) could not be generated.",
        },
    )

    return {
        "artist": artist,
        "song": song_id,
        "data_mode": config.QLOO_MODE,
        "fit_score": out.get("fit_estimate"),
        "markets": out.get("markets") or [],
        "collaborators": out.get("collaborators") or [],
        "blurb": out.get("blurb") or "",
        "caveat": out.get("caveat") or "Plain LLM estimate with no taste data.",
        "source": "plain_llm",
    }
