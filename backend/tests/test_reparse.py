from __future__ import annotations

from tender_scraper.reparse import reparse_from_raw


def test_prune_raw_html_dry_run_does_not_delete(tmp_repo):
    from tender_scraper.db import get_connection

    tmp_repo.save_raw_html(1, "app_main", "<html>old</html>")
    with get_connection(tmp_repo.db_path) as conn:
        conn.execute("UPDATE raw_html SET fetched_at = datetime('now', '-40 days')")
    result = tmp_repo.prune_raw_html(older_than_days=30, apply=False)
    assert result["matching"] == 1
    assert result["deleted"] == 0
    assert tmp_repo.latest_raw_html_by_app()[1]["app_main"] == "<html>old</html>"
    applied = tmp_repo.prune_raw_html(older_than_days=30, apply=True)
    assert applied["deleted"] == 1
    assert tmp_repo.latest_raw_html_by_app() == {}



def test_reparse_dry_run_does_not_write(tmp_repo, samples):
    html = (samples / "app_main_701304.html").read_text(encoding="utf-8")
    tmp_repo.save_raw_html(701304, "app_main", html)
    result = reparse_from_raw(tmp_repo, apply=False)
    assert result["apply"] is False
    assert result["updated"] == 1
    assert tmp_repo.get_tender_key(701304) is None


def test_reparse_apply_upserts_tender(tmp_repo, samples):
    html = (samples / "app_main_701304.html").read_text(encoding="utf-8")
    tmp_repo.save_raw_html(701304, "app_main", html)
    result = reparse_from_raw(tmp_repo, apply=True)
    assert result["updated"] == 1
    from tender_scraper.queries import get_tender

    tender = get_tender(701304, tmp_repo.db_path)
    assert tender is not None
    assert tender["announcementNumber"] == "NAT260017634"
    assert tender["buyer"] == "Tbilisi City Hall"
