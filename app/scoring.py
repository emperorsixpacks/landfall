"""Fit score — pure code, never the LLM.

fit = 0.5 * catalog_match + 0.5 * audience_match
  catalog_match: comparables' tags vs the artist's catalog profile
  audience_match: comparables' tags vs the audience profile
Hook strength is reported separately as `clip_strength`, not folded into fit.
Missing parts are renormalized and flagged.
"""
from __future__ import annotations

from . import config

FIT_WEIGHTS = {"catalog_match": 0.5, "audience_match": 0.5}


def _jaccard(a: set, b: set) -> float:
    if not a and not b:
        return 0.0
    return len(a & b) / len(a | b)


def _overlap(comparable_tags: list[str], profile_tags: list[str]):
    a = {t.lower() for t in comparable_tags if t}
    b = {t.lower() for t in profile_tags if t}
    if not a or not b:
        return None
    return round(_jaccard(a, b) * 100.0, 1)


def catalog_match(comparable_tags, catalog_tags):
    return _overlap(comparable_tags, catalog_tags)


def audience_match(comparable_tags, audience_tags):
    return _overlap(comparable_tags, audience_tags)


def clip_strength(hooks: list[dict]):
    if not hooks:
        return None
    top = max((h.get("score") for h in hooks if h.get("score") is not None), default=None)
    if top is None:
        return None
    return round(top * 100.0, 1)


def score_fit(evidence: dict) -> dict:
    """evidence: {comparable_tags, catalog_tags, audience_tags, hooks}"""
    comparable_tags = evidence.get("comparable_tags", [])
    parts = {
        "catalog_match": catalog_match(comparable_tags, evidence.get("catalog_tags", [])),
        "audience_match": audience_match(comparable_tags, evidence.get("audience_tags", [])),
    }
    cs = clip_strength(evidence.get("hooks", []))

    warnings = [f"{k} unavailable" for k, v in parts.items() if v is None]
    if cs is None:
        warnings.append("clip strength unavailable")

    present = {k: v for k, v in parts.items() if v is not None}
    if not present:
        return {
            "fit": None,
            "breakdown": parts,
            "clip_strength": cs,
            "explanation": "No signals resolved; fit could not be computed.",
            "warnings": warnings,
        }

    total_w = sum(FIT_WEIGHTS[k] for k in present)
    fit = round(sum(FIT_WEIGHTS[k] * present[k] for k in present) / total_w, 1)
    fit = min(100.0, max(0.0, fit))

    return {
        "fit": fit,
        "breakdown": {k: (round(v, 1) if v is not None else None) for k, v in parts.items()},
        "clip_strength": cs,
        "explanation": _explain(parts, cs, warnings),
        "warnings": warnings,
    }


def _explain(parts: dict, cs, warnings: list[str]) -> str:
    sents = []
    cm = parts.get("catalog_match")
    am = parts.get("audience_match")
    if cm is not None:
        sents.append(f"Catalog match is {cm:.0f}/100, from tag overlap between the song's comparables and the artist's catalog profile.")
    if am is not None:
        sents.append(f"Audience match is {am:.0f}/100, from tag overlap between the song's comparables and the audience profile.")
    if cs is not None:
        sents.append(f"Clip strength is {cs:.0f}/100, from the strongest 15-30 second window.")
    for w in warnings:
        sents.append(f"{w.capitalize()} was unavailable and excluded from the score.")
    return " ".join(sents)
