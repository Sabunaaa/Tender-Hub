from tender_scraper.db import get_connection
from tender_scraper.parsers import ListingRow, ParsedTender
from tender_scraper.pipeline import listing_searches, merge_listing_rows
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
    tmp_repo.add_tracked(19008, "48800000", "Information systems and servers")
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
    tmp_repo.add_tracked(19008, "48800000", "Information systems and servers")
    first = _tender(category_code="30200000", category_name="Computer equipment and supplies")
    tmp_repo.upsert_tender(first, category_code="30200000", category_name="Computer equipment and supplies")
    again = _tender(category_code="48400000", category_name="Business transaction software")
    tmp_repo.upsert_tender(again, category_code="48800000", category_name="Information systems and servers")
    with get_connection(tmp_repo.db_path) as conn:
        stored = conn.execute("SELECT category_code FROM tenders WHERE app_id = 697624").fetchone()
    assert stored["category_code"] == "30200000"


def test_skip_claims_orphans_tagged_with_an_untracked_cpv(tmp_repo):
    tmp_repo.add_tracked(19008, "48800000", "Information systems and servers")
    tmp_repo.upsert_tender(_tender(), category_code="48800000", category_name="Information systems")
    # Simulate the old bug: listing CPV stuck on the row.
    with get_connection(tmp_repo.db_path) as conn:
        conn.execute("UPDATE tenders SET category_code = '48400000' WHERE app_id = 697624")
    assert list_tenders({"categoryCodes": ["48800000"]}, tmp_repo.db_path)["total"] == 0
    assert tmp_repo.claim_for_tracked_category(697624, "48800000", "Information systems and servers") is True
    assert list_tenders({"categoryCodes": ["48800000"]}, tmp_repo.db_path)["total"] == 1


def test_listing_searches_runs_dropdown_and_cpv_code_separately():
    searches = listing_searches({"id": 19008, "code": "48800000"})
    assert searches == [{"cpv_category": 19008}, {"cpv_code": "48800000"}]


def test_search_sends_cpv_code_without_dropdown(monkeypatch):
    from tender_scraper.client import TenderPortalClient

    captured: dict[str, object] = {}

    def fake_request(self, method, url, **kwargs):
        captured.update(kwargs.get("data") or {})
        return "<html></html>"

    monkeypatch.setattr(TenderPortalClient, "start_session", lambda self: None)
    monkeypatch.setattr(TenderPortalClient, "_request", fake_request)
    TenderPortalClient(delay=0).search(cpv_code="48800000")
    assert captured["app_basecode"] == "0"
    assert captured["app_codes"] == "48800000"


def test_merge_listing_rows_keeps_first_app_id():
    def row(app_id: int, code: str) -> ListingRow:
        return ListingRow(
            app_id=app_id,
            key="k",
            announcement_number=f"NAT{app_id}",
            status="Bid submission",
            procurement_type="Electronic",
            buyer="Buyer",
            category_code=code,
            category_name="Name",
            announcement_date="2026-01-01",
            bid_deadline="2026-02-01",
            estimated_value=1.0,
            currency="GEL",
            bidder_count=0,
            winner=None,
            contract_status=None,
            raw_html="",
        )

    merged = merge_listing_rows(
        [row(1, "48400000"), row(2, "48400000")],
        [row(1, "48800000"), row(3, "48800000")],
    )
    assert [r.app_id for r in merged] == [1, 2, 3]
    assert merged[0].category_code == "48400000"


def test_seed_moves_tracked_488_onto_the_live_portal_id(tmp_repo):
    from tender_scraper.cpv_seed import seed_cpv_categories

    tmp_repo.add_tracked(19014, "48800000", "Information systems and servers")
    seed_cpv_categories(tmp_repo)
    tracked = {c["code"]: c for c in tmp_repo.list_tracked()}
    assert tracked["48800000"]["id"] == 19008
    stored = tmp_repo.get_cpv(19008)
    assert stored is not None
    assert stored["code"] == "48800000"
    assert tmp_repo.get_cpv(19014)["code"] == "48400000"
