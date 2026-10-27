"""Our own city list (not Qloo data). Candidate markets are chosen from here;
we never geocode through Qloo."""
from __future__ import annotations

import json
from functools import lru_cache

from . import config

CITIES_FILE = config.ROOT / "data" / "cities.json"

DEFAULT_MARKETS = [
    "Lagos", "London", "Accra", "New York",
    "Abuja", "Los Angeles", "Paris", "Johannesburg",
]


@lru_cache(maxsize=1)
def load_cities() -> list[dict]:
    try:
        return json.loads(CITIES_FILE.read_text())
    except (OSError, json.JSONDecodeError):
        return []


@lru_cache(maxsize=1)
def city_names() -> frozenset:
    return frozenset(c["city"] for c in load_cities())


def latlng(city: str) -> tuple[float, float] | None:
    for c in load_cities():
        if c["city"].lower() == city.lower():
            return c["lat"], c["lng"]
    return None


def normalize_selection(cities: list[str]) -> list[str]:
    """Filter user-selected cities to known ones, preserving order."""
    known = city_names()
    seen = set()
    out = []
    for c in cities:
        if c in known and c not in seen:
            out.append(c)
            seen.add(c)
    return out or list(DEFAULT_MARKETS)


def default_markets() -> list[str]:
    return normalize_selection(DEFAULT_MARKETS)


def city_entry(name: str) -> dict | None:
    if not name:
        return None
    for c in load_cities():
        if c["city"].lower() == name.lower():
            return c
    return None
