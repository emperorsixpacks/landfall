"""Unified HTTP request log so every external API call (Spotify, YouTube Music,
Qloo) is visible with source + latency. Drained into the run result for the UI."""
from __future__ import annotations

import threading

_log: list[dict] = []
_lock = threading.Lock()


def record(source: str, path: str, latency_ms: int, ok: bool = True) -> None:
    with _lock:
        _log.append(
            {
                "source": source,
                "path": path,
                "latency_ms": int(latency_ms),
                "ok": bool(ok),
            }
        )
        if len(_log) > 500:
            del _log[:200]
    # Terminal log (uvicorn console) — the primary way to watch API traffic.
    print(
        f"[api] {source:<8} {int(latency_ms):>6}ms {'OK  ' if ok else 'FAIL'} {path}",
        flush=True,
    )


def drain() -> list[dict]:
    with _lock:
        out = list(_log)
        _log.clear()
        return out
