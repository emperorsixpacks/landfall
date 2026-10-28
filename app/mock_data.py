"""Synthetic Qloo data for QLOO_MODE=mock.

Deterministic, clearly-labeled sample data — never a copy of real responses.
The UI labels mock results as "sample data".
"""
from __future__ import annotations

import hashlib
import uuid

from . import cache, config

MOCK_TTL = 24 * 3600

# A small synthetic Afrobeats catalog (names only; values are invented).
_CATALOG = {
    "burna boy": {
        "tags": ["afrobeats", "afro-fusion", "dancehall", "reggae", "global"],
        "related": ["wizkid", "davido", "rema", "asake", "fireboy dml"],
    },
    "wizkid": {
        "tags": ["afrobeats", "afro-pop", "r&b", "global"],
        "related": ["burna boy", "davido", "tems", "ayra starr"],
    },
    "tems": {
        "tags": ["afrobeats", "alté", "r&b", "soul"],
        "related": ["wizkid", "burna boy", "ayra starr", "ckay"],
    },
    "rema": {
        "tags": ["afrobeats", "afro-rave", "dancehall"],
        "related": ["burna boy", "asake", "ayra starr", "bnxn"],
    },
    "davido": {
        "tags": ["afrobeats", "afro-pop", "global"],
        "related": ["burna boy", "wizkid", "asake", "fireboy dml"],
    },
    "asake": {
        "tags": ["afrobeats", "amapiano", "street-pop"],
        "related": ["burna boy", "rema", "davido", "ayra starr"],
    },
    "ayra starr": {
        "tags": ["afrobeats", "afro-pop", "r&b"],
        "related": ["tems", "rema", "wizkid"],
    },
    "fireboy dml": {
        "tags": ["afrobeats", "afro-pop", "r&b"],
        "related": ["burna boy", "davido"],
    },
    "ckay": {
        "tags": ["afrobeats", "alté", "r&b"],
        "related": ["tems"],
    },
    "bnxn": {
        "tags": ["afrobeats", "afro-fusion", "r&b"],
        "related": ["rema"],
    },
}

_CITIES = {
    "lagos": 0.98,
    "accra": 0.9,
    "london": 0.86,
    "new york": 0.78,
    "abuja": 0.76,
    "paris": 0.72,
    "los angeles": 0.68,
    "johannesburg": 0.64,
}


def _uid(name: str) -> str:
    return str(uuid.UUID(hashlib.md5(name.encode()).hexdigest()))


def _find(name: str):
    q = name.lower().strip()
    for k in _CATALOG:
        if q == k or q in k or k in q:
            return k, _CATALOG[k]
    return None, None


def _tags(key: str) -> list[dict]:
    return [{"id": f"urn:tag:genre:media:{t.replace(' ', '_')}", "name": t.title()} for t in _CATALOG[key]["tags"]]


def search(name: str, types: list[str], limit: int = 5) -> dict:
    key, data = _find(name)
    if not key:
        return {"ok": True, "candidates": [], "error": None}
    subtype = types[0] if types else "urn:entity:artist"
    cand = {
        "id": _uid(key),
        "name": key.title(),
        "type": "urn:entity",
        "subtype": subtype,
        "popularity": 0.99,
        "score": None,
        "description": f"{key.title()} (sample data)",
    }
    return {"ok": True, "candidates": [cand], "error": None, "sample_data": True}


def by_ids(entity_ids: list[str]) -> dict:
    entities = []
    for eid in entity_ids:
        key = next((k for k in _CATALOG if _uid(k) == eid), None)
        if key:
            entities.append(
                {
                    "id": eid,
                    "name": key.title(),
                    "type": "urn:entity",
                    "subtype": "urn:entity:artist",
                    "popularity": 0.99,
                    "score": None,
                    "description": f"{key.title()} (sample data)",
                }
            )
    return {"ok": True, "entities": entities, "error": None, "sample_data": True}


def insights(filter_type: str, **params) -> dict:
    entities = []
    sig = params.get("signal.interests.entities")
    key = _key_by_id(sig) if sig else None
    if filter_type == "urn:entity:artist" and key:
        for i, rname in enumerate(_CATALOG[key]["related"]):
            if rname.lower() == key:
                continue
            entities.append(
                {
                    "entity_id": _uid(rname),
                    "name": rname.title(),
                    "type": "urn:entity",
                    "subtype": "urn:entity:artist",
                    "popularity": 0.9 - i * 0.02,
                    "score": round(0.95 - i * 0.05, 3),
                }
            )
    return {
        "ok": True,
        "results": {"entities": entities},
        "error": None,
        "sample_data": True,
    }


def entity_tags(entity_id: str, limit: int = 20) -> dict:
    key = _key_by_id(entity_id)
    if not key:
        return {"ok": True, "tags": [], "error": None, "sample_data": True}
    return {"ok": True, "tags": _tags(key)[:limit], "error": None, "sample_data": True}


def taste_analysis(entity_id: str, limit: int = 20) -> dict:
    return entity_tags(entity_id, limit)


def demographics(entity_id: str) -> dict:
    key = _key_by_id(entity_id)
    if not key:
        return {"ok": True, "demographics": None, "error": None, "sample_data": True}
    return {
        "ok": True,
        "demographics": {
            "age": {"24_and_younger": 0.3, "25_to_29": 0.4, "30_to_34": 0.2, "35_to_44": 0.05, "45_to_54": -0.2, "55_and_older": -0.4},
            "gender": {"male": 0.1, "female": -0.05},
        },
        "error": None,
        "sample_data": True,
    }


def related(entity_type, entity_id, limit=10, exclude=None) -> dict:
    return insights(entity_type, signal_interests_entities=entity_id, take=limit)


def affinity_between(signal_entity_id, target_ids) -> dict:
    scores = {}
    for i, tid in enumerate(target_ids):
        scores[tid] = round(0.9 - i * 0.07, 3)
    return {"ok": True, "scores": scores, "error": None, "sample_data": True}


def heatmap(entity_id: str, city: str) -> dict:
    key = _key_by_id(entity_id)
    base = _CITIES.get(city.lower().strip())
    if not key or base is None:
        return {"ok": False, "aggregate": None, "points": 0, "error": "no sample data for this city", "sample_data": True}
    return {
        "ok": True,
        "aggregate": {
            "mean_affinity_rank": base,
            "max_affinity_rank": base,
            "mean_affinity": base,
            "mean_popularity": base,
            "points": 24,
        },
        "points": 24,
        "error": None,
        "sample_data": True,
    }


def venues(entity_id: str, city: str, limit: int = 6) -> dict:
    key = _key_by_id(entity_id)
    if not key or city.lower().strip() not in _CITIES:
        return {"ok": False, "places": [], "error": "no sample venues", "sample_data": True}
    return {
        "ok": True,
        "places": [
            {"name": f"{city.title()} Arena", "lat": 0.0, "lng": 0.0},
            {"name": f"{city.title()} Live Hall", "lat": 0.0, "lng": 0.0},
        ][:limit],
        "error": None,
        "sample_data": True,
    }


def ping() -> dict:
    return {"ok": True, "latency_ms": 1, "found": True, "sample_data": True}


# Synthetic tag vocabulary for the sound-to-taste bridge (sample data only).
_TAG_VOCAB = {
    "upbeat": "Upbeat",
    "slow tempo": "Slow Tempo",
    "melancholic": "Melancholic",
    "uplifting": "Uplifting",
    "energetic": "Energetic",
    "mellow": "Mellow",
    "bright": "Bright",
    "rhythmic": "Rhythmic",
}


def search_tags(term: str, limit: int = 5) -> dict:
    t = term.lower().strip()
    cands = []
    for key, name in _TAG_VOCAB.items():
        if key == t or key.startswith(t) or t in key:
            cands.append({"id": f"urn:tag:style:qloo:{key.replace(' ', '_')}", "name": name, "type": "urn:tag:style:qloo"})
    return {"ok": bool(cands), "candidates": cands[:limit], "error": None, "sample_data": True}


def _key_by_id(entity_id: str):
    for k in _CATALOG:
        if _uid(k) == entity_id:
            return k
    return None


def _cached(namespace: str, parts: dict, fn):
    hit = cache.get(namespace, parts, MOCK_TTL)
    if hit is not None:
        return hit
    val = fn()
    if val is not None:
        cache.put(namespace, parts, val)
    return val
