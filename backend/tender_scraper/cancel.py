"""Cooperative scrape cancellation flags (in-process)."""

from __future__ import annotations

import threading

_lock = threading.Lock()
_stop_requested: set[int] = set()


def request_stop(run_id: int) -> None:
    with _lock:
        _stop_requested.add(run_id)


def should_stop(run_id: int) -> bool:
    with _lock:
        return run_id in _stop_requested


def clear_stop(run_id: int) -> None:
    with _lock:
        _stop_requested.discard(run_id)
