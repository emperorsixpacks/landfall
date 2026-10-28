"""Tool implementations and schemas for the agent.

Each tool writes full results into the scratchpad (state) and returns only a
short summary string to the model. Argument validation is code's job; handlers
never raise into the loop.
"""
from __future__ import annotations

import uuid
from typing import Any, Callable

import rapidfuzz

from . import audio, bridge, cities, config, llm, lookup, qloo_client as qloo

TYPE_MAP = {
    "artist": "urn:entity:artist",
    "book": "urn:entity:book",
    "brand": "urn:entity:brand",
    "destination": "urn:entity:destination",
    "movie": "urn:entity:movie",
    "person": "urn:entity:person",
    "place": "urn:entity:place",
    "podcast": "urn:entity:podcast",
    "tv_show": "urn:entity:tv_show",
    "video_game": "urn:entity:video_game",
}

ALLOWED_DESCRIPTORS = [
    "smooth", "melancholic", "danceable", "percussive", "warm", "bright", "dark",
    "minimal", "dense", "acoustic", "electronic", "groovy", "mellow", "anthemic",
    "laid-back", "driving", "hypnotic", "energetic", "airy", "heavy", "bouncy",
    "textured", "vocal", "instrumental", "uplifting", "brooding",
]
TEMPO_BANDS = ["slow", "mid-tempo", "upbeat", "fast"]
ENERGY_BANDS = ["low", "medium", "high"]


# --- state helpers ------------------------------------------------------------
def _get(state: dict, *keys: str, default=None):
    node = state
    for k in keys:
        if not isinstance(node, dict):
            return default
        node = node.get(k)
    return default if node is None else node


# --- schemas ------------------------------------------------------------------
TOOL_SCHEMAS: dict[str, dict] = {
    "find_artist": {
        "description": "Public YouTube Music lookup for an artist name.",
        "args": {"query": {"type": "str", "required": True}},
    },
    "find_home_city": {
        "description": "Determine the artist's home city (globe origin) from their description.",
        "args": {
            "artist": {"type": "str"},
            "description": {"type": "str"},
        },
    },
    "qloo_search": {
        "description": "Resolve a name to a Qloo entity (artist/brand/place/etc).",
        "args": {
            "name": {"type": "str", "required": True},
            "type": {"type": "str", "required": True, "choices": list(TYPE_MAP)},
        },
    },
    "qloo_insights": {
        "description": "Ranked recommendations from taste signals.",
        "args": {
            "type": {"type": "str", "required": True, "choices": list(TYPE_MAP)},
            "signals": {"type": "dict", "required": True},
            "location": {"type": "str"},
            "limit": {"type": "int", "default": 10},
        },
    },
    "qloo_audience": {
        "description": "Build the audience taste profile (tags + demographics).",
        "args": {
            "entities": {"type": "list"},
            "tags": {"type": "list"},
            "location": {"type": "str"},
            "demographics": {"type": "bool", "default": True},
        },
    },
    "analyze_audio": {
        "description": "Tempo, key, energy, sections, and hook windows for a song.",
        "args": {"song_id": {"type": "str", "required": True}},
    },
    "cut_clips": {
        "description": "Cut the top hook windows into mp3 clips.",
        "args": {
            "song_id": {"type": "str", "required": True},
            "windows": {"type": "list", "required": True},
        },
    },
    "describe_sound": {
        "description": "Turn audio features into plain descriptors and 'sounds like' comparables.",
        "args": {"features": {"type": "dict", "required": True}},
    },
    "sound_to_tags": {
        "description": "Map audio features to resolved Qloo tags (sound-to-taste bridge).",
        "args": {"features": {"type": "dict"}},
    },
    "write_captions": {
        "description": "Write one short caption per clip.",
        "args": {
            "clips": {"type": "list", "required": True},
            "audience_profile": {"type": "dict", "required": True},
        },
    },
    "youtube_audience": {
        "description": "Owner YouTube Analytics demographics (optional, feature-flagged).",
        "args": {"token": {"type": "str"}},
    },
}


def validate_args(name: str, args: dict) -> list[str]:
    schema = TOOL_SCHEMAS.get(name)
    if schema is None:
        return [f"unknown tool {name}"]
    errors = []
    for field, spec in schema["args"].items():
        val = args.get(field)
        if spec.get("required") and val is None:
            errors.append(f"missing required arg '{field}'")
            continue
        if val is None:
            continue
        t = spec.get("type")
        if t == "str" and not isinstance(val, str):
            errors.append(f"'{field}' must be a string")
        if t == "int" and (not isinstance(val, int) or isinstance(val, bool)):
            errors.append(f"'{field}' must be an integer")
        if t == "dict" and not isinstance(val, dict):
            errors.append(f"'{field}' must be an object")
        if t == "list" and not isinstance(val, list):
            errors.append(f"'{field}' must be a list")
        if t == "bool" and not isinstance(val, bool):
            errors.append(f"'{field}' must be a boolean")
        if spec.get("choices") and val not in spec["choices"]:
            errors.append(f"'{field}' must be one of {spec['choices']}")
    return errors


# --- tool handlers ------------------------------------------------------------
def _find_artist(args, state) -> str:
    q = args["query"]
    res = lookup.find_artist(q)
    if not res["ok"]:
        state["errors"].append(f"find_artist({q}): {res.get('error')}")
        return f"Artist lookup failed for '{q}' ({res.get('error')})."
    a = res["artist"]
    state["artist_name"] = a["name"]
    state.setdefault("catalog", {})
    state["catalog"]["top_song_names"] = [s.get("title") for s in a.get("top_songs", []) if s.get("title")]
    state["catalog"]["top_songs"] = a.get("top_songs", [])
    state["catalog"]["related_names"] = [r for r in a.get("related", []) if r]
    state["catalog"]["description"] = a.get("description")
    state["catalog"]["albums"] = a.get("albums", [])
    state["catalog"]["genres"] = a.get("genres", [])
    state["catalog"]["image"] = a.get("image")
    state.setdefault("evidence", {})[f"yt:{a['name']}"] = (
        f"{len(a.get('top_songs', []))} top songs, {len(a.get('related', []))} related"
    )
    return (
        f"Found '{a['name']}' via {res['source']}: "
        f"{len(a.get('top_songs', []))} top songs, {len(a.get('related', []))} related artists."
    )


def _find_home_city(args, state) -> str:
    artist = args.get("artist") or state.get("artist_name")
    description = args.get("description") or state.get("catalog", {}).get("description") or ""
    names = sorted(cities.city_names())
    if not artist:
        return "No artist name to resolve a home city from."
    prompt = (
        f"Identify the home city of the music artist '{artist}' from this description: "
        f"'{description[:500]}'. Choose ONLY from this list, or return null if none clearly "
        f"applies: {', '.join(names)}. Reply JSON: {{\"city\": \"<one from the list>\"}} or {{\"city\": null}}."
    )
    out = llm.chat_json([{"role": "user", "content": prompt}], fallback={"city": None})
    entry = cities.city_entry(out.get("city")) if out.get("city") else None
    if entry:
        state["origin"] = {"city": entry["city"], "lat": entry["lat"], "lng": entry["lng"]}
        return f"Home city resolved to {entry['city']} ({entry['country']})."
    return "Could not determine the artist's home city from the description."


def _qloo_search(args, state) -> str:
    name, etype = args["name"], args["type"]
    qtype = TYPE_MAP[etype]
    res = qloo.search(name, [qtype])
    cands = res.get("candidates") or []
    if not cands:
        state["errors"].append(f"qloo_search({name}) empty")
        return f"Searched Qloo for '{name}' ({etype}), no matches."
    chosen = None
    for c in cands:
        if rapidfuzz.fuzz.ratio(c["name"].lower(), name.lower()) >= 90:
            chosen = c
            break
    if chosen is None and len(cands) == 1:
        chosen = cands[0]
    state.setdefault("entities", [])
    if chosen:
        state["entities"].append(
            {"name": chosen["name"], "id": chosen["id"], "type": etype, "score": chosen.get("score")}
        )
        state.setdefault("evidence", {})[f"qloo:{chosen['name']}"] = chosen["id"]
    picked = chosen["name"] if chosen else (cands[0]["name"] if cands else "?")
    return f"Searched Qloo for '{name}' ({etype}), {len(cands)} match(es), picked '{picked}'."


def _qloo_insights(args, state) -> str:
    qtype = TYPE_MAP[args["type"]]
    signals = args.get("signals") or {}
    if not signals.get("entities") and not signals.get("tags"):
        return "qloo_insights needs at least one signal (entities or tags)."
    params: dict[str, Any] = {
        "signal.interests.entities": ",".join(signals["entities"]) if signals.get("entities") else None,
        "signal.interests.tags": ",".join(signals["tags"]) if signals.get("tags") else None,
        "take": min(args.get("limit") or 10, config.QLOO_INSIGHTS_LIMIT),
    }
    params = {k: v for k, v in params.items() if v}
    if args.get("location"):
        params["signal.location.query"] = args["location"]
    out = qloo.insights(qtype, **params)
    ents = []
    if out["ok"]:
        ents = [e for e in out["results"].get("entities", []) if e.get("entity_id")]
    state.setdefault("insights_results", []).extend(ents)
    if not ents:
        return f"qloo_insights for {args['type']} returned nothing{(' (' + out['error'] + ')') if out['error'] else ''}."
    top = ", ".join(e["name"] for e in ents[:5] if e.get("name"))
    return f"qloo_insights ({args['type']}): {len(ents)} result(s) — {top}."


def _is_uuid(s) -> bool:
    try:
        uuid.UUID(str(s))
        return True
    except (ValueError, TypeError, AttributeError):
        return False


def _qloo_audience(args, state) -> str:
    artist_entity = _find_artist_entity(state)
    ids: list[str] = []
    if artist_entity and artist_entity.get("id"):
        ids.append(artist_entity["id"])

    for e in (args.get("entities") or []):
        if isinstance(e, str) and _is_uuid(e) and e not in ids:
            ids.append(e)

    # Resolve any provided names to ids so the model can't pass freeform strings.
    for e in (args.get("entities") or []):
        if isinstance(e, str) and not _is_uuid(e):
            r = qloo.search(e, [TYPE_MAP["artist"]])
            if r.get("candidates"):
                cid = r["candidates"][0]["id"]
                if cid and cid not in ids:
                    ids.append(cid)

    if not ids:
        return "qloo_audience has no resolved entity to profile yet; call qloo_search first."

    profile_tags = []
    for eid in ids:
        ta = qloo.entity_tags(eid, limit=20)
        if ta["ok"]:
            profile_tags.extend(ta["tags"])
    demo = None
    if args.get("demographics", True) and ids:
        d = qloo.demographics(ids[0])
        if d["ok"]:
            demo = d["demographics"]

    state.setdefault("audience", {})
    state["audience"]["tags"] = profile_tags
    state["audience"]["demographics"] = demo
    state.setdefault("evidence", {})["audience_tags"] = len(profile_tags)
    if not profile_tags:
        return "qloo_audience returned no tags (coverage gap)."
    return (
        f"Audience profile: {len(profile_tags)} tags"
        + (", demographics resolved" if demo else ", no demographics")
        + "."
    )


def _analyze_audio(args, state) -> str:
    song_id = args["song_id"]
    res = audio.analyze(song_id)
    if not res.get("ok"):
        state["errors"].append(f"analyze_audio: {res.get('error')}")
        return f"Audio analysis failed: {res.get('error')}"
    state["audio"] = res
    return (
        f"Audio: {res['tempo']} BPM, key {res['key']} {res['mode']}, "
        f"{len(res.get('hooks', []))} hook window(s)."
    )


def _cut_clips(args, state) -> str:
    song_id, windows = args["song_id"], args.get("windows") or []
    res = audio.cut_clips(song_id, windows)
    clips = res.get("clips") or []
    state["clips"] = clips
    ok = [c for c in clips if "error" not in c]
    return f"Cut {len(ok)} clip(s)" + (f", {len(clips) - len(ok)} failed" if len(clips) != len(ok) else "") + "."


def _sound_to_tags(args, state) -> str:
    features = args.get("features") or state.get("audio") or {}
    res = bridge.sound_to_tags(features)
    state["bridge"] = {"tags": res.get("tags", []), "trace": res.get("bridge_trace", [])}
    if not res.get("ok"):
        return "sound_to_tags resolved no Qloo tags (coverage gap)."
    return f"Sound-to-taste: {len(res['tags'])} tag(s) resolved."


def _describe_sound(args, state) -> str:
    features = args.get("features") or state.get("audio") or {}
    catalog = state.get("catalog", {})
    candidates = sorted(
        set(
            list(catalog.get("related_names", []))
            + [e["name"] for e in state.get("entities", []) if e.get("name")]
            + [e["name"] for e in state.get("related_entities", []) if e.get("name")]
            + ([state.get("genre_tag")] if state.get("genre_tag") else [])
        )
    )

    prompt = (
        "You describe a new song from its audio features only. Use a constrained vocabulary. "
        f"Allowed descriptors (pick 3 to 5): {', '.join(ALLOWED_DESCRIPTORS)}. "
        f"Tempo band from: {', '.join(TEMPO_BANDS)}. Energy band from: {', '.join(ENERGY_BANDS)}. "
        f"Comparables MUST come from this list only (pick 0 to 3): {', '.join(candidates) if candidates else '(none available)'}. "
        "If no comparable fits, return an empty comparables array. Do not invent artist names. "
        f"Audio features: {features}. "
        'Reply JSON: {"descriptors":[...], "tempo_band":"...", "energy_band":"...", "comparables":[...]}'
    )
    out = llm.chat_json(
        [{"role": "user", "content": prompt}],
        fallback={"descriptors": [], "tempo_band": "mid-tempo", "energy_band": "medium", "comparables": []},
    )
    descriptors = [d for d in (out.get("descriptors") or []) if d in ALLOWED_DESCRIPTORS][:5]
    tempo_band = out.get("tempo_band") if out.get("tempo_band") in TEMPO_BANDS else "mid-tempo"
    energy_band = out.get("energy_band") if out.get("energy_band") in ENERGY_BANDS else "medium"

    comparables = []
    for name in (out.get("comparables") or [])[:3]:
        r = qloo.search(name, [TYPE_MAP["artist"]])
        c = r.get("candidates") or []
        if c:
            c0 = c[0]
            comparables.append({"name": c0["name"], "id": c0["id"], "score": c0.get("score")})

    state["sound"] = {
        "descriptors": descriptors,
        "tempo_band": tempo_band,
        "energy_band": energy_band,
        "comparables": comparables,
    }
    return (
        f"Sound: {', '.join(descriptors) or '(no descriptors)'}, {tempo_band}/{energy_band}, "
        f"{len(comparables)} comparable(s) resolved in Qloo."
    )


def _write_captions(args, state) -> str:
    clips = args.get("clips") or state.get("clips") or []
    audience = args.get("audience_profile") or state.get("audience", {})
    if not clips:
        return "No clips to caption."
    prompt = (
        "Write one short caption per clip for a social teaser. Max 120 characters each, no emojis, "
        f"grounded only in these descriptors ({state.get('sound', {}).get('descriptors', [])}) and audience tags "
        f"({[t.get('name') for t in audience.get('tags', [])][:10]}). "
        f"Clips: {[{'id': c.get('id'), 'start': c.get('start'), 'end': c.get('end')} for c in clips]}. "
        'Reply JSON: {"captions": [{"id": "...", "caption": "..."}]}'
    )
    out = llm.chat_json(
        [{"role": "user", "content": prompt}],
        fallback={"captions": [{"id": c.get("id"), "caption": "New music out now."} for c in clips]},
    )
    caps = {c.get("id"): c.get("caption", "") for c in out.get("captions", [])}
    for c in state["clips"]:
        c["caption"] = (caps.get(c.get("id")) or "New music out now.")[:120]
    return f"Wrote {len(state['clips'])} caption(s)."


def _youtube_audience(args, state) -> str:
    if not config.YOUTUBE_AUDIENCE_ENABLED:
        return "YouTube Analytics is not enabled (feature flag off). Using Qloo related-artist proxy."
    state["errors"].append("youtube_audience not implemented yet")
    return "YouTube Analytics is not implemented in this build; falling back to Qloo proxy."


def _find_artist_entity(state) -> dict | None:
    artist_name = state.get("artist_name")
    entities = state.get("entities", [])
    if artist_name:
        for e in entities:
            if e.get("type") == "artist" and rapidfuzz.fuzz.ratio(e["name"].lower(), artist_name.lower()) >= 80:
                return e
    for e in entities:
        if e.get("type") == "artist":
            return e
    return None


TOOLS: dict[str, Callable] = {
    "find_artist": _find_artist,
    "find_home_city": _find_home_city,
    "qloo_search": _qloo_search,
    "qloo_insights": _qloo_insights,
    "qloo_audience": _qloo_audience,
    "analyze_audio": _analyze_audio,
    "cut_clips": _cut_clips,
    "describe_sound": _describe_sound,
    "sound_to_tags": _sound_to_tags,
    "write_captions": _write_captions,
    "youtube_audience": _youtube_audience,
}
