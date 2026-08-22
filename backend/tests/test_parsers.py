from __future__ import annotations

from tender_scraper.parsers import (
    parse_agency_docs,
    parse_bids_tab,
    parse_docs_tab,
    parse_listing_page,
    parse_main_tab,
    parse_status_history,
)


def _html(samples, name: str) -> str:
    return (samples / name).read_text(encoding="utf-8")


def test_listing_page_pagination_and_first_row(samples):
    page = parse_listing_page(_html(samples, "listing.html"))
    assert (page.total_records, page.page, page.total_pages, len(page.rows)) == (239, 1, 60, 4)
    row = page.rows[0]
    assert row.app_id == 694935
    assert row.key == "7c72994a1b84be6ef3e692d3e8d97fc5"
    assert row.announcement_number == "NAT260017636"
    assert row.status == "Tender announced"
    assert row.buyer == "Tbilisi Chugureti District Gamgeoba"
    assert row.category_code == "45200000"
    assert row.announcement_date == "2026-08-20"
    assert row.bid_deadline == "2026-09-01"
    assert row.estimated_value == 41541.0
    assert row.currency == "GEL"
    assert row.bidder_count == 0


def test_listing_page2_is_page_two(samples):
    page = parse_listing_page(_html(samples, "listing_page2.html"))
    assert (page.total_records, page.page, page.total_pages, len(page.rows)) == (239, 2, 60, 4)
    assert page.rows[0].app_id == 701279
    assert page.rows[0].announcement_number == "NAT260017632"


def test_listing_old_includes_bidder_count(samples):
    page = parse_listing_page(_html(samples, "listing_old.html"))
    assert (page.total_records, page.page, page.total_pages, len(page.rows)) == (1034, 1, 259, 4)
    row = page.rows[0]
    assert row.app_id == 667651
    assert row.status == "Contract not awarded"
    assert row.bidder_count == 1
    assert row.estimated_value == 8410.0


def test_parse_main_tab_701304(samples):
    tender = parse_main_tab(_html(samples, "app_main_701304.html"), 701304, "KEY")
    assert tender.announcement_number == "NAT260017634"
    assert tender.status == "Tender announced"
    assert tender.buyer == "Tbilisi City Hall"
    assert tender.buyer_org_id == 1253
    assert tender.category_code == "98300000"
    assert tender.estimated_value == 255000.0
    assert tender.currency == "GEL"
    assert tender.guarantee_amount == 2550.0
    assert tender.bid_reduction_step == 1020.0
    assert tender.announcement_date == "2026-08-20T21:29:00"
    assert tender.bid_deadline == "2026-09-01T12:30:00"
    assert tender.cpv_codes == [{"code": "98390000", "name": "Other services"}]
    assert "თბილისობა 2026" in (tender.title or "")
    assert tender.donor == ""


def test_parse_main_tab_extracts_world_bank_donor(samples):
    tender = parse_main_tab(_html(samples, "app_main_699822.html"), 699822, "KEY")
    assert tender.announcement_number == "DEP260000036"
    assert tender.donor == "The World Bank"
    assert "DEP" in tender.procurement_type


def test_parse_main_tab_700990(samples):
    tender = parse_main_tab(_html(samples, "app_main_700990.html"), 700990, "KEY")
    assert tender.announcement_number == "NAT260017635"
    assert tender.buyer_org_id == 30101
    assert tender.estimated_value == 213750.0
    assert tender.cpv_codes[0]["code"] == "37520000"


def test_parse_bids_tab_old_samples(samples):
    bids = parse_bids_tab(_html(samples, "old_app_bids_672563.html"))
    assert len(bids) == 4
    assert bids[0]["bidder_org_id"] == 129836
    assert bids[0]["offer_count"] == 1
    assert bids[2]["offer_count"] == 2
    assert "ნერგაძე" in bids[0]["bidder_name"]

    one = parse_bids_tab(_html(samples, "old_app_bids_667651.html"))
    assert len(one) == 1
    assert one[0]["bidder_name"] == "შპს DENIZO"
    assert one[0]["bidder_org_id"] == 34472


def test_parse_bids_tab_open_tenders_have_none(samples):
    assert parse_bids_tab(_html(samples, "app_bids_701304.html")) == []


def test_parse_docs_tab_701304(samples):
    sections, attachments = parse_docs_tab(_html(samples, "app_docs_701304.html"))
    assert len(sections) == 18
    assert len(attachments) == 6
    assert sections[0]["title"].lower().startswith("1.1 name of an object")
    assert "თბილისობა 2026" in sections[0]["body"]
    assert attachments[0]["url"].startswith("https://tenders.procurement.gov.ge/public/library/files.php")


def test_parse_agency_docs_old_sample(samples):
    docs = parse_agency_docs(_html(samples, "old_agency_docs_672563.html"))
    assert len(docs) == 10
    assert "NAT260002476" in docs[0]["name"]
    assert "files.php" in docs[0]["url"]


def test_parse_status_history_oldest_first(samples):
    history = parse_status_history(_html(samples, "old_statushistory_672563.html"))
    assert [h["status"] for h in history] == [
        "Tender announced",
        "Bidding commenced",
        "Additional rounds of trade ended",
        "Selection/Evaluation",
        "Winner identified",
        "Finalization of contract",
        "Contract awarded",
    ]
    assert history[0]["changed_at"] == "2026-02-11T21:51:00"
    assert history[-1]["changed_at"] == "2026-03-16T21:35:00"
