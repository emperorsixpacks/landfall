#!/usr/bin/env python3
"""Lyric-theme → Qloo tag coverage test.

Tests whether common lyric themes and moods actually resolve to real Qloo tag
IDs via GET /v2/tags (the same path the sound-to-taste bridge uses). This tells
us whether a lyrics-derived tag pipeline would produce real Qloo signal before we
spend time building Whisper + theme extraction.

- viable  = fuzzy ratio >= 85
- partial = 70 to 84 (could be useful after rephrasing)
- dead    = < 70 or no results

Usage:
    QLOO_MODE=live python3 scripts/theme_coverage_test.py
    QLOO_MODE=mock python3 scripts/theme_coverage_test.py
"""
from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import rapidfuzz  # noqa: E402

from app import config, qloo_client as qloo  # noqa: E402

THEMES: dict[str, list[str]] = {
    "emotions": ["heartbreak", "love", "euphoria", "melancholy", "joy", "pain", "longing", "passion", "nostalgia", "anger"],
    "lifestyle": ["hustle", "nightlife", "celebration", "party", "wealth", "street life", "faith", "prayer", "freedom", "ambition"],
    "cultural": ["afrobeats", "dancehall", "trap", "gospel", "reggae", "lagos", "diaspora", "africa", "caribbean", "urban"],
    "moods": ["euphoric", "upbeat", "romantic", "reflective", "aggressive", "melancholic", "dreamy", "gritty"],
}


def main():
    if config.QLOO_MODE == "mock":
        print("QLOO_MODE=mock — results below are synthetic sample data, not real Qloo data.\n")

    viable = 0
    partial = 0
    dead = 0

    for group, terms in THEMES.items():
        print(f"\n=== {group} ===")
        for term in terms:
            res = qloo.search_tags(term, limit=5)
            cands = res.get("candidates") or []
            best = None
            best_ratio = 0
            for c in cands:
                r = rapidfuzz.fuzz.ratio(term.lower(), (c.get("name") or "").lower())
                if r > best_ratio:
                    best = c
                    best_ratio = r

            if best_ratio >= 85:
                viable += 1
                print(f"  OK   {term:<14} -> {best['name']} ({best_ratio}%) [{best['id']}]")
            elif best_ratio >= 70:
                partial += 1
                print(f"  ~    {term:<14} -> {best['name'] if best else '?'} ({best_ratio}%)")
            else:
                dead += 1
                print(f"  --   {term:<14} (no match, best {best_ratio}%)")

    total = viable + partial + dead
    print("\n" + "=" * 60)
    print(f"summary: {viable} viable, {partial} partial, {dead} dead ({total} total)")
    if total:
        print(f"viable rate: {viable / total * 100:.0f}%")


if __name__ == "__main__":
    main()
