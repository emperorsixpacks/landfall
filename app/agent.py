"""Agent orchestration: the JSON action loop + deterministic FINISH stage."""
from __future__ import annotations

import asyncio
import json
import time
from typing import Any

import rapidfuzz

from . import audio, bridge, cities, config, http_log, llm, lyrics, qloo_client as qloo, scoring, tools

SYSTEM_PROMPT = (
    "You plan music releases using Qloo taste data. Call exactly one tool per turn "
    "and reply with JSON only. Never invent artists, cities, scores, or numbers; use "
    "only tool results. If a lookup returns nothing, try one variant (alternate spelling, "
    "then related artists), then move on and note the gap. Do not repeat a call with "
    "identical arguments. Follow the stage order. Reply {\"final\": true} only when "
    "stages 1 to 7 are done or impossible."
)

STAGE_BY_TOOL = {
    "find_artist": "IDENTIFY",
    "find_home_city": "IDENTIFY",
    "qloo_search": "IDENTIFY",
    "qloo_audience": "PROFILE",
    "qloo_insights": "TARGET",
    "analyze_audio": "LISTEN",
    "describe_sound": "COMPARE",
    "sound_to_tags": "BRIDGE",
    "cut_clips": "CLIP",
    "write_captions": "CLIP",
    "youtube_audience": "TARGET",
}


def _new_state(request: dict) -> dict:
    return {
        "artist_name": request.get("artist"),
        "song_id": request.get("song_id"),
        "genre_tag": request.get("genre"),
        "cities": cities.normalize_selection(request.get("cities") or []),
        "catalog": {"top_song_names": [], "related_names": [], "tags": [], "artist_entity": None},
        "audience": {"tags": [], "demographics": None},
        "audio": None,
        "sound": None,
        "origin": None,
        "markets": [],
        "collaborators": [],
        "clips": [],
        "entities": [],
        "insights_results": [],
        "evidence": {},
        "errors": [],
        "steps_used": 0,
    }


def _summary(state: dict) -> str:
    done = ", ".join(sorted(state.get("called_tools", []))) or "(none yet)"
    parts = [
        f"artist={state.get('artist_name')}",
        f"song={state.get('song_id') or 'none'}",
        f"entities_resolved={len(state.get('entities', []))}",
        f"audience_tags={len(state.get('audience', {}).get('tags', []))}",
        f"audio={'yes' if state.get('audio') else 'no'}",
        f"sound={'yes' if state.get('sound') else 'no'}",
        f"clips={len(state.get('clips', []))}",
        f"tools_called=[{done}]",
    ]
    return "; ".join(parts)


async def run_agent(request: dict):
    """Async generator: yields trace events, then the final result."""
    state = _new_state(request)
    t0 = time.monotonic()
    yield {"type": "start", "summary": f"Planning release for {state['artist_name'] or 'unknown artist'}"}

    # Step 1: identify the artist via YouTube Music (always, deterministically, first).
    if state["artist_name"]:
        _, ev = await _exec("find_artist", {"query": state["artist_name"]}, state, "IDENTIFY", source="fallback")
        yield ev

    last_results: list[str] = []
    stalls = 0

    for step in range(config.MAX_STEPS):
        if time.monotonic() - t0 > config.TIME_BUDGET_SECONDS:
            state["errors"].append("time budget exceeded")
            break
        if not llm.config.llm_ready():
            break

        messages = _messages(state, last_results, config.MAX_STEPS - step, _next_action(state, request))
        decision = await asyncio.to_thread(
            llm.chat_json, messages, 0.0, 2, {"final": True}
        )

        if "tool" not in decision:
            break  # {"final": true}

        tool_name = decision.get("tool")
        args = decision.get("args") or {}
        why = decision.get("why", "")
        stage = STAGE_BY_TOOL.get(tool_name, "?")

        # Validate; retry once with the error shown.
        errors = tools.validate_args(tool_name, args) if tool_name in tools.TOOLS else [f"unknown tool {tool_name}"]
        if errors:
            retry = await asyncio.to_thread(
                llm.chat_json, _retry_messages(messages, errors, decision), 0.0, 1, None
            )
            if retry and retry.get("tool") == tool_name:
                args = retry.get("args") or {}
                errors = tools.validate_args(tool_name, args)
        if errors or tool_name not in tools.TOOLS:
            state["errors"].append(f"invalid tool call: {tool_name} {errors}")
            yield _event(step, stage, tool_name, why, args, f"invalid: {errors}", "error")
            last_results.append(f"{tool_name} invalid: {errors}")
            stalls += 1
            if stalls >= 3:
                break
            continue

        # Hard no-repeat guard: reject an identical call with the same args.
        call_key = _call_key(tool_name, args)
        if call_key in state.setdefault("called", set()):
            ev = _event(step, stage, tool_name, why, args, "duplicate call — pick a different action", "fallback")
            state.setdefault("trace", []).append(ev["event"])
            yield ev
            last_results.append(f"{tool_name} duplicate call, skipped")
            last_results = last_results[-3:]
            stalls += 1
            if stalls >= 3:
                break
            continue
        state["called"].add(call_key)

        summary, ev = await _exec(tool_name, args, state, stage, why, step)
        stalls = 0
        yield ev
        last_results.append(summary)
        last_results = last_results[-3:]

    async for item in _finish(state, request):
        yield item


async def _exec(tool_name, args, state, stage, why="", step=0, source="agent"):
    t0 = time.monotonic()
    handler = tools.TOOLS[tool_name]
    try:
        summary = await asyncio.to_thread(handler, args, state)
        status = "ok"
    except Exception as e:  # noqa: BLE001
        summary = f"{tool_name} failed: {e}"
        state["errors"].append(summary)
        status = "error"
    latency = int((time.monotonic() - t0) * 1000)
    state["steps_used"] += 1
    state.setdefault("called_tools", []).append(tool_name)
    state.setdefault("called", set()).add(_call_key(tool_name, args))
    event = _event(step, stage, tool_name, why, args, summary, status, latency, source)
    state.setdefault("trace", []).append(event["event"])
    return summary, event


def _event(step, stage, tool, why, args, summary, status, latency=None, source="agent"):
    return {
        "type": "event",
        "event": {
            "step": step,
            "stage": stage,
            "tool": tool,
            "why": why,
            "args_summary": _short(args),
            "result_summary": summary,
            "latency_ms": latency,
            "status": status,
            "source": source,
        },
    }


def _short(v: Any, limit: int = 80) -> str:
    s = str(v)
    return s if len(s) <= limit else s[: limit - 1] + "…"


def _tool_reference() -> str:
    lines = ["Available tools (reply with exactly one of these):"]
    for name, schema in tools.TOOL_SCHEMAS.items():
        parts = []
        for field, spec in schema["args"].items():
            t = spec.get("type")
            req = "required" if spec.get("required") else "optional"
            extra = f" one of {spec['choices']}" if spec.get("choices") else ""
            parts.append(f"{field}:{t}({req}{extra})")
        lines.append(f"- {name}({', '.join(parts)}) — {schema['description']}")
    return "\n".join(lines)


FLOW_HINT = (
    "Stage order: 1 IDENTIFY (find_artist, then qloo_search for the artist, top songs, "
    "related artists) 2 PROFILE (qloo_audience) 3 LISTEN (analyze_audio, only if a song "
    "was uploaded) 4 COMPARE (describe_sound) 5 TARGET (qloo_insights per market, then "
    "collaborators) 6 CLIP (cut_clips, write_captions) 7 SCORE (reply final). Never "
    "repeat an identical call. If a lookup is empty, try one variant spelling, then move on."
)

_SYSTEM = SYSTEM_PROMPT + "\n\n" + _tool_reference() + "\n\n" + FLOW_HINT


def _next_action(state: dict, request: dict):
    if state.get("artist_name") and not state.get("entities"):
        return ("qloo_search", {"name": state["artist_name"], "type": "artist"})
    if state.get("entities") and not state.get("audience", {}).get("tags"):
        return ("qloo_audience", {})
    if state.get("song_id") and not state.get("audio"):
        return ("analyze_audio", {"song_id": state["song_id"]})
    if state.get("audio") and state["audio"].get("ok") and not state.get("sound"):
        return ("describe_sound", {"features": state["audio"]})
    if state.get("artist_name") and not state.get("origin"):
        return ("find_home_city", {})
    return None


def _canon(v: Any) -> Any:
    if isinstance(v, dict):
        return {k: _canon(val) for k, val in sorted(v.items())}
    if isinstance(v, list):
        return [_canon(x) for x in v]
    if isinstance(v, str):
        return v.lower()
    return v


def _call_key(tool_name: str, args: dict):
    return (tool_name, json.dumps(_canon(args), sort_keys=True, default=str))


def _messages(state, last_results, steps_left, next_action):
    hint = ""
    if next_action:
        hint = f"Suggested next: call {next_action[0]} with args {json.dumps(next_action[1])} (or a better choice)."
    user = (
        f"Scratchpad: {_summary(state)}\n"
        f"Last tool results: {last_results or '(none yet)'}\n"
        f"{hint}\n"
        f"Steps remaining: {steps_left}. Reply with ONE JSON object: "
        '{"tool": "...", "args": {...}, "why": "..."} or {"final": true}.'
    )
    return [
        {"role": "system", "content": _SYSTEM},
        {"role": "user", "content": user},
    ]


def _retry_messages(messages, errors, decision):
    valid = ", ".join(tools.TOOL_SCHEMAS.keys())
    return messages + [
        {"role": "assistant", "content": str(decision)},
        {"role": "user", "content": f"Invalid: {errors}. Valid tools are: {valid}. Return a corrected JSON object."},
    ]


def _trace_event(state, tool, stage, args, summary, status="ok", why="", source="fallback"):
    ev = _event(state["steps_used"], stage, tool, why, args, summary, status, None, source)
    state.setdefault("trace", []).append(ev["event"])
    return {"type": "event", "event": ev["event"]}


# --- deterministic FINISH -----------------------------------------------------
async def _finish(state: dict, request: dict):
    def tr(tool, stage, args, summary, status="ok", why=""):
        return _trace_event(state, tool, stage, args, summary, status, why)

    artist_entity = tools._find_artist_entity(state)
    if artist_entity:
        state["catalog"]["artist_entity"] = artist_entity

    # IDENTIFY fallback: resolve artist + related in Qloo if the agent didn't.
    if state["artist_name"] and not artist_entity:
        r = qloo.search(state["artist_name"], [tools.TYPE_MAP["artist"]])
        if r.get("candidates"):
            c0 = r["candidates"][0]
            artist_entity = {"name": c0["name"], "id": c0["id"], "type": "artist", "score": c0.get("score")}
            state["entities"].append(artist_entity)
            state["catalog"]["artist_entity"] = artist_entity
            yield tr("qloo_search", "IDENTIFY", {"name": state["artist_name"]}, f"Searched Qloo for '{state['artist_name']}', picked '{c0['name']}'.")
        else:
            yield tr("qloo_search", "IDENTIFY", {"name": state["artist_name"]}, f"No Qloo match for '{state['artist_name']}'.", "error")

    # Resolve related artists in Qloo (for catalog + collaborators).
    if artist_entity:
        rel = qloo.related(
            "urn:entity:artist",
            artist_entity["id"],
            limit=10,
            exclude=[artist_entity["id"]],
            demographics=state["audience"].get("demographics"),
            trending=True,
        )
        if rel["ok"]:
            for e in rel["entities"]:
                e["type"] = "artist"
            state.setdefault("related_entities", []).extend(rel["entities"])
            yield tr("qloo_insights", "IDENTIFY", {"type": "artist"}, f"Related artists: {len(rel['entities'])} result(s).")

    # PROFILE: audience tags + demographics (deterministic).
    if artist_entity and not state["audience"]["tags"]:
        ta = qloo.entity_tags(artist_entity["id"], limit=20)
        if ta["ok"]:
            state["audience"]["tags"] = ta["tags"]
        d = qloo.demographics(artist_entity["id"])
        if d["ok"]:
            state["audience"]["demographics"] = d["demographics"]
        yield tr("qloo_audience", "PROFILE", {}, f"Audience profile: {len(state['audience']['tags'])} tags.")

    # Catalog tags = artist taste tags + related-entity tags.
    catalog_tags = list(state["audience"]["tags"])

    # LISTEN: analyze audio (deterministic) if a song was provided.
    if state["song_id"] and not state.get("audio"):
        res = audio.analyze(state["song_id"])
        if res.get("ok"):
            state["audio"] = res
            yield tr("analyze_audio", "LISTEN", {"song_id": state["song_id"]}, f"Audio analyzed: {res['tempo']} BPM, key {res['key']} {res['mode']}.")
        else:
            state["errors"].append(f"analyze_audio skipped: {res.get('error')}")
            state["audio"] = None
            yield tr("analyze_audio", "LISTEN", {"song_id": state["song_id"]}, f"Audio analysis skipped: {res.get('error')}", "error")

    # COMPARE: describe sound + resolve comparables.
    if state.get("audio") and state["audio"].get("ok") and not state.get("sound"):
        tools._describe_sound({"features": state["audio"]}, state)
        yield tr("describe_sound", "COMPARE", {}, f"Sound described with {len((state.get('sound') or {}).get('descriptors', []))} descriptor(s).")

    # BRIDGE: sound-to-taste (Section D) — audio features -> resolved Qloo tags.
    bridge_tags: list[dict] = []
    bridge_trace: list[dict] = []
    if state.get("audio") and state["audio"].get("ok"):
        br = bridge.sound_to_tags(state["audio"])
        bridge_tags = br.get("tags") or []
        bridge_trace = br.get("bridge_trace") or []
        state["bridge"] = {"tags": bridge_tags, "trace": bridge_trace}
        yield tr("sound_to_tags", "BRIDGE", {"features": True}, f"Sound-to-taste: {len(bridge_tags)} tag(s) resolved.")
    else:
        state["bridge"] = {"tags": [], "trace": []}

    # LYRICS: transcribe + theme tags (best-effort, merged into the bridge tags).
    if config.lyrics_ready() and state.get("song_id"):
        lr = lyrics.analyze_lyrics(state["song_id"])
        state["lyrics"] = lr
        if lr.get("ok"):
            existing = {t.get("id") for t in bridge_tags}
            for t in lr.get("tags", []):
                if t.get("id") not in existing:
                    bridge_tags.append(t)
                    existing.add(t.get("id"))
            state["bridge"]["tags"] = bridge_tags
            yield tr(
                "analyze_lyrics", "LYRICS", {"song_id": state["song_id"]},
                f"Lyrics: {len(lr.get('themes', []))} theme(s), {len(lr.get('tags', []))} tag(s) resolved.",
            )
        else:
            yield tr("analyze_lyrics", "LYRICS", {}, f"Lyrics skipped: {lr.get('reason', 'no transcript')}")

    # Origin (home city) for the globe's arcs — best-effort if the agent skipped it.
    if state["artist_name"] and not state.get("origin"):
        msg = tools._find_home_city({}, state)
        yield tr("find_home_city", "IDENTIFY", {}, msg)

    # TARGET: markets (heatmap, streamed as market_scored) + collaborators.
    state["markets"] = []
    if artist_entity:
        async def _score_one(city: str):
            t0 = time.monotonic()
            hm = await asyncio.to_thread(qloo.heatmap, artist_entity["id"], city)
            latency = int((time.monotonic() - t0) * 1000)
            market = _market_from_heatmap(city, hm)
            return city, market, latency

        scored = await asyncio.gather(
            *[_score_one(city) for city in state["cities"]],
            return_exceptions=True,
        )
        for item in scored:
            if isinstance(item, BaseException):
                continue
            city, market, latency = item
            state["markets"].append(market)
            state.setdefault("trace", []).append(
                {
                    "step": state["steps_used"],
                    "stage": "TARGET",
                    "tool": "score_market",
                    "why": "rank this city",
                    "args_summary": city,
                    "result_summary": f"{city}: {market['score']}" if market["status"] == "scored" else f"{city}: no data",
                    "latency_ms": latency,
                    "status": "ok" if market["status"] == "scored" else "error",
                    "source": "fallback",
                }
            )
            yield {
                "type": "event",
                "event": {
                    "step": state["steps_used"],
                    "stage": "TARGET",
                    "tool": "score_market",
                    "why": "rank this city",
                    "args_summary": city,
                    "result_summary": f"{city}: {market['score']}" if market["status"] == "scored" else f"{city}: no data",
                    "latency_ms": latency,
                    "status": "ok" if market["status"] == "scored" else "error",
                    "source": "fallback",
                    "market_scored": {"city": city, "score": market["score"]},
                },
            }
        state["markets"].sort(key=lambda m: (m["score"] is None, -(m["score"] or 0)))
        _attach_venues(state, artist_entity)
    else:
        state["markets"] = [
            {
                "city": c,
                "score": None,
                "reason": "Artist not resolved in Qloo, so no geographic affinity.",
                "status": "no_data",
                "venues": [],
            }
            for c in state["cities"]
        ]
    state["collaborators"] = _collaborators(state, artist_entity)
    if state["collaborators"]:
        names = ", ".join(c["name"] for c in state["collaborators"][:5])
        yield tr("qloo_insights", "TARGET", {"type": "artist"}, f"Collaborators: {names}.")

    # CLIP: cut clips + captions.
    if state.get("audio") and state["audio"].get("ok"):
        hooks = state["audio"].get("hooks") or []
        if hooks and not state["clips"]:
            state["clips"] = (audio.cut_clips(state["song_id"], hooks).get("clips") or [])
            if state["clips"]:
                yield tr("cut_clips", "CLIP", {"song_id": state["song_id"]}, f"Cut {len(state['clips'])} hook clip(s).")
        if state["clips"]:
            tools._write_captions({"clips": state["clips"], "audience_profile": state["audience"]}, state)
            yield tr("write_captions", "CLIP", {}, f"Wrote {len(state['clips'])} caption(s).")

    # SCORE: fit score (pure code) + blurb (LLM, from evidence only).
    comparable_tags = _song_tags(state)
    catalog_names = [t.get("name", "") for t in catalog_tags]
    audience_names = _audience_tags(state, artist_entity, catalog_names)
    _comparable_scores(state, artist_entity)  # artist-comparables call (uses bridge tags)
    score = scoring.score_fit(
        {
            "comparable_tags": comparable_tags,
            "catalog_tags": catalog_names,
            "audience_tags": audience_names,
            "related_affinity": [e.get("score") for e in state.get("related_entities", []) if e.get("score") is not None],
            "hooks": (state["audio"] or {}).get("hooks") or [],
        }
    )
    blurb = _blurb(state, score)

    state.setdefault("trace", []).append(
        {
            "step": state["steps_used"],
            "stage": "SCORE",
            "tool": "score_fit",
            "why": "deterministic completion",
            "args_summary": "fit scoring",
            "result_summary": f"fit={score.get('fit')}",
            "latency_ms": None,
            "status": "ok",
            "source": "fallback",
        }
    )

    yield {"type": "final", "result": _assemble(state, request, score, blurb)}


def _market_from_heatmap(city, hm) -> dict:
    if hm["ok"] and hm["aggregate"]:
        agg = hm["aggregate"]
        score = round(agg["mean_affinity_rank"] * 100, 1)
        reason = (
            f"Artist overperforms geographically across {agg['points']} grid points "
            f"(mean affinity_rank {agg['mean_affinity_rank']:.2f})."
        )
        return {"city": city, "score": score, "reason": reason, "status": "scored", "venues": []}
    reason = f"No geographic affinity data for {city}." + (f" ({hm['error']})" if hm.get("error") else "")
    return {"city": city, "score": None, "reason": reason, "status": "no_data", "venues": []}


def _attach_venues(state, artist_entity) -> None:
    """Best-effort venue lookup for the top scored markets (keeps call count low)."""
    tag_ids = bridge.tag_ids((state.get("bridge") or {}).get("tags", []))
    for market in state["markets"][:5]:
        if market["status"] != "scored":
            continue
        v = qloo.venues(artist_entity["id"], market["city"], limit=6, tags=tag_ids)
        if v["ok"]:
            market["venues"] = v["places"]
    if tag_ids:
        _mark_used(state, "venues")


def _mark_used(state, label: str) -> None:
    for entry in (state.get("bridge") or {}).get("trace", []):
        if entry.get("qloo_tag_id") and label not in entry.setdefault("used_in", []):
            entry["used_in"].append(label)


def _song_tags(state) -> list[str]:
    # Tags of the song's resolved comparables (proxied through their Qloo taste tags).
    tags = []
    for c in (state.get("sound") or {}).get("comparables", []):
        if c.get("id"):
            ta = qloo.entity_tags(c["id"], limit=10)
            if ta["ok"]:
                tags.extend(t.get("name", "") for t in ta["tags"])
    return tags


def _audience_tags(state, artist_entity, base: list[str]) -> list[str]:
    tags = list(base)
    for e in state.get("related_entities", [])[:5]:
        if e.get("id"):
            ta = qloo.entity_tags(e["id"], limit=10)
            if ta["ok"]:
                tags.extend(t.get("name", "") for t in ta["tags"])
    return tags


def _comparable_scores(state, artist_entity) -> list[float]:
    comparables = (state.get("sound") or {}).get("comparables", [])
    if not comparables or not artist_entity:
        return []
    ids = [c["id"] for c in comparables if c.get("id")]
    if not ids:
        return []
    tag_ids = bridge.tag_ids((state.get("bridge") or {}).get("tags", []))
    aff = qloo.affinity_between(artist_entity["id"], ids, tags=tag_ids)
    if tag_ids:
        _mark_used(state, "comparables")
    return [aff["scores"].get(c["id"]) for c in comparables if c.get("id")]


def _collaborators(state, artist_entity):
    collabs = []
    related = state.get("related_entities", [])
    artist_id = artist_entity.get("id") if artist_entity else None
    for e in related:
        if artist_id and e.get("id") == artist_id:
            continue
        if e.get("type") != "artist":
            continue
        score = e.get("score")
        why = f"Related artist" + (f" with Qloo affinity {round(score * 100)}." if score is not None else ".")
        collabs.append({"name": e.get("name"), "id": e.get("id"), "why": why})
    return collabs[:8]


def _blurb(state, score) -> str:
    artist = state.get("artist_name") or "The artist"
    descriptors = (state.get("sound") or {}).get("descriptors", [])
    tags = [t.get("name", "") for t in state["audience"]["tags"][:5]]
    popularity = state.get("catalog", {}).get("popularity")
    genres = state.get("catalog", {}).get("genres", [])[:3]
    prompt = (
        f"Write a 2-3 sentence release blurb for a new song by {artist}, framed for their audience. "
        f"Sound descriptors: {descriptors or '(none)'}. Audience taste tags: {tags or '(none)'}. "
        f"Predicted fit: {score['fit'] if score.get('fit') is not None else 'n/a'}/100. "
        + (f"Spotify popularity: {popularity}/100. " if popularity is not None else "")
        + (f"Genres: {', '.join(genres)}. " if genres else "")
        + "Use only this evidence; do not invent facts. Reply JSON: {\"blurb\": \"...\"}"
    )
    out = llm.chat_json(
        [{"role": "user", "content": prompt}],
        fallback={"blurb": f"A new track from {artist}, built for the audience that already lives in their world."},
    )
    return (out.get("blurb") or "").strip()


def _assemble(state, request, score, blurb):
    clips = [
        {
            "id": c.get("id"),
            "start": c.get("start"),
            "end": c.get("end"),
            "caption": c.get("caption", ""),
            "audio_url": c.get("url"),
            "peaks": c.get("peaks", []),
        }
        for c in state["clips"]
        if c.get("url")
    ]
    return {
        "artist": state.get("artist_name") or request.get("artist"),
        "song": state.get("song_id"),
        "data_mode": config.QLOO_MODE,
        "origin": state.get("origin"),
        "qloo_calls": qloo.drain_requests(),
        "api_calls": http_log.drain(),
        "fit_score": score.get("fit"),
        "breakdown": score.get("breakdown"),
        "clip_strength": score.get("clip_strength"),
        "explanation": score.get("explanation"),
        "warnings": score.get("warnings"),
        "bridge": {
            "tags": (state.get("bridge") or {}).get("tags", []),
            "trace": (state.get("bridge") or {}).get("trace", []),
        },
        "lyrics": {
            "themes": (state.get("lyrics") or {}).get("themes", []),
            "mood": (state.get("lyrics") or {}).get("mood"),
            "language": (state.get("lyrics") or {}).get("language"),
            "tags": (state.get("lyrics") or {}).get("tags", []),
            "transcript": (state.get("lyrics") or {}).get("transcript", ""),
            "segments": (state.get("lyrics") or {}).get("segments", []),
        },
        "audience_profile": {
            "tags": [{"name": t.get("name"), "id": t.get("id")} for t in state["audience"]["tags"]],
            "entities": [{"name": e.get("name"), "id": e.get("id")} for e in state.get("related_entities", [])],
            "demographics": state["audience"].get("demographics"),
        },
        "catalog": {
            "albums": state.get("catalog", {}).get("albums", []),
            "genres": state.get("catalog", {}).get("genres", []),
            "image": state.get("catalog", {}).get("image"),
            "popularity": state.get("catalog", {}).get("popularity"),
            "top_songs": state.get("catalog", {}).get("top_songs", []),
            "spotify_top_songs": state.get("catalog", {}).get("spotify_top_songs", []),
            "spotify_related": state.get("catalog", {}).get("spotify_related", []),
        },
        "markets": state["markets"],
        "collaborators": [{"name": c["name"], "why": c["why"]} for c in state["collaborators"]],
        "clips": clips,
        "blurb": blurb,
        "descriptors": (state.get("sound") or {}).get("descriptors", []),
        "tempo_band": (state.get("sound") or {}).get("tempo_band"),
        "energy_band": (state.get("sound") or {}).get("energy_band"),
        "audio_features": {
            "tempo": (state["audio"] or {}).get("tempo"),
            "key": (state["audio"] or {}).get("key"),
            "mode": (state["audio"] or {}).get("mode"),
            "key_confidence": (state["audio"] or {}).get("key_confidence"),
            "loudness_lufs": (state["audio"] or {}).get("loudness_lufs"),
            "sections": (state["audio"] or {}).get("sections", []),
        },
        "trace": [e for e in state.get("trace", [])],
    }
