"""Sound-to-taste bridge (Section D).

Maps numeric audio features to plain search terms via config/bridge_rules.yaml,
resolves each term through GET /v2/tags (best fuzzy match only, ratio >= 85),
drops unresolved terms, and never invents a tag id. Returns a bridge trace so the
UI can show the feature -> tag -> Qloo-result chain.
"""
from __future__ import annotations

from typing import Any

import rapidfuzz
import yaml

from . import config, qloo_client as qloo

MIN_FUZZY_RATIO = 85

_rules: list[dict] = []
try:
    _data = yaml.safe_load((config.ROOT / "config" / "bridge_rules.yaml").read_text()) or {}
    _rules = _data.get("rules", [])
except Exception:  # noqa: BLE001
    _rules = []


def _get(features: dict, path: str):
    node: Any = features
    for k in path.split("."):
        if not isinstance(node, dict):
            return None
        node = node.get(k)
    return node


def _satisfies(value, op: str, threshold) -> bool:
    try:
        if op == "gte":
            return value >= threshold
        if op == "lte":
            return value <= threshold
        if op == "gt":
            return value > threshold
        if op == "lt":
            return value < threshold
        if op == "eq":
            return str(value).lower() == str(threshold).lower()
    except (TypeError, ValueError):
        return False
    return False


# Mood words that should suppress contradicting audio tags. A fast, major-key song
# can still be melancholic — lyrics win over naive tempo/mode rules.
MOOD_CONTRADICTS = {
    "melancholic": {"upbeat", "uplifting", "energetic", "euphoric", "bright"},
    "dark": {"upbeat", "uplifting", "bright", "euphoric"},
    "sad": {"upbeat", "uplifting", "energetic"},
    "brooding": {"upbeat", "uplifting", "bright"},
    "anxious": {"upbeat", "uplifting", "mellow", "calm"},
    "euphoric": {"melancholic", "dark", "brooding", "mellow"},
    "joyful": {"melancholic", "dark", "brooding"},
}


def sound_to_tags(features: dict, mood: str | None = None) -> dict:
    """Return {ok, tags: [{id,name,term}], bridge_trace: [{feature,value,rule,search_term,qloo_tag_id|null,used_in[]}]}."""
    if not features:
        return {"ok": False, "tags": [], "bridge_trace": []}

    trace = []
    tags = []
    seen_terms: set[str] = set()
    for rule in _rules:
        term = rule.get("search_term")
        if not term or term in seen_terms:
            continue
        value = _get(features, rule["feature"])
        if value is None or not _satisfies(value, rule["op"], rule["value"]):
            continue
        seen_terms.add(term)

        qloo_id = None
        qloo_name = None
        res = qloo.search_tags(term, limit=5)
        if res.get("ok"):
            best = None
            best_ratio = 0
            for c in res["candidates"]:
                ratio = rapidfuzz.fuzz.ratio(term.lower(), (c.get("name") or "").lower())
                if ratio >= MIN_FUZZY_RATIO and ratio > best_ratio:
                    best = c
                    best_ratio = ratio
            if best:
                qloo_id = best.get("id")
                qloo_name = best.get("name")
                tags.append({"id": qloo_id, "name": qloo_name, "term": term})

        trace.append(
            {
                "feature": rule["feature"],
                "value": value,
                "rule": f"{rule['feature']} {rule['op']} {rule['value']}",
                "search_term": term,
                "qloo_tag_id": qloo_id,
                "qloo_tag_name": qloo_name,
                "used_in": [],
            }
        )

    # Lyrics mood overrides naive audio tags: drop tags that contradict the mood.
    if mood:
        drop = MOOD_CONTRADICTS.get(mood.lower(), set())
        if drop:
            tags = [t for t in tags if (t.get("name") or "").lower() not in drop]
            for entry in trace:
                if (entry.get("qloo_tag_name") or "").lower() in drop:
                    entry["qloo_tag_id"] = None
                    entry["qloo_tag_name"] = None
                    entry["dropped_reason"] = "mood conflict"

    return {"ok": bool(tags), "tags": tags, "bridge_trace": trace}


def tag_ids(tags: list[dict]) -> list[str]:
    return [t["id"] for t in tags if t.get("id")]
