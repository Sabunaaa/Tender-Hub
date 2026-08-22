from tender_scraper.parsers import ListingRow
from tender_scraper.pipeline import _parts_for
from tender_scraper.db import get_connection


def _row(**overrides) -> ListingRow:
    base = dict(
        app_id=1,
        key="k",
        announcement_number="NAT1",
        status="Bid submission",
        procurement_type="Electronic",
        buyer="Buyer",
        category_code="30200000",
        category_name="Computers",
        announcement_date="2026-01-01",
        bid_deadline="2026-02-01",
        estimated_value=100.0,
        currency="GEL",
        bidder_count=0,
        winner=None,
        contract_status=None,
        raw_html="",
    )
    base.update(overrides)
    return ListingRow(**base)


def test_unchanged_listing_is_skipped_without_force():
    row = _row()
    state = {
        "status": row.status,
        "bidDeadline": row.bid_deadline,
        "estimatedValue": row.estimated_value,
        "bidderCount": row.bidder_count,
        "winner": row.winner or "",
        "contractStatus": row.contract_status or "",
        "hasDocs": True,
    }
    assert _parts_for(row, state, force=False) is None


def test_force_refresh_fetches_every_tender():
    row = _row()
    state = {
        "status": row.status,
        "bidDeadline": row.bid_deadline,
        "estimatedValue": row.estimated_value,
        "bidderCount": row.bidder_count,
        "winner": "",
        "contractStatus": "",
        "hasDocs": True,
    }
    parts = _parts_for(row, state, force=True)
    assert parts is not None
    assert "main" in parts
    assert "docs" in parts


def test_earliest_announcement_date(tmp_repo):
    assert tmp_repo.earliest_announcement_date("30200000") is None
    with get_connection(tmp_repo.db_path) as conn:
        conn.execute(
            """
            INSERT INTO tenders (
                app_id, key, announcement_number, title, status, category_code, announcement_date, scraped_at, updated_at
            ) VALUES
            (1, 'a', 'NAT1', 'One', 'Bid submission', '30200000', '2025-03-10', '2026-01-01', '2026-01-01'),
            (2, 'b', 'NAT2', 'Two', 'Bid submission', '30200000', '2025-08-01', '2026-01-01', '2026-01-01'),
            (3, 'c', 'NAT3', 'Three', 'Bid submission', '32400000', '2024-01-01', '2026-01-01', '2026-01-01')
            """
        )
    assert tmp_repo.earliest_announcement_date("30200000") == "2025-03-10"
    assert tmp_repo.earliest_announcement_date("32400000") == "2024-01-01"
