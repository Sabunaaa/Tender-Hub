from tender_scraper.db import get_connection
from tender_scraper.engagements import (
    EngagementError,
    add_engagement,
    list_engagements,
    update_engagement,
)


def _insert_tender(conn, app_id: int, number: str, buyer: str = "City Hall", donor: str = "", procurement_type: str = "NAT"):
    conn.execute(
        """
        INSERT INTO tenders (
            app_id, key, announcement_number, title, status, procurement_type, donor,
            buyer, category_code, category_name, announcement_date, estimated_value,
            currency, bidder_count, scraped_at
        ) VALUES (?, 'k', ?, 'ქსელური მოწყობილობები', 'Tender announced', ?, ?, ?,
                  '32400000', 'Networks', '2026-08-01', 50000, 'GEL', 2, '2026-08-01T00:00:00+00:00')
        """,
        (app_id, number, procurement_type, donor, buyer),
    )


def test_add_engagement_fetches_tender_details(tmp_repo):
    db = tmp_repo.db_path
    with get_connection(db) as conn:
        _insert_tender(conn, 99, "NAT260016399", "Maritime Agency")
    row = add_engagement("nat260016399", db)
    assert row["announcementNumber"] == "NAT260016399"
    assert row["buyer"] == "Maritime Agency"
    assert row["appId"] == 99
    assert row["engaged"] is False
    assert row["procurementType"] == "NAT"
    assert row["donor"] == ""
    assert row["product"] == ""
    listed = list_engagements(db)
    assert len(listed) == 1


def test_add_engagement_unknown_code(tmp_repo):
    try:
        add_engagement("NOPE123", tmp_repo.db_path)
        raise AssertionError("expected error")
    except EngagementError as exc:
        assert "No scraped tender" in str(exc)


def test_update_engaged_and_managers(tmp_repo):
    db = tmp_repo.db_path
    with get_connection(db) as conn:
        _insert_tender(conn, 7, "NAT7")
    row = add_engagement("NAT7", db)
    updated = update_engagement(
        row["id"],
        {"engaged": True, "accountManager": "Nino", "solutionManager": "Giorgi"},
        db,
    )
    assert updated["engaged"] is True
    assert updated["accountManager"] == "Nino"
    assert updated["solutionManager"] == "Giorgi"
    assert updated["product"] == ""

    with_product = update_engagement(row["id"], {"product": "storage"}, db)
    assert with_product["product"] == "Storage"

    try:
        update_engagement(row["id"], {"product": "PCs"}, db)
        raise AssertionError("expected error")
    except EngagementError as exc:
        assert "Unknown product" in str(exc)


def test_duplicate_engagement_rejected(tmp_repo):
    db = tmp_repo.db_path
    with get_connection(db) as conn:
        _insert_tender(conn, 8, "NAT8")
    add_engagement("NAT8", db)
    try:
        add_engagement("NAT8", db)
        raise AssertionError("expected error")
    except EngagementError as exc:
        assert "already" in str(exc).lower()


def test_engagement_includes_scraped_donor(tmp_repo):
    db = tmp_repo.db_path
    with get_connection(db) as conn:
        _insert_tender(
            conn,
            11,
            "DEP260000036",
            donor="The World Bank",
            procurement_type="Donor electronic procurement procedure(DEP)",
        )
    row = add_engagement("DEP260000036", db)
    assert row["donor"] == "The World Bank"
    assert "DEP" in row["procurementType"]


def test_settings_people_lists_are_cleaned():
    from tender_scraper.settings import AppSettings

    settings = AppSettings(
        accountManagers=["  Ana  ", "ana", "Luka", ""],
        solutionManagers=["  Nika  ", "Nika"],
    )
    assert settings.account_managers == ["Ana", "Luka"]
    assert settings.solution_managers == ["Nika"]
