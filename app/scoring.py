"""Fit score — pure code, never the LLM.

fit = w_catalog * catalog_similarity + w_audience * audience_affinity + w_hook * hook_strength
Missing components are renormalized and flagged, so the score is always honest.
"""
from __future__ import annotations

from typing import Any

from . import config


def _jaccard(a: set, b: set) -> float:
    if not a and not b:
        return 0.0
    return len(a & b) / len(a | b)


def catalog_similarity(song_tag_names: list[str], artist_tag_names: list[str]) -> float:
    a = {t.lower() for t in song_tag_names if t}
    b = {t.lower() for t in artist_tag_names if t}
    if not a or not b:
        return None
    return round(_jaccard(a, b) * 100.0, 1)


def audience_affinity(comparable_scores: list[float]) -> float:
    scores = [s for s in comparable_scores if s is not None]
    if not scores:
        return None
    return round(sum(scores) / len(scores) * 100.0, 1)


def hook_strength(hooks: list[dict]) -> float:
    if not hooks:
        return None
    top = max(h["score"] for h in hooks if h.get("score") is not None)
    return round(top * 100.0, 1)


def score_fit(evidence: dict) -> dict:
    """evidence: {song_tags, artist_tags, comparable_scores, hooks}"""
    weights = config.FIT_WEIGHTS
    parts = {
        "catalog": catalog_similarity(evidence.get("song_tags", []), evidence.get("artist_tags", [])),
        "audience": audience_affinity(evidence.get("comparable_scores", [])),
        "hook": hook_strength(evidence.get("hooks", [])),
    }

    present = {k: v for k, v in parts.items() if v is not None}
    warnings = []
    for k, v in parts.items():
        if v is None:
            warnings.append(f"{k} unavailable")
    if not present:
        return {"fit": None, "breakdown": parts, "explanation": "No signals resolved; fit could not be computed.", "warnings": warnings}

    total_w = sum(weights[k] for k in present)
    fit = sum(weights[k] * present[k] for k in present) / total_w
    fit = round(min(100.0, max(0.0, fit)), 1)

    return {
        "fit": fit,
        "breakdown": {k: (round(v, 1) if v is not None else None) for k, v in parts.items()},
        "explanation": _explain(parts, warnings),
        "warnings": warnings,
    }


def _explain(parts: dict, warnings: list[str]) -> str:
    catalog = parts["catalog"]
    audience = parts["audience"]
    hook = parts["hook"]
    sents = []
    if catalog is not None:
        sents.append(
            f"Catalog similarity is {catalog:.0f}/100, from tag overlap between the song's comparables and the artist's taste tags."
        )
    if audience is not None:
        sents.append(
            f"Audience affinity is {audience:.0f}/100, the mean Qloo affinity of the comparables against the artist's audience."
        )
    if hook is not None:
        sents.append(
            f"Hook strength is {hook:.0f}/100, from the strongest 15-30 second window in the audio."
        )
    for w in warnings:
        sents.append(f"{w.capitalize()} was unavailable and renormalized out of the score.")
    return " ".join(sents)
