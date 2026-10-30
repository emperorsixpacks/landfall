"""Lightweight Wikipedia country context (no key) — enriches market reasons.

Used only for one-line human context (population / what a country is known for).
Never fed into scoring; Qloo stays the source of truth for affinity.
"""
from __future__ import annotations

import httpx

SUMMARY_URL = "https://en.wikipedia.org/api/rest_v1/page/summary/{title}"


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
        extract = (d.get("extract") or "").strip()
        return {
            "description": (d.get("description") or "").strip(),
            "extract": extract[:500],
        }
    except Exception:  # noqa: BLE001
        return None
