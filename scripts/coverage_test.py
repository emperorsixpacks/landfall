#!/usr/bin/env python3
"""Qloo coverage test.

Runs ~12 queries through the app's own Qloo client (so it exercises the same
validation, caching, rate gate, and mock mode as the app) and prints what
resolves and what does not. In live mode it also runs a "no-effect" check: it
calls /v2/insights with and without a signal and flags identical results (a sign
that Qloo silently ignored the parameter).

Usage:
    QLOO_MODE=mock python3 scripts/coverage_test.py        # synthetic, no key
    QLOO_API_KEY=... QLOO_MODE=live python3 scripts/coverage_test.py
"""
from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app import config, qloo_client as qloo  # noqa: E402

RESULTS: list[tuple[str, str, str]] = []


def log(kind, label, detail=""):
    RESULTS.append((kind, label, detail))
    mark = {"ok": "OK ", "empty": "-- ", "err": "ERR", "skip": ".. "}[kind]
    print(f"[{mark}] {label}")
    if detail:
        for line in detail.split("\n"):
            print(f"        {line}")


def main():
    if config.QLOO_MODE == "mock":
        print("QLOO_MODE=mock — results below are synthetic sample data, not real Qloo data.\n")
    elif not config.QLOO_API_KEY:
        print("QLOO_API_KEY is not set and QLOO_MODE != mock. Export a key or use QLOO_MODE=mock.")
        sys.exit(2)

    print(f"Base URL: {config.QLOO_BASE_URL} | mode: {config.QLOO_MODE}")
    print("=" * 70)

    # 1-4. Afrobeats artists
    resolved = {}
    for a in ["Burna Boy", "Wizkid", "Tems", "Rema"]:
        r = qloo.search(a, ["urn:entity:artist"])
        _report_search(a, "urn:entity:artist", r, resolved)

    # 5-9. Cities (as places) — for context; market scoring uses heatmap below.
    for c in ["Lagos", "Abuja", "London", "Accra", "New York"]:
        r = qloo.search(c, ["urn:entity:place"])
        _report_search(c, "urn:entity:place", r, {})

    anchor_name = next((a for a in ["Burna Boy", "Wizkid", "Tems", "Rema"] if resolved.get(a)), None)
    if not anchor_name:
        log("skip", "deep insights queries", "no artist resolved to anchor on")
    else:
        anchor = resolved[anchor_name]
        print(f"\nAnchoring deep queries on resolved artist: {anchor_name} ({anchor})")

        # 10. entity tags (taste profile source)
        tags = qloo.entity_tags(anchor, limit=20)
        if tags["ok"]:
            log("ok", f"entity_tags({anchor_name})", f"{len(tags['tags'])} tag(s): " + ", ".join(t["name"] for t in tags["tags"][:10]))
        else:
            log("empty", f"entity_tags({anchor_name})", tags.get("error") or "no tags")

        # 11. demographics (best-effort)
        demo = qloo.demographics(anchor)
        if demo["ok"] and demo["demographics"]:
            log("ok", f"demographics({anchor_name})", f"age+gender affinity present")
        else:
            log("empty", f"demographics({anchor_name})", demo.get("error") or "no demographics")

        # 12. related artists
        rel = qloo.related("urn:entity:artist", anchor, limit=10, exclude=[anchor])
        if rel["ok"] and rel["entities"]:
            log("ok", f"related_artists({anchor_name})", f"{len(rel['entities'])} result(s): " + ", ".join(e["name"] for e in rel["entities"][:6]))
        else:
            log("empty", f"related_artists({anchor_name})", rel.get("error") or "no results")

        # 13. heatmap: artist affinity within Lagos (the city-level signal we rely on)
        hm = qloo.heatmap(anchor, "Lagos")
        if hm["ok"] and hm["aggregate"]:
            log("ok", f"heatmap({anchor_name}, Lagos)", f"mean affinity_rank={hm['aggregate']['mean_affinity_rank']} over {hm['aggregate']['points']} points")
        else:
            log("empty", f"heatmap({anchor_name}, Lagos)", hm.get("error") or "no heatmap data")

    # 14+. no-effect check (live only)
    if config.QLOO_MODE == "live" and anchor_name:
        _no_effect(anchor, anchor_name)
    else:
        log("skip", "no-effect check", "only runs in live mode")

    print("=" * 70)
    ok = sum(1 for r in RESULTS if r[0] == "ok")
    empty = sum(1 for r in RESULTS if r[0] == "empty")
    err = sum(1 for r in RESULTS if r[0] == "err")
    skip = sum(1 for r in RESULTS if r[0] == "skip")
    print(f"summary: {ok} ok, {empty} empty, {err} error, {skip} skipped")


def _report_search(name, types, r, resolved):
    cands = r.get("candidates") or []
    if not cands:
        log("empty", f"search '{name}' ({types})", r.get("error") or "no results")
        return
    top = cands[0]
    resolved[name] = top["id"]
    names = ", ".join(f"{c['name']} [{c.get('subtype', '?')}]" for c in cands[:3])
    log("ok", f"search '{name}' ({types})", f"{len(cands)} match(es): {names}")


def _no_effect(anchor, name):
    with_sig = qloo.insights("urn:entity:artist", **{"signal.interests.entities": anchor, "take": 10})
    without_sig = qloo.insights("urn:entity:artist", **{"take": 10})
    a = {e.get("entity_id") for e in with_sig["results"].get("entities", [])}
    b = {e.get("entity_id") for e in without_sig["results"].get("entities", [])}
    if a == b:
        log("err", f"no-effect: signal.interests.entities on artist({name})", "identical results with/without signal — parameter may be ignored")
    else:
        log("ok", f"no-effect: signal.interests.entities on artist({name})", f"{len(a)} vs {len(b)} result ids — signal has an effect")


if __name__ == "__main__":
    main()
