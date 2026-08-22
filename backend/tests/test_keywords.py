from __future__ import annotations

from tender_scraper.db import get_connection
from tender_scraper.keywords import expand_terms
from tender_scraper.queries import get_tender, list_tenders


def _insert(conn, app_id: int, title: str, description: str = "", extra: str | None = None):
    conn.execute(
        """
        INSERT INTO tenders (
            app_id, key, announcement_number, title, status, procurement_type,
            buyer, category_code, category_name, announcement_date, estimated_value,
            currency, bidder_count, description, additional_info, scraped_at
        ) VALUES (?, 'k', ?, ?, 'Tender announced', 'NAT', 'City Hall',
                  '30200000', 'Computers', '2026-01-10', 100, 'GEL', 0, ?, ?, ?)
        """,
        (app_id, f"NAT{app_id}", title, description, extra, "2026-01-10T00:00:00+00:00"),
    )


def test_expand_storage_skips_pc_disk_terms():
    terms = {t.lower() for t in expand_terms(["storage"])}
    assert "ssd" not in terms
    assert "hdd" not in terms
    assert not any("მეხსიერებ" in t for t in terms)
    assert not any("მყარი დისკ" in t for t in terms)
    assert any("სტორიჯ" in t for t in terms)
    assert any("დისკური მასივ" in t for t in terms)
    assert "nas" not in terms


def test_expand_switch_is_georgian():
    terms = expand_terms(["switch"])
    assert "switch" not in {t.lower() for t in terms}
    assert any("კომუტატორ" in t for t in terms)
    assert any("სვიჩ" in t for t in terms)


def test_english_switch_does_not_match_english_title(tmp_repo):
    db = tmp_repo.db_path
    with get_connection(db) as conn:
        _insert(conn, 1, "Purchase of Cisco Catalyst switch")
    found = list_tenders({"keywords": ["switch"]}, db)
    assert found["total"] == 0


def test_keywords_match_georgian_title_or_docs(tmp_repo):
    db = tmp_repo.db_path
    with get_connection(db) as conn:
        _insert(conn, 1, "Cisco კომუტატორების შესყიდვა")
        _insert(conn, 2, "საოფისე ავეჯი")
        _insert(conn, 3, "ქსელის განახლება")
        conn.execute(
            """
            INSERT INTO tender_document_sections (app_id, section_id, title, body, language)
            VALUES (3, '1', 'spec', 'MikroTik მარშრუტიზატორი 10 ცალი', 'ka')
            """
        )

    switches = list_tenders({"keywords": ["switch"]}, db)
    assert {item["appId"] for item in switches["items"]} == {1}

    either = list_tenders({"keywords": ["switch", "router"]}, db)
    assert {item["appId"] for item in either["items"]} == {1, 3}

    storage = list_tenders({"keywords": ["storage"]}, db)
    assert storage["total"] == 0


def test_custom_keyword_is_substring(tmp_repo):
    db = tmp_repo.db_path
    with get_connection(db) as conn:
        _insert(conn, 10, "Fortinet FortiGate appliance")
        _insert(conn, 11, "ქაღალდი და ტონერი")
    found = list_tenders({"keywords": ["fortigate"]}, db)
    assert {item["appId"] for item in found["items"]} == {10}


def test_keywords_match_spec_text(tmp_repo):
    db = tmp_repo.db_path
    with get_connection(db) as conn:
        _insert(conn, 20, "ქსელის განახლება")
        conn.execute(
            "UPDATE tenders SET spec_text = ? WHERE app_id = 20",
            ("ტექნიკური დავალება: Cisco კომუტატორი 24 პორტი",),
        )
        _insert(conn, 21, "ქსელის განახლება")
        conn.execute("UPDATE tenders SET spec_text = ? WHERE app_id = 21", ("კაბელი და პაჩკორდი",))

    found = list_tenders({"keywords": ["switch"]}, db)
    assert {item["appId"] for item in found["items"]} == {20}


def test_storage_ignores_pc_ram_and_usb_disks(tmp_repo):
    db = tmp_repo.db_path
    with get_connection(db) as conn:
        _insert(conn, 30, "ლეპტოპები")
        conn.execute(
            "UPDATE tenders SET spec_text = ? WHERE app_id = 30",
            ("ოპერატიული მეხსიერება 32 GB, SSD 1TB, მყარი დისკი HDD",),
        )
        _insert(conn, 31, "მონაცემთა შესანახი მოწყობილობების შესყიდვა.")
        conn.execute(
            "UPDATE tenders SET spec_text = ? WHERE app_id = 31",
            ("გარე მყარი დისკი 2 TB USB 3.1",),
        )
        _insert(conn, 32, "ქსელური ინფრასტრუქტურა")
        conn.execute(
            "UPDATE tenders SET spec_text = ? WHERE app_id = 32",
            ("დისკური მასივი NAS სტორიჯ სისტემა",),
        )
    found = list_tenders({"keywords": ["storage"]}, db)
    assert {item["appId"] for item in found["items"]} == {32}


def test_wifi_is_access_point_not_wireless_mouse(tmp_repo):
    db = tmp_repo.db_path
    with get_connection(db) as conn:
        _insert(conn, 40, "ნოუთბუქი და უსადენო მაუსი")
        conn.execute(
            "UPDATE tenders SET spec_text = ? WHERE app_id = 40",
            ("Wi-Fi 6E, უსადენო მაუსი",),
        )
        _insert(conn, 41, "ქსელის განახლება")
        conn.execute(
            "UPDATE tenders SET spec_text = ? WHERE app_id = 41",
            ("ქსელის დაშვების წერტილი wifi7",),
        )
    found = list_tenders({"keywords": ["wifi"]}, db)
    assert {item["appId"] for item in found["items"]} == {41}


def test_router_ignores_soho_wifi_router(tmp_repo):
    db = tmp_repo.db_path
    with get_connection(db) as conn:
        _insert(conn, 60, "საგანმანათლებლო კამპუსი")
        conn.execute(
            "UPDATE tenders SET spec_text = ? WHERE app_id = 60",
            ("WIFI როუტერი WI-FI სტანდარტები: IEEE 802.11",),
        )
        _insert(conn, 61, "ქსელის განახლება")
        conn.execute(
            "UPDATE tenders SET spec_text = ? WHERE app_id = 61",
            ("მარშრუტიზატორი 10Gbps, SD-WAN მხარდაჭერით",),
        )
    found = list_tenders({"keywords": ["router"]}, db)
    assert {item["appId"] for item in found["items"]} == {61}


def test_firewall_matches_latin_spec_token(tmp_repo):
    db = tmp_repo.db_path
    with get_connection(db) as conn:
        _insert(conn, 50, "ქსელური მოწყობილობები")
        conn.execute(
            "UPDATE tenders SET spec_text = ? WHERE app_id = 50",
            ("Next-generation firewall, throughput 10 Gbps",),
        )
    found = list_tenders({"keywords": ["firewall"]}, db)
    assert {item["appId"] for item in found["items"]} == {50}


def test_get_tender_returns_extracted_spec_text(tmp_repo):
    db = tmp_repo.db_path
    with get_connection(db) as conn:
        _insert(conn, 70, "ქსელური მოწყობილობები")
        conn.execute(
            "UPDATE tenders SET spec_text = ? WHERE app_id = 70",
            ("კომუტატორი 48 პორტი PoE",),
        )
    detail = get_tender(70, db)
    assert detail is not None
    assert detail["specText"] == "კომუტატორი 48 პორტი PoE"
    assert "resultDocuments" in detail
