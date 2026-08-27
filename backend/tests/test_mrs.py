from tender_scraper.listing import KIND_MRS, public_app_id, store_app_id, portal_source_url
from tender_scraper.parsers import parse_mrs_listing_page, parse_mrs_main
from tender_scraper.queries import get_stats, list_tenders
from tender_scraper.repository import Repository


def _html(samples, name: str) -> str:
    return (samples / name).read_text(encoding="utf-8")


def test_mrs_ids_do_not_collide_with_tender_ids():
    assert store_app_id(KIND_MRS, 72907) != 72907
    assert public_app_id(KIND_MRS, store_app_id(KIND_MRS, 72907)) == 72907
    assert portal_source_url(KIND_MRS, 72907).endswith("?qep=72907&lang=en")
    assert "go=" in portal_source_url("tender", 701304)


def test_parse_mrs_listing(samples):
    page = parse_mrs_listing_page(_html(samples, "qep_listing.html"))
    assert page.total_records == 2329
    assert page.page == 1
    assert page.total_pages == 466
    assert len(page.rows) >= 4
    row = page.rows[0]
    assert row.app_id == 72907
    assert row.announcement_number == "MRS260050560"
    assert row.status == "Announced"
    assert row.procurement_type == "Electronic procurement"
    assert row.category_code == "30200000"
    assert row.announcement_date == "2026-08-27"
    assert row.bid_deadline == "2026-09-02T16:00:00"


def test_parse_mrs_main(samples):
    tender = parse_mrs_main(_html(samples, "qep_main.html"), 72907)
    assert tender.kind == "mrs"
    assert tender.announcement_number == "MRS260050560"
    assert tender.status == "Announced"
    assert tender.buyer.startswith("სახელმწიფო")
    assert tender.buyer_org_id == 25359
    assert "პლასტიკური" in (tender.title or "")
    assert any(c["code"] == "30216100" for c in tender.cpv_codes)
    assert tender.attachments
    assert any("ტექნიკური" in (a["name"] or "") for a in tender.attachments)
    assert tender.source_url == "https://tenders.procurement.gov.ge/public/?qep=72907&lang=en"
    assert tender.additional_info == "2026"
    assert tender.estimated_value is None


def test_tracked_lists_are_independent(tmp_repo: Repository):
    tenders = tmp_repo.list_tracked(kind="tender")
    mrs = tmp_repo.list_tracked(kind="mrs")
    assert {c["code"] for c in tenders} >= {"30200000", "32400000", "32500000"}
    assert {c["code"] for c in mrs} >= {"30200000", "32400000", "32500000"}
    tmp_repo.remove_tracked(18924, kind="mrs")
    assert 18924 not in {c["id"] for c in tmp_repo.list_tracked(kind="mrs")}
    assert 18924 in {c["id"] for c in tmp_repo.list_tracked(kind="tender")}


def test_list_tenders_separates_mrs(tmp_repo: Repository):
    from tender_scraper.parsers import ParsedTender

    tender = ParsedTender(app_id=1, key="k", kind="tender")
    tender.announcement_number = "NAT1"
    tender.category_code = "30200000"
    tender.category_name = "Computers"
    tender.status = "Tender announced"
    tmp_repo.upsert_tender(tender, category_code="30200000", category_name="Computers", listing_kind="tender")

    mrs = ParsedTender(app_id=1, key="", kind="mrs")
    mrs.announcement_number = "MRS1"
    mrs.category_code = "30200000"
    mrs.category_name = "Computers"
    mrs.status = "Announced"
    tmp_repo.upsert_tender(mrs, category_code="30200000", category_name="Computers", listing_kind="mrs")

    listed_tenders = list_tenders({"kind": "tender"}, tmp_repo.db_path)
    listed_mrs = list_tenders({"kind": "mrs"}, tmp_repo.db_path)
    assert listed_tenders["total"] == 1
    assert listed_tenders["items"][0]["announcementNumber"] == "NAT1"
    assert listed_tenders["items"][0]["appId"] == 1
    assert listed_mrs["total"] == 1
    assert listed_mrs["items"][0]["announcementNumber"] == "MRS1"
    assert listed_mrs["items"][0]["appId"] == 1
    assert listed_mrs["items"][0]["kind"] == "mrs"
    assert listed_mrs["items"][0]["sourceUrl"] == "https://tenders.procurement.gov.ge/public/?qep=1&lang=en"


def test_stats_digest_includes_mrs(tmp_repo: Repository):
    stats = get_stats(tmp_repo.db_path)
    assert "mrsNewSince" in stats
    assert "mrsNewToday" in stats
    assert "mrsNewWeek" in stats
