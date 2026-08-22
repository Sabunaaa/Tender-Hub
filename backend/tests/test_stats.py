from __future__ import annotations

from datetime import date, timedelta

from tender_scraper.db import get_connection
from tender_scraper.queries import get_stats


def test_get_stats_aggregates_in_sql(tmp_repo):
    today = date.today()
    soon = (today + timedelta(days=3)).isoformat()
    later = (today + timedelta(days=20)).isoformat()
    db = tmp_repo.db_path
    with get_connection(db) as conn:
        rows = [
            {
                "app_id": 1,
                "status": "Tender announced",
                "buyer": "City Hall",
                "category_code": "30200000",
                "category_name": "Computers",
                "announcement_date": "2026-01-10",
                "bid_deadline": f"{soon}T12:00:00",
                "estimated_value": 100.0,
            },
            {
                "app_id": 2,
                "status": "Tender announced",
                "buyer": "City Hall",
                "category_code": "30200000",
                "category_name": "Computers",
                "announcement_date": today.isoformat(),
                "bid_deadline": f"{later}T12:00:00",
                "estimated_value": 50.0,
            },
            {
                "app_id": 3,
                "status": "Contract awarded",
                "buyer": "Ministry",
                "category_code": "32400000",
                "category_name": "Networks",
                "announcement_date": "2026-02-01",
                "bid_deadline": f"{soon}T09:00:00",
                "estimated_value": 25.0,
            },
            {
                "app_id": 4,
                "status": None,
                "buyer": None,
                "category_code": "30200000",
                "category_name": "Computers",
                "announcement_date": "2026-02-02",
                "bid_deadline": None,
                "estimated_value": None,
            },
        ]
        for row in rows:
            payload = {
                "key": "k",
                "announcement_number": f"NAT{row['app_id']}",
                "title": "t",
                "status": row["status"],
                "procurement_type": "NAT",
                "buyer": row["buyer"],
                "buyer_org_id": 1,
                "category_code": row["category_code"],
                "category_name": row["category_name"],
                "announcement_date": row["announcement_date"],
                "bid_deadline": row["bid_deadline"],
                "bids_accepted_from": None,
                "estimated_value": row["estimated_value"],
                "currency": "GEL",
                "bidder_count": 0,
                "winner": None,
                "contract_status": None,
                "source_url": "",
                "description": "",
                "supply_period": None,
                "vat_terms": None,
                "guarantee_amount": None,
                "guarantee_validity": None,
                "bid_reduction_step": None,
                "amount_or_volume": None,
                "additional_info": None,
                "scraped_at": "2026-01-15T00:00:00+00:00",
            }
            cols = ", ".join(["app_id", *payload])
            conn.execute(
                f"INSERT INTO tenders ({cols}) VALUES ({', '.join('?' * (1 + len(payload)))})",
                [row["app_id"], *payload.values()],
            )
        conn.execute(
            """
            INSERT INTO engagements (
                announcement_number, app_id, engaged, account_manager, solution_manager, domain,
                created_at, updated_at
            ) VALUES ('NAT1', 1, 1, '', '', '', '2026-08-01T00:00:00', '2026-08-01T00:00:00')
            """
        )

    stats = get_stats(db)
    assert stats["totalTenders"] == 4
    assert stats["openTenders"] == 2
    assert stats["closingWithin7Days"] == 1
    assert stats["closingSoonDays"] == 7
    assert stats["newThisWeek"] == 1
    assert stats["openUntracked"] == 1
    assert stats["onEngagement"] == 1
    assert stats["engagedCount"] == 1
    assert stats["currency"] == "GEL"
    assert {item["categoryCode"]: item["count"] for item in stats["byCategory"]} == {
        "30200000": 3,
        "32400000": 1,
    }
    assert {item["categoryCode"]: item["openCount"] for item in stats["byCategory"]} == {
        "30200000": 2,
        "32400000": 0,
    }
    assert {item["status"]: item["count"] for item in stats["byStatus"]} == {
        "Tender announced": 2,
        "Contract awarded": 1,
        "Unknown": 1,
    }
    buyers = {item["buyer"]: item for item in stats["topBuyers"]}
    assert buyers["City Hall"]["count"] == 2
    assert buyers["City Hall"]["openCount"] == 2
    assert buyers["Ministry"]["count"] == 1
    assert buyers["Ministry"]["openCount"] == 0
    assert buyers["Unknown"]["count"] == 1
    assert buyers["Unknown"]["openCount"] == 0
    assert len(stats["closingSoon"]) == 1
    assert stats["closingSoon"][0]["appId"] == 1
    months = {(item["month"], item["categoryCode"]): item["count"] for item in stats["byMonth"]}
    assert months[("2026-01", "30200000")] == 1
    assert months[(today.strftime("%Y-%m"), "30200000")] == 1
    assert months[("2026-02", "32400000")] == 1
    assert months[("2026-02", "30200000")] == 1


def test_get_stats_empty_when_no_tracked(tmp_path):
    from tender_scraper.db import init_db, get_connection

    db = tmp_path / "empty.db"
    init_db(db)
    with get_connection(db) as conn:
        conn.execute("DELETE FROM tracked_categories")
    stats = get_stats(db)
    assert stats["totalTenders"] == 0
    assert stats["byMonth"] == []
    assert stats["closingSoon"] == []
