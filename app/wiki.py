"""Lightweight Wikipedia country context (no key) — enriches market reasons.

Returns a concise human one-liner (region + population), never the full
encyclopedic intro. Never fed into scoring; Qloo stays the source of truth.
"""
from __future__ import annotations

import re

import httpx

SUMMARY_URL = "https://en.wikipedia.org/api/rest_v1/page/summary/{title}"

_POP_RE = re.compile(
    r"population of (?:more than |over |about |at least )?([\d,]+(?:\.[\d]+)?)\s*(million|billion)",
    re.IGNORECASE,
)


def fetch_country_info(country: str) -> dict | None:
    if not country:
        return None
    title = country.replace(" ", "_")
    try:
        r = httpx.get(
            SUMMARY_URL.format(title=title),
            timeout=6.0,
            headers={"User-Agent": "landfall/1.0 (demo)"},
        )
        if r.status_code != 200:
            return None
        d = r.json()
        description = (d.get("description") or "").strip()
        extract = (d.get("extract") or "").strip()
        population = None
        m = _POP_RE.search(extract)
        if m:
            population = f"{m.group(1)} {m.group(2)}"
        return {"description": description, "population": population}
    except Exception:  # noqa: BLE001
        return None
