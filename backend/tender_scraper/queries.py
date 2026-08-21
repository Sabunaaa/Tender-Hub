"""Query helpers for the API layer."""

from __future__ import annotations

from datetime import date, timedelta
from typing import Any

from .db import get_connection
from .repository import Repository


OPEN_STATUSES = (
    "Tender announced",
    "Bidding commenced",
    "Bidding ended",
    "Selection/Evaluation",
)


def _row_to_summary(r) -> dict[str, Any]:
    return {
        "appId": r["app_id"],
        "key": r["key"],
        "announcementNumber": r["announcement_number"],
        "title": r["title"] or "",
        "status": r["status"] or "",
        "procurementType": r["procurement_type"] or "",
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

    # Restrict to tracked categories by default
    clauses.append(
        "category_code IN (SELECT code FROM tracked_categories WHERE enabled = 1)"
    )

    if filters.get("q"):
        clauses.append(
            "(announcement_number LIKE ? OR title LIKE ? OR buyer LIKE ? OR description LIKE ?)"
        )
        q = f"%{filters['q']}%"
        params.extend([q, q, q, q])
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


def get_tender(app_id: int, db_path=None) -> dict[str, Any] | None:
    with get_connection(db_path) as conn:
        r = conn.execute("SELECT * FROM tenders WHERE app_id = ?", (app_id,)).fetchone()
        if not r:
            return None
        base = _row_to_summary(r)
        cpv = conn.execute(
            "SELECT code, name FROM tender_cpv_codes WHERE app_id=? ORDER BY code",
            (app_id,),
        ).fetchall()
        sections = conn.execute(
            "SELECT id, section_id, title, body, language FROM tender_document_sections WHERE app_id=? ORDER BY id",
            (app_id,),
        ).fetchall()
        atts = conn.execute(
            "SELECT id, name, url, kind, uploaded_at FROM tender_attachments WHERE app_id=? ORDER BY id",
            (app_id,),
        ).fetchall()
        bids = conn.execute(
            "SELECT * FROM tender_bids WHERE app_id=? ORDER BY id",
            (app_id,),
        ).fetchall()
        hist = conn.execute(
            "SELECT status, changed_at FROM tender_status_history WHERE app_id=? ORDER BY changed_at",
            (app_id,),
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
        cutoff_sql = "datetime(?)"
        cutoff_param: list[Any] = [run["started_at"]]
    else:
        # No completed run yet (fresh database): fall back to the last 7 days.
        cutoff_sql = "datetime('now', '-7 days')"
        cutoff_param = []

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
        "since": run["started_at"] if run else None,
        "runId": run["id"] if run else None,
        "runStatus": run["status"] if run else None,
        "runFinishedAt": run["finished_at"] if run else None,
        "count": count,
        "items": [_row_to_summary(r) for r in rows],
    }


def get_stats(db_path=None) -> dict[str, Any]:
    with get_connection(db_path) as conn:
        tracked = conn.execute(
            "SELECT code FROM tracked_categories WHERE enabled=1"
        ).fetchall()
        codes = [r["code"] for r in tracked]
        if not codes:
            return {
                "totalTenders": 0,
                "openTenders": 0,
                "closingWithin7Days": 0,
                "totalEstimatedValue": 0,
                "averageEstimatedValue": 0,
                "currency": "GEL",
                "byMonth": [],
                "byCategory": [],
                "byStatus": [],
                "topBuyers": [],
                "closingSoon": [],
                "newSince": dict(EMPTY_NEW_SINCE),
            }
        placeholders = ",".join("?" * len(codes))
        where = f"WHERE category_code IN ({placeholders})"
        rows = conn.execute(f"SELECT * FROM tenders {where}", codes).fetchall()

        today = date.today().isoformat()
        in7 = (date.today() + timedelta(days=7)).isoformat()
        open_count = sum(1 for r in rows if r["status"] in OPEN_STATUSES)
        closing = [
            r
            for r in rows
            if r["bid_deadline"]
            and r["bid_deadline"][:10] >= today
            and r["bid_deadline"][:10] <= in7
            and r["status"] in OPEN_STATUSES
        ]
        closing.sort(key=lambda r: r["bid_deadline"] or "")
        values = [r["estimated_value"] or 0 for r in rows]
        total_value = sum(values)

        month_map: dict[tuple[str, str], dict] = {}
        cat_map: dict[str, dict] = {}
        status_map: dict[str, int] = {}
        buyer_map: dict[str, dict] = {}
        for r in rows:
            month = (r["announcement_date"] or "")[:7]
            key = (month, r["category_code"] or "")
            if month:
                cur = month_map.setdefault(
                    key,
                    {
                        "month": month,
                        "categoryCode": r["category_code"],
                        "categoryName": r["category_name"],
                        "count": 0,
                        "value": 0,
                    },
                )
                cur["count"] += 1
                cur["value"] += r["estimated_value"] or 0
            code = r["category_code"] or ""
            cur = cat_map.setdefault(
                code,
                {
                    "categoryCode": code,
                    "categoryName": r["category_name"] or "",
                    "count": 0,
                    "value": 0,
                },
            )
            cur["count"] += 1
            cur["value"] += r["estimated_value"] or 0
            status_map[r["status"] or "Unknown"] = status_map.get(r["status"] or "Unknown", 0) + 1
            buyer = r["buyer"] or "Unknown"
            b = buyer_map.setdefault(buyer, {"buyer": buyer, "count": 0, "value": 0})
            b["count"] += 1
            b["value"] += r["estimated_value"] or 0

        return {
            "totalTenders": len(rows),
            "openTenders": open_count,
            "closingWithin7Days": len(closing),
            "totalEstimatedValue": total_value,
            "averageEstimatedValue": (total_value / len(rows)) if rows else 0,
            "currency": "GEL",
            "byMonth": sorted(month_map.values(), key=lambda x: x["month"]),
            "byCategory": sorted(cat_map.values(), key=lambda x: -x["count"]),
            "byStatus": [{"status": k, "count": v} for k, v in status_map.items()],
            "topBuyers": sorted(buyer_map.values(), key=lambda x: -x["count"])[:10],
            "closingSoon": [_row_to_summary(r) for r in closing[:8]],
            "newSince": _new_since_last_run(conn, where, codes),
        }


def filter_options(repo: Repository, db_path=None) -> dict[str, Any]:
    tracked = repo.list_tracked()
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
        statuses = [
            r["status"]
            for r in conn.execute(
                f"SELECT DISTINCT status FROM tenders WHERE category_code IN ({placeholders}) AND status IS NOT NULL ORDER BY status",
                codes,
            )
        ]
        types = [
            r["procurement_type"]
            for r in conn.execute(
                f"SELECT DISTINCT procurement_type FROM tenders WHERE category_code IN ({placeholders}) AND procurement_type IS NOT NULL ORDER BY procurement_type",
                codes,
            )
        ]
        buyers = [
            r["buyer"]
            for r in conn.execute(
                f"SELECT DISTINCT buyer FROM tenders WHERE category_code IN ({placeholders}) AND buyer IS NOT NULL ORDER BY buyer",
                codes,
            )
        ]
        return {
            "statuses": statuses,
            "procurementTypes": types,
            "buyers": buyers,
            "categories": [{"id": c["id"], "code": c["code"], "name": c["name"]} for c in tracked],
            "trackedCategories": tracked,
        }
