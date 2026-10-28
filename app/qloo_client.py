"""Thin, defensive wrapper around the Qloo API.

Rules enforced here (from the hackathon guide, superseding earlier assumptions):
- GET only, X-Api-Key header, https://hackathon.api.qloo.com.
- filter.type validated against config/qloo_params.yaml; unsupported parameters are
  dropped and surfaced as warnings (Qloo silently ignores them otherwise).
- Process-wide rate gate + one 429 retry.
- Every request is logged (key never sent in params, but values truncated anyway).
- QLOO_MODE=mock routes to synthetic sample data instead of the network.
"""
from __future__ import annotations

import threading
import time
from typing import Any, Optional

import httpx
import yaml

from . import cache, config, http_log, mock_data

HEADERS = {"X-Api-Key": config.QLOO_API_KEY, "Content-Type": "application/json"}
QLOO_TTL = 24 * 3600  # server-side caching has no time limit per the guide

_ALLOWED: dict[str, set] = {}
try:
    _data = yaml.safe_load(config.QLOO_PARAMS_FILE.read_text()) or {}
    _ALLOWED = {k: set(v.get("allowed", [])) for k, v in _data.items()}
except Exception:  # noqa: BLE001
    _ALLOWED = {}

_gate_lock = threading.Lock()
_last_ts = 0.0
_request_log: list[dict] = []


def _type_key(filter_type: str) -> str:
    return filter_type.replace("urn:entity:", "").replace("urn:", "")


def _gate() -> None:
    global _last_ts
    with _gate_lock:
        now = time.monotonic()
        wait = config.QLOO_MIN_INTERVAL_SECONDS - (now - _last_ts)
        if wait > 0:
            time.sleep(wait)
        _last_ts = time.monotonic()


def _redact(params: dict) -> dict:
    return {k: (v[:60] + "…" if isinstance(v, str) and len(v) > 60 else v) for k, v in params.items()}


def _log(method: str, path: str, params: dict) -> None:
    _request_log.append({"method": method, "path": path, "params": _redact(params)})
    if len(_request_log) > 500:
        del _request_log[:200]


def drain_requests() -> list[dict]:
    out = list(_request_log)
    _request_log.clear()
    return out


def _get(path: str, params: dict, timeout: float = config.TOOL_TIMEOUT_SECONDS) -> dict:
    _gate()
    url = f"{config.QLOO_BASE_URL}{path}"
    _log("GET", path, params)
    t0 = time.monotonic()
    last = None
    for attempt in range(2):
        r = httpx.get(url, params=params, headers=HEADERS, timeout=timeout)
        if r.status_code == 429 and attempt == 0:
            time.sleep(1.0)
            last = r
            continue
        http_log.record("qloo", path, (time.monotonic() - t0) * 1000, r.status_code < 400)
        r.raise_for_status()
        return r.json()
    if last is not None:
        http_log.record("qloo", path, (time.monotonic() - t0) * 1000, False)
        last.raise_for_status()
    return {}


def _cached(namespace: str, parts: dict, fetch):
    hit = cache.get(namespace, parts, QLOO_TTL)
    if hit is not None:
        return hit
    value = fetch()
    if value is not None:
        cache.put(namespace, parts, value)
    return value


def search(name: str, types: list[str], limit: int = 5) -> dict:
    if config.QLOO_MODE == "mock":
        return mock_data.search(name, types, limit)
    parts = {"name": name, "types": types, "limit": limit}

    def fetch():
        try:
            data = _get("/search", {"query": name, "types": types, "take": limit})
        except Exception as e:  # noqa: BLE001
            return {"ok": False, "candidates": [], "error": _err(e)}
        return {"ok": True, "candidates": _entities(data.get("results") or []), "error": None}

    return _cached("qloo_search", parts, fetch)


def search_tags(term: str, limit: int = 5) -> dict:
    """Resolve a plain term to Qloo tag candidates via GET /v2/tags."""
    if config.QLOO_MODE == "mock":
        return mock_data.search_tags(term, limit)
    parts = {"term": term, "limit": limit}

    def fetch():
        try:
            data = _get("/v2/tags", {"filter.query": term, "take": limit})
        except Exception as e:  # noqa: BLE001
            return {"ok": False, "candidates": [], "error": _err(e)}
        cands = []
        for t in (data.get("results") or {}).get("tags", [])[:limit]:
            cands.append({"id": t.get("tag_id") or t.get("id"), "name": t.get("name"), "type": t.get("subtype")})
        return {"ok": bool(cands), "candidates": cands, "error": None}

    return _cached("qloo_search_tags", parts, fetch)


def by_ids(entity_ids: list[str]) -> dict:
    if config.QLOO_MODE == "mock":
        return mock_data.by_ids(entity_ids)
    parts = {"entity_ids": entity_ids}

    def fetch():
        try:
            data = _get("/entities", {"entity_ids": entity_ids})
        except Exception as e:  # noqa: BLE001
            return {"ok": False, "entities": [], "error": _err(e)}
        return {"ok": True, "entities": _entities(data.get("results") or []), "error": None}

    return _cached("qloo_by_ids", parts, fetch)


def entity_tags(entity_id: str, limit: int = 20) -> dict:
    """Read an entity's `tags` from /entities (reliable; urn:tag is not anchorable)."""
    if config.QLOO_MODE == "mock":
        return mock_data.entity_tags(entity_id, limit)
    parts = {"entity_id": entity_id, "limit": limit}

    def fetch():
        try:
            data = _get("/entities", {"entity_ids": [entity_id]})
        except Exception as e:  # noqa: BLE001
            return {"ok": False, "tags": [], "error": _err(e)}
        ents = data.get("results") or []
        tags = []
        if ents:
            raw = ents[0].get("tags") or (ents[0].get("properties") or {}).get("tags") or []
            for t in raw[:limit]:
                tags.append({"id": t.get("id") or t.get("tag_id"), "name": t.get("name")})
        return {"ok": bool(tags), "tags": tags, "error": None}

    return _cached("qloo_entity_tags", parts, fetch)


def taste_analysis(entity_id: str, limit: int = 20) -> dict:
    return entity_tags(entity_id, limit)


def insights(filter_type: str, **params) -> dict:
    if config.QLOO_MODE == "mock":
        return mock_data.insights(filter_type, **params)
    cleaned, warnings = _validate(filter_type, params)
    parts = {"filter_type": filter_type, **cleaned}

    def fetch():
        try:
            data = _get("/v2/insights", cleaned)
        except Exception as e:  # noqa: BLE001
            return {"ok": False, "results": {}, "error": _err(e), "warnings": warnings}
        return {"ok": True, "results": data.get("results") or {}, "error": None, "warnings": warnings}

    return _cached("qloo_insights", parts, fetch)


def _validate(filter_type: str, params: dict) -> tuple[dict, list[str]]:
    allowed = _ALLOWED.get(_type_key(filter_type))
    cleaned = {"filter.type": filter_type}
    warnings: list[str] = []
    for k, v in params.items():
        if k == "filter.type":
            continue
        if allowed is None or k in allowed:
            cleaned[k] = v
        else:
            warnings.append(k)
    return cleaned, warnings


def demographics(entity_id: str) -> dict:
    """Best-effort age/gender affinity. urn:demographics is documented but not in
    the parameter matrix, so failures degrade gracefully to 'no demographics'."""
    if config.QLOO_MODE == "mock":
        return mock_data.demographics(entity_id)
    out = insights("urn:demographics", **{"signal.interests.entities": entity_id})
    demo = None
    if out["ok"]:
        blocks = out["results"].get("demographics") or []
        if blocks:
            demo = blocks[0].get("query", {})
    return {"ok": out["ok"], "demographics": demo, "error": out["error"]}


def related(entity_type: str, entity_id: str, limit: int = 10, exclude: list[str] | None = None) -> dict:
    params: dict[str, Any] = {"signal.interests.entities": entity_id, "take": limit}
    if exclude:
        params["filter.exclude.entities"] = ",".join(exclude)
    out = insights(entity_type, **params)
    entities = []
    if out["ok"]:
        for e in out["results"].get("entities", [])[:limit]:
            entities.append(_entity(e))
    return {"ok": out["ok"], "entities": entities, "error": out["error"]}


def affinity_between(signal_entity_id: str, target_ids: list[str], tags: list[str] | None = None) -> dict:
    if config.QLOO_MODE == "mock":
        return mock_data.affinity_between(signal_entity_id, target_ids)
    if not target_ids:
        return {"ok": False, "scores": {}, "error": "no target ids"}
    params: dict[str, Any] = {
        "signal.interests.entities": signal_entity_id,
        "filter.results.entities": ",".join(target_ids),
        "take": len(target_ids),
    }
    if tags:
        params["signal.interests.tags"] = ",".join(tags)
    out = insights("urn:entity:artist", **params)
    scores = {}
    if out["ok"]:
        for e in out["results"].get("entities", []):
            if e.get("entity_id") and e.get("score") is not None:
                scores[e["entity_id"]] = e["score"]
    return {"ok": out["ok"] and bool(scores), "scores": scores, "error": out["error"]}


def venues(entity_id: str, city: str, limit: int = 6, tags: list[str] | None = None) -> dict:
    """Place/venue results correlated with an entity in a city, with coordinates.

    Only returned if the place response carries geocode coordinates; we never
    geocode venues ourselves."""
    if config.QLOO_MODE == "mock":
        return mock_data.venues(entity_id, city, limit)
    params: dict[str, Any] = {"signal.interests.entities": entity_id, "filter.geocode.name": city, "take": limit}
    if tags:
        params["filter.tags"] = ",".join(tags)
    out = insights("urn:entity:place", **params)
    places = []
    if out["ok"]:
        for p in out["results"].get("entities", []):
            lat, lng = _coords(p)
            if lat is not None and lng is not None:
                places.append({"name": p.get("name"), "lat": lat, "lng": lng})
    return {"ok": out["ok"] and bool(places), "places": places, "error": out["error"]}


def _coords(raw: dict):
    props = raw.get("properties") or {}
    geo = props.get("geocode") or {}
    lat = geo.get("latitude") if geo.get("latitude") is not None else geo.get("lat")
    lng = geo.get("longitude") if geo.get("longitude") is not None else geo.get("lng")
    if lat is None or lng is None:
        loc = props.get("location") or {}
        lat = loc.get("latitude") if loc.get("latitude") is not None else loc.get("lat")
        lng = loc.get("longitude") if loc.get("longitude") is not None else loc.get("lng")
    return lat, lng


def heatmap(entity_id: str, city: str) -> dict:
    """Geographic affinity of an entity within a city (urn:heatmap, documented in
    the matrix with signal.interests.entities + filter.location.query)."""
    if config.QLOO_MODE == "mock":
        return mock_data.heatmap(entity_id, city)
    out = insights(
        "urn:heatmap",
        **{"filter.location.query": city, "signal.interests.entities": entity_id},
    )
    points = out["results"].get("heatmap") or []
    qs = [p.get("query") or {} for p in points]
    ranks = [q.get("affinity_rank") for q in qs if q.get("affinity_rank") is not None]
    affinities = [q.get("affinity") for q in qs if q.get("affinity") is not None]
    popularities = [q.get("popularity") for q in qs if q.get("popularity") is not None]
    agg = None
    if ranks:
        agg = {
            "mean_affinity_rank": round(sum(ranks) / len(ranks), 4),
            "max_affinity_rank": round(max(ranks), 4),
            "mean_affinity": round(sum(affinities) / len(affinities), 4) if affinities else None,
            "mean_popularity": round(sum(popularities) / len(popularities), 4) if popularities else None,
            "points": len(ranks),
        }
    return {"ok": out["ok"] and bool(points), "aggregate": agg, "points": len(points), "error": out["error"]}


# --- helpers -----------------------------------------------------------------
def _entity(raw: dict) -> dict:
    props = raw.get("properties") or {}
    types = raw.get("types") or []
    subtype = raw.get("subtype") or raw.get("type") or (types[0] if types else None)
    return {
        "id": raw.get("entity_id"),
        "name": raw.get("name"),
        "type": raw.get("type") or (types[0] if types else None),
        "subtype": subtype,
        "popularity": raw.get("popularity"),
        "score": _score(raw),
        "description": props.get("description") or props.get("short_description"),
    }


def _score(raw: dict):
    q = raw.get("query") or {}
    for k in ("score", "affinity", "affinity_score", "rank"):
        if raw.get(k) is not None:
            return float(raw[k])
        if q.get(k) is not None:
            return float(q[k])
    ex = q.get("explainability")
    if isinstance(ex, dict):
        for k in ("score", "affinity", "affinity_score"):
            if ex.get(k) is not None:
                return float(ex[k])
    return None


def _entities(raw: list) -> list[dict]:
    return [_entity(e) for e in raw if e.get("entity_id")]


def _err(e: Exception) -> str:
    if isinstance(e, httpx.HTTPStatusError):
        code = e.response.status_code
        body = e.response.text[:200]
        if code == 401:
            return "HTTP 401: wrong base URL or missing X-Api-Key (hackathon keys only work against hackathon.api.qloo.com)"
        if code == 403:
            return "HTTP 403: unsupported entity type"
        if code == 400 and "valid signal or filter" in body:
            return "HTTP 400: unresolved tag or audience id (use /v2/tags to resolve first)"
        return f"HTTP {code}: {body}"
    if isinstance(e, httpx.TimeoutException):
        return "timeout"
    return f"{type(e).__name__}: {e}"


def ping() -> dict:
    if config.QLOO_MODE == "mock":
        return mock_data.ping()
    t0 = time.monotonic()
    try:
        data = _get("/search", {"query": "Burna Boy", "types": ["urn:entity:artist"], "take": 1}, timeout=15)
        return {"ok": True, "latency_ms": int((time.monotonic() - t0) * 1000), "found": bool(data.get("results"))}
    except Exception as e:  # noqa: BLE001
        return {"ok": False, "latency_ms": int((time.monotonic() - t0) * 1000), "error": _err(e)}
