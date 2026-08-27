"""Query helpers for the API layer."""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from typing import Any

from .db import get_connection
from .keywords import keyword_clause
from .listing import KIND_MRS, KIND_TENDER, normalize_kind, public_app_id, store_app_id
from .repository import Repository
from .settings import TBILISI, load_settings


OPEN_STATUSES = (
    "Tender announced",
    "Bidding commenced",
    "Bidding ended",
    "Selection/Evaluation",
)


def _row_to_summary(r) -> dict[str, Any]:
    kind = normalize_kind(r["kind"] if "kind" in r.keys() else KIND_TENDER)
    stored_id = r["app_id"]
    return {
        "appId": public_app_id(kind, stored_id),
        "kind": kind,
        "key": r["key"],
        "announcementNumber": r["announcement_number"],
        "title": r["title"] or "",
        "status": r["status"] or "",
        "procurementType": r["procurement_type"] or "",
        "donor": (r["donor"] or "") if "donor" in r.keys() else "",
        "buyer": r["buyer"] or "",
        "buyerOrgId": r["buyer_org_id"],
        "categoryCode": r["category_code"] or "",
        "categoryName": r["category_name"] or "",
        "announcementDate": r["announcement_date"],
        "bidDeadline": r["bid_deadline"],
        "bidsAcceptedFrom": r["bids_accepted_from"],
        "estimatedValue": r["estimated_value"],
        "currency": r["currency"] or "GEL",
        "bidderCount": r["bidder_count"] or 0,
        "winner": r["winner"],
        "contractStatus": r["contract_status"],
        "sourceUrl": r["source_url"] or "",
        "hasSpecText": bool((r["spec_text"] or "").strip()) if "spec_text" in r.keys() else False,
    }


SORT_MAP = {
    "announcementDate": "announcement_date",
    "bidDeadline": "bid_deadline",
    "estimatedValue": "estimated_value",
    "status": "status",
    "buyer": "buyer",
}


def list_tenders(filters: dict[str, Any], db_path=None) -> dict[str, Any]:
    clauses = []
    params: list[Any] = []
    kind = normalize_kind(filters.get("kind"))

    # Restrict to tracked categories for this listing type
    clauses.append("COALESCE(kind, 'tender') = ?")
    params.append(kind)
    clauses.append(
        "category_code IN (SELECT code FROM tracked_categories WHERE enabled = 1 AND kind = ?)"
    )
    params.append(kind)

    if filters.get("q"):
        clauses.append(
            "(announcement_number LIKE ? OR title LIKE ? OR buyer LIKE ? OR description LIKE ?)"
        )
        q = f"%{filters['q']}%"
        params.extend([q, q, q, q])
    kw_sql, kw_params = keyword_clause(filters.get("keywords"))
    if kw_sql:
        clauses.append(kw_sql)
        params.extend(kw_params)
    if filters.get("categoryCodes"):
        placeholders = ",".join("?" * len(filters["categoryCodes"]))
        clauses.append(f"category_code IN ({placeholders})")
        params.extend(filters["categoryCodes"])
    if filters.get("cpvCode"):
        clauses.append(
            "app_id IN (SELECT app_id FROM tender_cpv_codes WHERE code LIKE ?)"
        )
        params.append(f"%{filters['cpvCode']}%")
    if filters.get("status"):
        placeholders = ",".join("?" * len(filters["status"]))
        clauses.append(f"status IN ({placeholders})")
        params.extend(filters["status"])
    if filters.get("procurementType"):
        placeholders = ",".join("?" * len(filters["procurementType"]))
        clauses.append(f"procurement_type IN ({placeholders})")
        params.extend(filters["procurementType"])
    if filters.get("buyer"):
        clauses.append("buyer LIKE ?")
        params.append(f"%{filters['buyer']}%")
    if filters.get("dateFrom"):
        clauses.append("announcement_date >= ?")
        params.append(filters["dateFrom"])
    if filters.get("dateTo"):
        clauses.append("announcement_date <= ?")
        params.append(filters["dateTo"] + "Z" if False else filters["dateTo"])
        # announcement_date may be date or datetime; lexicographic compare works for ISO
    if filters.get("deadlineFrom"):
        clauses.append("bid_deadline >= ?")
        params.append(filters["deadlineFrom"])
    if filters.get("deadlineTo"):
        clauses.append("bid_deadline <= ?")
        params.append(filters["deadlineTo"])
    if filters.get("withinDeadline"):
        today = date.today().isoformat()
        clauses.append("bid_deadline IS NOT NULL AND bid_deadline >= ?")
        params.append(today)
    if filters.get("amountFrom") is not None:
        clauses.append("estimated_value >= ?")
        params.append(filters["amountFrom"])
    if filters.get("amountTo") is not None:
        clauses.append("estimated_value <= ?")
        params.append(filters["amountTo"])
    if filters.get("hasSpec"):
        clauses.append("spec_text IS NOT NULL AND trim(spec_text) != ''")
    if filters.get("bidderCountMin") is not None:
        clauses.append("bidder_count >= ?")
        params.append(filters["bidderCountMin"])
    if filters.get("bidderCountMax") is not None:
        clauses.append("bidder_count <= ?")
        params.append(filters["bidderCountMax"])

    where = (" WHERE " + " AND ".join(clauses)) if clauses else ""
    sort_col = SORT_MAP.get(filters.get("sortBy") or "announcementDate", "announcement_date")
    sort_dir = "ASC" if filters.get("sortDir") == "asc" else "DESC"
    page = max(1, int(filters.get("page") or 1))
    page_size = min(100, max(1, int(filters.get("pageSize") or 20)))
    offset = (page - 1) * page_size

    with get_connection(db_path) as conn:
        total = conn.execute(f"SELECT COUNT(*) AS c FROM tenders{where}", params).fetchone()["c"]
        rows = conn.execute(
            f"""
            SELECT * FROM tenders{where}
            ORDER BY {sort_col} {sort_dir}, app_id DESC
            LIMIT ? OFFSET ?
            """,
            [*params, page_size, offset],
        ).fetchall()
        return {
            "items": [_row_to_summary(r) for r in rows],
            "total": total,
            "page": page,
            "pageSize": page_size,
        }


def get_tender(app_id: int, db_path=None, kind: str = KIND_TENDER) -> dict[str, Any] | None:
    listing_kind = normalize_kind(kind)
    stored_id = store_app_id(listing_kind, app_id)
    with get_connection(db_path) as conn:
        r = conn.execute("SELECT * FROM tenders WHERE app_id = ?", (stored_id,)).fetchone()
        if not r:
            return None
        base = _row_to_summary(r)
        cpv = conn.execute(
            "SELECT code, name FROM tender_cpv_codes WHERE app_id=? ORDER BY code",
            (stored_id,),
        ).fetchall()
        sections = conn.execute(
            "SELECT id, section_id, title, body, language FROM tender_document_sections WHERE app_id=? ORDER BY id",
            (stored_id,),
        ).fetchall()
        atts = conn.execute(
            "SELECT id, name, url, kind, uploaded_at FROM tender_attachments WHERE app_id=? ORDER BY id",
            (stored_id,),
        ).fetchall()
        bids = conn.execute(
            "SELECT * FROM tender_bids WHERE app_id=? ORDER BY id",
            (stored_id,),
        ).fetchall()
        hist = conn.execute(
            "SELECT status, changed_at FROM tender_status_history WHERE app_id=? ORDER BY changed_at",
            (stored_id,),
        ).fetchall()

        section_atts = [a for a in atts if a["kind"] == "section"]
        doc_atts = [a for a in atts if a["kind"] == "doc"]
        result_atts = [a for a in atts if a["kind"] == "result"]

        document_sections = []
        for s in sections:
            document_sections.append(
                {
                    "id": str(s["id"]),
                    "title": s["title"] or "",
                    "body": s["body"] or "",
                    "language": s["language"] or "ka",
                    "attachments": [],
                }
            )

        return {
            **base,
            "description": r["description"] or "",
            "supplyPeriod": r["supply_period"],
            "vatTerms": r["vat_terms"],
            "guaranteeAmount": r["guarantee_amount"],
            "guaranteeValidity": r["guarantee_validity"],
            "bidReductionStep": r["bid_reduction_step"],
            "amountOrVolume": r["amount_or_volume"],
            "additionalInfo": r["additional_info"],
            "specText": (r["spec_text"] or "") if "spec_text" in r.keys() else "",
            "cpvCodes": [{"code": c["code"], "name": c["name"] or ""} for c in cpv],
            "documentSections": document_sections,
            "attachments": [
                {"id": str(a["id"]), "name": a["name"], "url": a["url"], "uploadedAt": a["uploaded_at"]}
                for a in (doc_atts or section_atts)
            ],
            "bids": [
                {
                    "bidderName": b["bidder_name"] or "",
                    "bidderOrgId": b["bidder_org_id"],
                    "firstOfferAmount": b["first_offer_amount"],
                    "firstOfferAt": b["first_offer_at"],
                    "lastOfferAmount": b["last_offer_amount"],
                    "lastOfferAt": b["last_offer_at"],
                    "offerCount": b["offer_count"] or 1,
                }
                for b in bids
            ],
            "statusHistory": [
                {"status": h["status"], "changedAt": h["changed_at"]} for h in hist
            ],
            "resultDocuments": [
                {"id": str(a["id"]), "name": a["name"], "url": a["url"], "uploadedAt": a["uploaded_at"]}
                for a in result_atts
            ],
            "scrapedAt": r["scraped_at"],
        }


EMPTY_NEW_SINCE: dict[str, Any] = {
    "since": None,
    "runId": None,
    "runStatus": None,
    "runFinishedAt": None,
    "count": 0,
    "items": [],
}


def _new_tenders_since(
    conn,
    where: str,
    codes: list[str],
    cutoff_sql: str,
    cutoff_param: list[Any],
    *,
    since: str | None = None,
    run_id: int | None = None,
    run_status: str | None = None,
    run_finished_at: str | None = None,
    limit: int = 8,
) -> dict[str, Any]:
    condition = f"{where} AND datetime(created_at) >= {cutoff_sql}"
    count = conn.execute(
        f"SELECT COUNT(*) AS c FROM tenders {condition}",
        codes + cutoff_param,
    ).fetchone()["c"]
    rows = conn.execute(
        f"""
        SELECT * FROM tenders {condition}
        ORDER BY datetime(created_at) DESC, announcement_date DESC
        LIMIT ?
        """,
        codes + cutoff_param + [limit],
    ).fetchall()
    return {
        "since": since,
        "runId": run_id,
        "runStatus": run_status,
        "runFinishedAt": run_finished_at,
        "count": count,
        "items": [_row_to_summary(r) for r in rows],
    }


def _new_since_last_run(conn, where: str, codes: list[str], limit: int = 8) -> dict[str, Any]:
    """Tenders first inserted by the most recent completed scrape run.

    tenders.created_at is written by SQLite as 'YYYY-MM-DD HH:MM:SS' while run
    timestamps are ISO-8601 with an offset, so both sides go through datetime()
    to normalise to UTC before comparing.
    """
    run = conn.execute(
        """
        SELECT id, started_at, finished_at, status
        FROM scrape_runs
        WHERE status != 'running'
        ORDER BY id DESC
        LIMIT 1
        """
    ).fetchone()

    if run and run["started_at"]:
        return _new_tenders_since(
            conn,
            where,
            codes,
            "datetime(?)",
            [run["started_at"]],
            since=run["started_at"],
            run_id=run["id"],
            run_status=run["status"],
            run_finished_at=run["finished_at"],
            limit=limit,
        )
    # No completed run yet (fresh database): fall back to the last 7 days.
    return _new_tenders_since(
        conn,
        where,
        codes,
        "datetime('now', '-7 days')",
        [],
        limit=limit,
    )


def _utc_naive(value: datetime) -> str:
    return value.astimezone(timezone.utc).replace(tzinfo=None).strftime("%Y-%m-%d %H:%M:%S")


def _new_in_tbilisi_window(conn, where: str, codes: list[str], start: datetime) -> dict[str, Any]:
    return _new_tenders_since(
        conn,
        where,
        codes,
        "datetime(?)",
        [_utc_naive(start)],
        since=start.isoformat(),
    )


def get_stats(db_path=None) -> dict[str, Any]:
    with get_connection(db_path) as conn:
        tracked = conn.execute(
            "SELECT code FROM tracked_categories WHERE enabled=1 AND kind=?",
            (KIND_TENDER,),
        ).fetchall()
        codes = [r["code"] for r in tracked]
        mrs_codes = [
            r["code"]
            for r in conn.execute(
                "SELECT code FROM tracked_categories WHERE enabled=1 AND kind=?",
                (KIND_MRS,),
            ).fetchall()
        ]
        horizon = load_settings().closing_soon_days
        empty_mrs = {
            "mrsNewSince": dict(EMPTY_NEW_SINCE),
            "mrsNewToday": dict(EMPTY_NEW_SINCE),
            "mrsNewWeek": dict(EMPTY_NEW_SINCE),
        }
        tbilisi_today = datetime.now(TBILISI).replace(hour=0, minute=0, second=0, microsecond=0)
        tbilisi_week = tbilisi_today - timedelta(days=tbilisi_today.weekday())
        mrs_digest = dict(empty_mrs)
        if mrs_codes:
            mrs_ph = ",".join("?" * len(mrs_codes))
            mrs_where = f"WHERE COALESCE(kind, 'tender') = 'mrs' AND category_code IN ({mrs_ph})"
            mrs_digest = {
                "mrsNewSince": _new_since_last_run(conn, mrs_where, mrs_codes),
                "mrsNewToday": _new_in_tbilisi_window(conn, mrs_where, mrs_codes, tbilisi_today),
                "mrsNewWeek": _new_in_tbilisi_window(conn, mrs_where, mrs_codes, tbilisi_week),
            }
        if not codes:
            engagement = conn.execute(
                """
                SELECT
                    COUNT(*) AS total,
                    COALESCE(SUM(CASE WHEN engaged = 1 THEN 1 ELSE 0 END), 0) AS engaged
                FROM engagements
                """
            ).fetchone()
            return {
                "totalTenders": 0,
                "openTenders": 0,
                "closingWithin7Days": 0,
                "closingSoonDays": horizon,
                "newThisWeek": 0,
                "openUntracked": 0,
                "onEngagement": int(engagement["total"] or 0),
                "engagedCount": int(engagement["engaged"] or 0),
                "currency": "GEL",
                "byMonth": [],
                "byCategory": [],
                "byStatus": [],
                "topBuyers": [],
                "closingSoon": [],
                "newSince": dict(EMPTY_NEW_SINCE),
                "newToday": dict(EMPTY_NEW_SINCE),
                "newWeek": dict(EMPTY_NEW_SINCE),
                **mrs_digest,
            }
        placeholders = ",".join("?" * len(codes))
        where = f"WHERE COALESCE(kind, 'tender') = 'tender' AND category_code IN ({placeholders})"
        today = date.today().isoformat()
        week_start = (date.today() - timedelta(days=6)).isoformat()
        horizon_end = (date.today() + timedelta(days=horizon)).isoformat()
        open_ph = ",".join("?" * len(OPEN_STATUSES))

        totals = conn.execute(
            f"""
            SELECT
                COUNT(*) AS total,
                SUM(CASE WHEN status IN ({open_ph}) THEN 1 ELSE 0 END) AS open_count,
                SUM(CASE
                    WHEN bid_deadline IS NOT NULL
                     AND substr(bid_deadline, 1, 10) >= ?
                     AND substr(bid_deadline, 1, 10) <= ?
                     AND status IN ({open_ph})
                    THEN 1 ELSE 0 END) AS closing_count,
                SUM(CASE
                    WHEN announcement_date IS NOT NULL
                     AND announcement_date != ''
                     AND substr(announcement_date, 1, 10) >= ?
                     AND substr(announcement_date, 1, 10) <= ?
                    THEN 1 ELSE 0 END) AS new_week,
                SUM(CASE
                    WHEN status IN ({open_ph})
                     AND NOT EXISTS (
                        SELECT 1 FROM engagements e
                        WHERE e.app_id = tenders.app_id
                           OR (
                             tenders.announcement_number IS NOT NULL
                             AND e.announcement_number = tenders.announcement_number COLLATE NOCASE
                           )
                     )
                    THEN 1 ELSE 0 END) AS open_untracked
            FROM tenders {where}
            """,
            [
                *OPEN_STATUSES,
                today,
                horizon_end,
                *OPEN_STATUSES,
                week_start,
                today,
                *OPEN_STATUSES,
                *codes,
            ],
        ).fetchone()
        total = int(totals["total"] or 0)
        engagement = conn.execute(
            """
            SELECT
                COUNT(*) AS total,
                COALESCE(SUM(CASE WHEN engaged = 1 THEN 1 ELSE 0 END), 0) AS engaged
            FROM engagements
            """
        ).fetchone()

        by_month = [
            {
                "month": r["month"],
                "categoryCode": r["category_code"],
                "categoryName": r["category_name"],
                "count": r["count"],
                "value": float(r["value"] or 0),
            }
            for r in conn.execute(
                f"""
                SELECT
                    substr(announcement_date, 1, 7) AS month,
                    category_code,
                    category_name,
                    COUNT(*) AS count,
                    COALESCE(SUM(COALESCE(estimated_value, 0)), 0) AS value
                FROM tenders {where}
                  AND announcement_date IS NOT NULL
                  AND announcement_date != ''
                GROUP BY substr(announcement_date, 1, 7), category_code
                ORDER BY month
                """,
                codes,
            )
        ]
        by_category = [
            {
                "categoryCode": r["category_code"] or "",
                "categoryName": r["category_name"] or "",
                "count": r["count"],
                "openCount": int(r["open_count"] or 0),
                "value": float(r["value"] or 0),
            }
            for r in conn.execute(
                f"""
                SELECT
                    category_code,
                    category_name,
                    COUNT(*) AS count,
                    SUM(CASE WHEN status IN ({open_ph}) THEN 1 ELSE 0 END) AS open_count,
                    COALESCE(SUM(COALESCE(estimated_value, 0)), 0) AS value
                FROM tenders {where}
                GROUP BY category_code
                ORDER BY open_count DESC, count DESC, MIN(rowid)
                """,
                [*OPEN_STATUSES, *codes],
            )
        ]
        by_status = [
            {"status": r["status"], "count": r["count"]}
            for r in conn.execute(
                f"""
                SELECT COALESCE(status, 'Unknown') AS status, COUNT(*) AS count
                FROM tenders {where}
                GROUP BY COALESCE(status, 'Unknown')
                ORDER BY MIN(rowid)
                """,
                codes,
            )
        ]
        top_buyers = [
            {
                "buyer": r["buyer"],
                "count": r["count"],
                "openCount": int(r["open_count"] or 0),
                "value": float(r["value"] or 0),
            }
            for r in conn.execute(
                f"""
                SELECT
                    COALESCE(buyer, 'Unknown') AS buyer,
                    COUNT(*) AS count,
                    SUM(CASE WHEN status IN ({open_ph}) THEN 1 ELSE 0 END) AS open_count,
                    COALESCE(SUM(COALESCE(estimated_value, 0)), 0) AS value
                FROM tenders {where}
                GROUP BY COALESCE(buyer, 'Unknown')
                ORDER BY open_count DESC, count DESC, MIN(rowid)
                LIMIT 10
                """,
                [*OPEN_STATUSES, *codes],
            )
        ]
        closing = conn.execute(
            f"""
            SELECT * FROM tenders {where}
              AND bid_deadline IS NOT NULL
              AND substr(bid_deadline, 1, 10) >= ?
              AND substr(bid_deadline, 1, 10) <= ?
              AND status IN ({open_ph})
            ORDER BY bid_deadline
            LIMIT 8
            """,
            [*codes, today, horizon_end, *OPEN_STATUSES],
        ).fetchall()

        return {
            "totalTenders": total,
            "openTenders": int(totals["open_count"] or 0),
            "closingWithin7Days": int(totals["closing_count"] or 0),
            "closingSoonDays": horizon,
            "newThisWeek": int(totals["new_week"] or 0),
            "openUntracked": int(totals["open_untracked"] or 0),
            "onEngagement": int(engagement["total"] or 0),
            "engagedCount": int(engagement["engaged"] or 0),
            "currency": "GEL",
            "byMonth": by_month,
            "byCategory": by_category,
            "byStatus": by_status,
            "topBuyers": top_buyers,
            "closingSoon": [_row_to_summary(r) for r in closing],
            "newSince": _new_since_last_run(conn, where, codes),
            "newToday": _new_in_tbilisi_window(conn, where, codes, tbilisi_today),
            "newWeek": _new_in_tbilisi_window(conn, where, codes, tbilisi_week),
            **mrs_digest,
        }


def filter_options(repo: Repository, db_path=None, kind: str = KIND_TENDER) -> dict[str, Any]:
    listing_kind = normalize_kind(kind)
    tracked = repo.list_tracked(kind=listing_kind)
    codes = [c["code"] for c in tracked if c["enabled"]]
    with get_connection(db_path) as conn:
        if not codes:
            return {
                "statuses": [],
                "procurementTypes": [],
                "buyers": [],
                "categories": [],
                "trackedCategories": tracked,
            }
        placeholders = ",".join("?" * len(codes))
        scope = f"COALESCE(kind, 'tender') = ? AND category_code IN ({placeholders})"
        scope_params: list[Any] = [listing_kind, *codes]
        statuses = [
            r["status"]
            for r in conn.execute(
                f"SELECT DISTINCT status FROM tenders WHERE {scope} AND status IS NOT NULL ORDER BY status",
                scope_params,
            )
        ]
        types = [
            r["procurement_type"]
            for r in conn.execute(
                f"SELECT DISTINCT procurement_type FROM tenders WHERE {scope} AND procurement_type IS NOT NULL ORDER BY procurement_type",
                scope_params,
            )
        ]
        buyers = [
            r["buyer"]
            for r in conn.execute(
                f"SELECT DISTINCT buyer FROM tenders WHERE {scope} AND buyer IS NOT NULL ORDER BY buyer",
                scope_params,
            )
        ]
        return {
            "statuses": statuses,
            "procurementTypes": types,
            "buyers": buyers,
            "categories": [{"id": c["id"], "code": c["code"], "name": c["name"]} for c in tracked],
            "trackedCategories": tracked,
        }
