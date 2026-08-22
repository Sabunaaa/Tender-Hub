from __future__ import annotations

from datetime import datetime, timedelta, timezone

from tender_scraper.db import get_connection
from tender_scraper.repository import ActiveScrapeError


def test_start_run_rejects_second_active(tmp_repo):
    first = tmp_repo.start_run("daily", ["30200000"], date_from="2026-01-01", date_to="2026-01-02")
    assert first > 0
    try:
        tmp_repo.start_run("daily", ["30200000"])
        raise AssertionError("expected ActiveScrapeError")
    except ActiveScrapeError as exc:
        assert str(first) in str(exc)


def test_fail_stale_running_runs_leaves_recent_alone(tmp_repo):
    run_id = tmp_repo.start_run("daily", ["30200000"])
    failed = tmp_repo.fail_stale_running_runs(older_than_hours=12)
    assert failed == []
    assert tmp_repo.get_run_status(run_id) == "running"


def test_fail_stale_running_runs_marks_old_failed(tmp_repo):
    run_id = tmp_repo.start_run("backfill", ["30200000"], date_from="2026-01-01", date_to="2026-01-02")
    old = (datetime.now(timezone.utc) - timedelta(hours=13)).replace(microsecond=0).isoformat()
    with get_connection(tmp_repo.db_path) as conn:
        conn.execute("UPDATE scrape_runs SET started_at=? WHERE id=?", (old, run_id))
    failed = tmp_repo.fail_stale_running_runs(older_than_hours=12)
    assert failed == [run_id]
    run = tmp_repo.get_run(run_id)
    assert run["status"] == "failed"
    assert run["canResume"] is True
    assert any("12 hours" in err for err in run["errors"])
    # A new scrape can start after the leftover is reaped.
    nxt = tmp_repo.start_run("daily", ["30200000"])
    assert nxt != run_id
