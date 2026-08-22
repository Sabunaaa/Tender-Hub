"""In-process schedule for hosts without Windows Task Scheduler.

On Windows the daily scrape is driven by a registered task, which keeps running
even when the dashboard is closed. Cloud hosts have no equivalent, so there the
API process schedules itself: a daemon thread wakes up every minute, compares
the clock against the configured times, and starts a run when one comes due.
"""

from __future__ import annotations

import logging
import threading
from datetime import datetime

from .settings import TBILISI, load_settings, next_scheduled_at

log = logging.getLogger(__name__)

# Coarse enough to be cheap, fine enough that a minute-precision schedule is
# never missed even if a tick is late.
TICK_SECONDS = 30

_thread: threading.Thread | None = None
_stop = threading.Event()


def due_times(now: datetime, previous: datetime | None, settings=None) -> bool:
    """True when a scheduled moment falls in (previous, now]."""
    current = settings or load_settings()
    if not current.schedule_enabled or not current.schedule_days or not current.schedule_times:
        return False
    if previous is None:
        return False
    # next_scheduled_at looks strictly forward, so ask what was next as of the
    # previous tick and check whether that moment has now passed.
    upcoming = next_scheduled_at(current, previous)
    return upcoming is not None and upcoming <= now


def _run_due_scrape() -> None:
    from .pipeline import run_daily
    from .repository import ActiveScrapeError, Repository

    if Repository().get_active_run():
        log.info("Skipping scheduled scrape: another run is active")
        return
    try:
        run_daily()
    except ActiveScrapeError:
        log.info("Skipping scheduled scrape: another run started first")
    except Exception:
        log.exception("Scheduled scrape failed")


def _loop() -> None:
    previous = datetime.now(TBILISI)
    while not _stop.wait(TICK_SECONDS):
        now = datetime.now(TBILISI)
        try:
            if due_times(now, previous):
                log.info("Starting scheduled scrape at %s", now.isoformat(timespec="seconds"))
                _run_due_scrape()
        except Exception:
            log.exception("Scheduler tick failed")
        previous = now


def start() -> bool:
    """Start the scheduler thread. Returns False when one is already running."""
    global _thread
    if _thread is not None and _thread.is_alive():
        return False
    _stop.clear()
    _thread = threading.Thread(target=_loop, name="tender-scheduler", daemon=True)
    _thread.start()
    log.info("In-process scheduler started (tick %ss)", TICK_SECONDS)
    return True


def stop() -> None:
    _stop.set()
