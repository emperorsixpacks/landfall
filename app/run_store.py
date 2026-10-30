"""In-memory store of finished runs, keyed by run_id.

The chat agent reads a run's raw state and assembled result as its scratchpad.
Runs live in process memory only (matching "history kept per run in memory");
nothing is logged or persisted. Bounded so a long-lived demo cannot grow without
limit.
"""
from __future__ import annotations

import time

MAX_RUNS = 200

_results: dict[str, dict] = {}
_states: dict[str, dict] = {}
_created: dict[str, float] = {}
_extra_market_used: dict[str, int] = {}  # run_id -> live score_extra_market count


def put(run_id: str, result: dict, state: dict | None = None) -> None:
    _results[run_id] = result
    _states[run_id] = state or {}
    _created[run_id] = time.monotonic()
    if len(_results) > MAX_RUNS:
        oldest = min(_created, key=lambda k: _created[k])
        for store in (_results, _states, _created, _extra_market_used):
            store.pop(oldest, None)


def get_result(run_id: str) -> dict | None:
    return _results.get(run_id)


def get_state(run_id: str) -> dict | None:
    return _states.get(run_id)


def extra_market_used(run_id: str) -> int:
    return _extra_market_used.get(run_id, 0)


def bump_extra_market(run_id: str) -> None:
    _extra_market_used[run_id] = extra_market_used(run_id) + 1


def jsonable(v):
    """Return a JSON-serializable copy (sets become sorted lists)."""
    if isinstance(v, set):
        return sorted(list(v))
    if isinstance(v, dict):
        return {k: jsonable(x) for k, x in v.items()}
    if isinstance(v, (list, tuple)):
        return [jsonable(x) for x in v]
    return v
