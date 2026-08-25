from tender_scraper.db import get_connection
from tender_scraper.parsers import ParsedTender
from tender_scraper.queries import list_tenders


def _tender(**overrides) -> ParsedTender:
    t = ParsedTender(app_id=697624, key="k")
    t.announcement_number = "NAT260016732"
    t.title = "Servers"
    t.status = "Bid submission"
    t.category_code = "48400000"
    t.category_name = "Business transaction software"
    t.announcement_date = "2026-01-01"
    t.bid_deadline = "2026-02-01"
    for key, value in overrides.items():
        setattr(t, key, value)
    return t


def test_new_tender_is_stored_under_the_tracked_search_category(tmp_repo):
    tmp_repo.add_tracked(19014, "48800000", "Information systems and servers")
    tmp_repo.upsert_tender(
        _tender(),
        category_code="48800000",
        category_name="Information systems and servers",
    )
    listed = list_tenders({"categoryCodes": ["48800000"]}, tmp_repo.db_path)
    assert listed["total"] == 1
    assert listed["items"][0]["categoryCode"] == "48800000"
    counts = {c["code"]: c["tenderCount"] for c in tmp_repo.list_tracked()}
    assert counts["48800000"] == 1


def test_does_not_steal_a_tender_already_in_another_tracked_category(tmp_repo):
    tmp_repo.add_tracked(19014, "48800000", "Information systems and servers")
    first = _tender(category_code="30200000", category_name="Computer equipment and supplies")
    tmp_repo.upsert_tender(first, category_code="30200000", category_name="Computer equipment and supplies")
    again = _tender(category_code="48400000", category_name="Business transaction software")
    tmp_repo.upsert_tender(again, category_code="48800000", category_name="Information systems and servers")
    with get_connection(tmp_repo.db_path) as conn:
        stored = conn.execute("SELECT category_code FROM tenders WHERE app_id = 697624").fetchone()
    assert stored["category_code"] == "30200000"


def test_skip_claims_orphans_tagged_with_an_untracked_cpv(tmp_repo):
    tmp_repo.add_tracked(19014, "48800000", "Information systems and servers")
    tmp_repo.upsert_tender(_tender(), category_code="48800000", category_name="Information systems")
    # Simulate the old bug: listing CPV stuck on the row.
    with get_connection(tmp_repo.db_path) as conn:
        conn.execute("UPDATE tenders SET category_code = '48400000' WHERE app_id = 697624")
    assert list_tenders({"categoryCodes": ["48800000"]}, tmp_repo.db_path)["total"] == 0
    assert tmp_repo.claim_for_tracked_category(697624, "48800000", "Information systems and servers") is True
    assert list_tenders({"categoryCodes": ["48800000"]}, tmp_repo.db_path)["total"] == 1
