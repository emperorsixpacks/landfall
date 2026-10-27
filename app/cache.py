"""Simple disk cache with TTL. Keys are hashed; values are JSON on disk."""
from __future__ import annotations

import hashlib
import json
import time
from pathlib import Path
from typing import Any, Optional

from . import config


def _key(namespace: str, parts: dict) -> str:
    raw = json.dumps(parts, sort_keys=True, default=str)
    return f"{namespace}_{hashlib.sha256(raw.encode()).hexdigest()[:24]}.json"


def get(namespace: str, parts: dict, ttl: int) -> Optional[Any]:
    path = config.CACHE_DIR / _key(namespace, parts)
    if not path.exists():
        return None
    try:
        data = json.loads(path.read_text())
    except (json.JSONDecodeError, OSError):
        return None
    if time.time() - data.get("ts", 0) > ttl:
        return None
    return data.get("value")


def put(namespace: str, parts: dict, value: Any) -> None:
    path = config.CACHE_DIR / _key(namespace, parts)
    try:
        path.write_text(json.dumps({"ts": time.time(), "value": value}))
    except OSError:
        pass


def load_bundled(rel_path: str) -> Optional[Any]:
    """Load a bundled fallback JSON file (committed to the repo)."""
    p = config.BUNDLED_CACHE_DIR / rel_path
    if not p.exists():
        return None
    try:
        return json.loads(p.read_text())
    except (json.JSONDecodeError, OSError):
        return None
