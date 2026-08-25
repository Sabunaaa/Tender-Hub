"""Repository layer for tenders, categories, and scrape runs."""

from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from typing import Any

from . import config
from .db import connect, get_connection, init_db
from .parsers import ParsedTender
from .specs import SPEC_MARKER


# Detail tabs whose child rows are owned by a scrape: app_main, app_docs,
# app_bids and agency_docs respectively.
ALL_TENDER_PARTS = frozenset({"main", "docs", "bids", "results"})


class ActiveScrapeError(RuntimeError):
    """Raised when start_run is called while another run is still marked running."""


def now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


class Repository:
    def __init__(self, db_path=None):
        self.db_path = db_path
        init_db(db_path)

    def upsert_tender(
        self,
        tender: ParsedTender,
        category_code: str | None = None,
        category_name: str | None = None,
        replace: frozenset[str] | set[str] | None = None,
    ) -> bool:
        """Insert or update a tender. Returns True if newly inserted.

        ``replace`` names the detail tabs that were actually fetched this time
        (``main``, ``docs``, ``bids``, ``results``). Child rows belonging to a tab
        that was skipped are left untouched, so a partial re-scrape cannot wipe
        documentation or bids that are still valid.
        """
        replace = frozenset(replace) if replace is not None else ALL_TENDER_PARTS
        scraped_at = now_iso()

        with get_connection(self.db_path) as conn:
            existing = conn.execute(
                "SELECT status, category_code, category_name FROM tenders WHERE app_id = ?",
                (tender.app_id,),
            ).fetchone()
            is_new = existing is None
            tracked_codes = {
                r["code"]
                for r in conn.execute("SELECT code FROM tracked_categories WHERE enabled = 1")
            }
            # Listing "Procuring category" is often a more specific or sibling CPV
            # than the division we searched. Keep an existing tracked bucket; otherwise
            # attribute the tender to the category this scrape is collecting.
            existing_code = (existing["category_code"] if existing else "") or ""
            if existing_code in tracked_codes:
                tender.category_code = existing_code
                tender.category_name = existing["category_name"] or tender.category_name
            elif category_code:
                tender.category_code = category_code
                if category_name:
                    tender.category_name = category_name
            elif category_name and not tender.category_name:
                tender.category_name = category_name
            conn.execute(
                """
                INSERT INTO tenders (
                    app_id, key, announcement_number, title, status, procurement_type, donor,
                    buyer, buyer_org_id, category_code, category_name, announcement_date,
                    bid_deadline, bids_accepted_from, estimated_value, currency, bidder_count,
                    winner, contract_status, source_url, description, supply_period, vat_terms,
                    guarantee_amount, guarantee_validity, bid_reduction_step, amount_or_volume,
                    additional_info, spec_text, scraped_at, updated_at
                ) VALUES (
                    ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?
                )
                ON CONFLICT(app_id) DO UPDATE SET
                    key=excluded.key,
                    announcement_number=excluded.announcement_number,
                    title=excluded.title,
                    status=excluded.status,
                    procurement_type=excluded.procurement_type,
                    donor=excluded.donor,
                    buyer=excluded.buyer,
                    buyer_org_id=excluded.buyer_org_id,
                    category_code=COALESCE(excluded.category_code, tenders.category_code),
                    category_name=COALESCE(excluded.category_name, tenders.category_name),
                    announcement_date=excluded.announcement_date,
                    bid_deadline=excluded.bid_deadline,
                    bids_accepted_from=excluded.bids_accepted_from,
                    estimated_value=excluded.estimated_value,
                    currency=excluded.currency,
                    bidder_count=excluded.bidder_count,
                    winner=excluded.winner,
                    contract_status=excluded.contract_status,
                    source_url=excluded.source_url,
                    description=excluded.description,
                    supply_period=excluded.supply_period,
                    vat_terms=excluded.vat_terms,
                    guarantee_amount=excluded.guarantee_amount,
                    guarantee_validity=excluded.guarantee_validity,
                    bid_reduction_step=excluded.bid_reduction_step,
                    amount_or_volume=excluded.amount_or_volume,
                    additional_info=excluded.additional_info,
                    spec_text=COALESCE(excluded.spec_text, tenders.spec_text),
                    scraped_at=excluded.scraped_at,
                    updated_at=excluded.updated_at
                """,
                (
                    tender.app_id, tender.key, tender.announcement_number, tender.title, tender.status,
                    tender.procurement_type, tender.donor, tender.buyer, tender.buyer_org_id, tender.category_code,
                    tender.category_name, tender.announcement_date, tender.bid_deadline,
                    tender.bids_accepted_from, tender.estimated_value, tender.currency, tender.bidder_count,
                    tender.winner, tender.contract_status, tender.source_url, tender.description,
                    tender.supply_period, tender.vat_terms, tender.guarantee_amount, tender.guarantee_validity,
                    tender.bid_reduction_step, tender.amount_or_volume, tender.additional_info,
                    tender.spec_text, scraped_at, scraped_at,
                ),
            )

            # Replace only the child rows whose source tab was fetched this time
            if "main" in replace:
                conn.execute("DELETE FROM tender_cpv_codes WHERE app_id = ?", (tender.app_id,))
                codes_seen: set[str] = set()
                for cpv in tender.cpv_codes:
                    code = (cpv.get("code") or "").strip()
                    if not code or code in codes_seen:
                        continue
                    codes_seen.add(code)
                    conn.execute(
                        "INSERT OR IGNORE INTO tender_cpv_codes (app_id, code, name) VALUES (?,?,?)",
                        (tender.app_id, code, cpv.get("name")),
                    )
                if tender.category_code and tender.category_code not in codes_seen:
                    conn.execute(
                        "INSERT OR IGNORE INTO tender_cpv_codes (app_id, code, name) VALUES (?,?,?)",
                        (tender.app_id, tender.category_code, tender.category_name),
                    )

            if "docs" in replace:
                conn.execute("DELETE FROM tender_document_sections WHERE app_id = ?", (tender.app_id,))
                conn.execute(
                    "DELETE FROM tender_attachments WHERE app_id = ? AND kind IN ('section','doc')",
                    (tender.app_id,),
                )
                for sec in tender.document_sections:
                    conn.execute(
                        """
                        INSERT INTO tender_document_sections (app_id, section_id, title, body, language)
                        VALUES (?,?,?,?,?)
                        """,
                        (tender.app_id, sec.get("section_id"), sec.get("title"), sec.get("body"), sec.get("language", "ka")),
                    )
                    for att in sec.get("attachments") or []:
                        conn.execute(
                            "INSERT INTO tender_attachments (app_id, name, url, kind) VALUES (?,?,?,?)",
                            (tender.app_id, att.get("name"), att.get("url"), "section"),
                        )
                for att in tender.attachments:
                    conn.execute(
                        "INSERT INTO tender_attachments (app_id, name, url, kind) VALUES (?,?,?,?)",
                        (tender.app_id, att.get("name"), att.get("url"), "doc"),
                    )

            if "results" in replace:
                conn.execute(
                    "DELETE FROM tender_attachments WHERE app_id = ? AND kind = 'result'",
                    (tender.app_id,),
                )
                for att in tender.result_documents:
                    conn.execute(
                        "INSERT INTO tender_attachments (app_id, name, url, kind) VALUES (?,?,?,?)",
                        (tender.app_id, att.get("name"), att.get("url"), "result"),
                    )

            if "bids" in replace:
                conn.execute("DELETE FROM tender_bids WHERE app_id = ?", (tender.app_id,))
            for bid in tender.bids if "bids" in replace else []:
                conn.execute(
                    """
                    INSERT INTO tender_bids (
                        app_id, bidder_name, bidder_org_id, first_offer_amount, first_offer_at,
                        last_offer_amount, last_offer_at, offer_count
                    ) VALUES (?,?,?,?,?,?,?,?)
                    """,
                    (
                        tender.app_id, bid.get("bidder_name"), bid.get("bidder_org_id"),
                        bid.get("first_offer_amount"), bid.get("first_offer_at"),
                        bid.get("last_offer_amount"), bid.get("last_offer_at"), bid.get("offer_count", 1),
                    ),
                )
            for hist in tender.status_history:
                conn.execute(
                    """
                    INSERT OR IGNORE INTO tender_status_history (app_id, status, changed_at)
                    VALUES (?,?,?)
                    """,
                    (tender.app_id, hist.get("status"), hist.get("changed_at")),
                )
            # Track status change if status flipped
            if existing and existing["status"] != tender.status and tender.status:
                conn.execute(
                    """
                    INSERT OR IGNORE INTO tender_status_history (app_id, status, changed_at)
                    VALUES (?,?,?)
                    """,
                    (tender.app_id, tender.status, scraped_at),
                )
            return is_new

    def get_tender_states(self, app_ids: list[int]) -> dict[int, dict[str, Any]]:
        """Return the stored fields needed to decide whether a tender must be re-fetched.

        ``hasDocs`` reports whether tender documentation was ever stored, so a run can
        skip the ``app_docs`` request for tenders whose documentation is already on disk.
        """
        if not app_ids:
            return {}
        states: dict[int, dict[str, Any]] = {}
        with get_connection(self.db_path) as conn:
            # SQLite caps bound parameters per statement, so read in chunks.
            for start in range(0, len(app_ids), 400):
                chunk = app_ids[start : start + 400]
                placeholders = ",".join("?" * len(chunk))
                rows = conn.execute(
                    f"""
                    SELECT t.app_id, t.status, t.bid_deadline, t.estimated_value, t.bidder_count,
                           t.winner, t.contract_status, t.title, t.description, t.spec_text,
                           (SELECT COUNT(*) FROM tender_document_sections d WHERE d.app_id = t.app_id) AS doc_count
                    FROM tenders t
                    WHERE t.app_id IN ({placeholders})
                    """,
                    chunk,
                ).fetchall()
                for r in rows:
                    states[r["app_id"]] = {
                        "status": r["status"],
                        "bidDeadline": r["bid_deadline"],
                        "estimatedValue": r["estimated_value"],
                        "bidderCount": r["bidder_count"] or 0,
                        "winner": r["winner"],
                        "contractStatus": r["contract_status"],
                        "title": r["title"],
                        "description": r["description"],
                        "hasDocs": (r["doc_count"] or 0) > 0,
                        "hasSpec": r["spec_text"] is not None,
                    }
        return states

    def list_doc_attachments(self, app_id: int) -> list[dict[str, str]]:
        with get_connection(self.db_path) as conn:
            rows = conn.execute(
                """
                SELECT name, url FROM tender_attachments
                WHERE app_id = ? AND kind IN ('doc', 'section')
                """,
                (app_id,),
            ).fetchall()
        return [{"name": r["name"] or "", "url": r["url"] or ""} for r in rows]

    def app_ids_with_spec_attachments(self, limit: int | None = None) -> list[int]:
        """Tenders that have a ტექნიკური attachment, whether or not it was parsed before."""
        sql = """
            SELECT DISTINCT app_id FROM tender_attachments
            WHERE kind IN ('doc', 'section') AND name LIKE ?
            ORDER BY app_id
        """
        params: list[Any] = [f"%{SPEC_MARKER}%"]
        if limit:
            sql += " LIMIT ?"
            params.append(limit)
        with get_connection(self.db_path) as conn:
            return [r["app_id"] for r in conn.execute(sql, params).fetchall()]

    def save_spec_text(self, app_id: int, text: str) -> None:
        with get_connection(self.db_path) as conn:
            conn.execute("UPDATE tenders SET spec_text = ? WHERE app_id = ?", (text, app_id))

    def app_ids_missing_spec(self, app_ids: list[int] | None = None, limit: int | None = None) -> list[int]:
        """Tenders that have never had a spec-file extraction attempted."""
        sql = "SELECT app_id FROM tenders WHERE spec_text IS NULL"
        params: list[Any] = []
        if app_ids is not None:
            if not app_ids:
                return []
            placeholders = ",".join("?" * len(app_ids))
            sql += f" AND app_id IN ({placeholders})"
            params.extend(app_ids)
        sql += " ORDER BY app_id"
        if limit:
            sql += " LIMIT ?"
            params.append(limit)
        with get_connection(self.db_path) as conn:
            return [r["app_id"] for r in conn.execute(sql, params).fetchall()]

    def save_raw_html(self, app_id: int | None, kind: str, html: str) -> None:
        with get_connection(self.db_path) as conn:
            conn.execute(
                "INSERT INTO raw_html (app_id, kind, html) VALUES (?,?,?)",
                (app_id, kind, html),
            )

    def earliest_announcement_date(self, category_code: str) -> str | None:
        with get_connection(self.db_path) as conn:
            row = conn.execute(
                """
                SELECT MIN(announcement_date) AS d
                FROM tenders
                WHERE category_code = ?
                  AND announcement_date IS NOT NULL
                  AND announcement_date != ''
                """,
                (category_code,),
            ).fetchone()
        value = row["d"] if row else None
        return str(value)[:10] if value else None

    def list_tracked(self, enabled_only: bool = False) -> list[dict[str, Any]]:
        with get_connection(self.db_path) as conn:
            sql = "SELECT * FROM tracked_categories"
            if enabled_only:
                sql += " WHERE enabled = 1"
            sql += " ORDER BY code"
            rows = conn.execute(sql).fetchall()
            counts = {
                r["category_code"]: r["c"]
                for r in conn.execute(
                    "SELECT category_code, COUNT(*) AS c FROM tenders GROUP BY category_code"
                ).fetchall()
            }
            return [
                {
                    "id": r["id"],
                    "code": r["code"],
                    "name": r["name"],
                    "enabled": bool(r["enabled"]),
                    "tenderCount": counts.get(r["code"], 0),
                    "lastScrapedAt": r["last_scraped_at"],
                }
                for r in rows
            ]

    def add_tracked(self, category_id: int, code: str, name: str) -> dict[str, Any]:
        with get_connection(self.db_path) as conn:
            conn.execute(
                """
                INSERT INTO tracked_categories (id, code, name, enabled)
                VALUES (?,?,?,1)
                ON CONFLICT(id) DO UPDATE SET code=excluded.code, name=excluded.name, enabled=1
                """,
                (category_id, code, name),
            )
            conn.execute(
                "INSERT OR IGNORE INTO cpv_categories (id, code, name) VALUES (?,?,?)",
                (category_id, code, name),
            )
        return next(c for c in self.list_tracked() if c["id"] == category_id)

    def remove_tracked(self, category_id: int) -> None:
        with get_connection(self.db_path) as conn:
            conn.execute("DELETE FROM tracked_categories WHERE id = ?", (category_id,))

    def claim_for_tracked_category(self, app_id: int, code: str, name: str) -> bool:
        """Move a stored tender onto `code` when its procuring CPV is not tracked.

        Unchanged listings skip a full upsert, so without this a backfill of a new
        tracked category would leave those rows tagged with the portal's displayed
        CPV (often a sibling code) and they would never appear in the explorer.
        """
        with get_connection(self.db_path) as conn:
            row = conn.execute(
                "SELECT category_code FROM tenders WHERE app_id = ?",
                (app_id,),
            ).fetchone()
            if not row:
                return False
            tracked = {
                r["code"]
                for r in conn.execute("SELECT code FROM tracked_categories WHERE enabled = 1")
            }
            current = row["category_code"] or ""
            if current in tracked:
                return False
            conn.execute(
                """
                UPDATE tenders
                SET category_code = ?, category_name = ?, updated_at = ?
                WHERE app_id = ?
                """,
                (code, name, now_iso(), app_id),
            )
            conn.execute(
                "INSERT OR IGNORE INTO tender_cpv_codes (app_id, code, name) VALUES (?,?,?)",
                (app_id, code, name),
            )
            return True

    def mark_scraped(self, category_id: int) -> None:
        with get_connection(self.db_path) as conn:
            conn.execute(
                "UPDATE tracked_categories SET last_scraped_at = ? WHERE id = ?",
                (now_iso(), category_id),
            )

    def start_run(
        self,
        mode: str,
        categories: list[str],
        categories_total: int | None = None,
        date_from: str | None = None,
        date_to: str | None = None,
        category_ids: list[int] | None = None,
        resumed_from: int | None = None,
    ) -> int:
        total = categories_total if categories_total is not None else len(categories)
        with get_connection(self.db_path) as conn:
            existing = conn.execute(
                "SELECT id FROM scrape_runs WHERE status = 'running' ORDER BY id DESC LIMIT 1"
            ).fetchone()
            if existing:
                raise ActiveScrapeError(
                    f"A scrape is already running (run {existing['id']}). Stop it first."
                )
            cur = conn.execute(
                """
                INSERT INTO scrape_runs (
                    started_at, status, mode, categories, tenders_found, tenders_upserted,
                    tenders_skipped, tenders_processed, progress_total, categories_done,
                    categories_total, current_category, date_from, date_to, category_ids,
                    resumed_from, errors
                )
                VALUES (?, 'running', ?, ?, 0, 0, 0, 0, 0, 0, ?, NULL, ?, ?, ?, ?, '[]')
                """,
                (
                    now_iso(),
                    mode,
                    json.dumps(categories),
                    total,
                    date_from,
                    date_to,
                    json.dumps(category_ids) if category_ids is not None else None,
                    resumed_from,
                ),
            )
            return int(cur.lastrowid)

    def update_run_progress(
        self,
        run_id: int,
        *,
        found: int | None = None,
        upserted: int | None = None,
        skipped: int | None = None,
        processed: int | None = None,
        progress_total: int | None = None,
        categories_done: int | None = None,
        categories_total: int | None = None,
        current_category: str | None = None,
    ) -> None:
        fields: list[str] = []
        values: list[Any] = []
        if found is not None:
            fields.append("tenders_found=?")
            values.append(found)
        if upserted is not None:
            fields.append("tenders_upserted=?")
            values.append(upserted)
        if skipped is not None:
            fields.append("tenders_skipped=?")
            values.append(skipped)
        if processed is not None:
            fields.append("tenders_processed=?")
            values.append(processed)
        if progress_total is not None:
            fields.append("progress_total=?")
            values.append(progress_total)
        if categories_done is not None:
            fields.append("categories_done=?")
            values.append(categories_done)
        if categories_total is not None:
            fields.append("categories_total=?")
            values.append(categories_total)
        if current_category is not None:
            fields.append("current_category=?")
            values.append(current_category)
        if not fields:
            return
        values.append(run_id)
        with get_connection(self.db_path) as conn:
            conn.execute(
                f"UPDATE scrape_runs SET {', '.join(fields)} WHERE id=?",
                values,
            )

    def finish_run(
        self,
        run_id: int,
        status: str,
        found: int,
        upserted: int,
        errors: list[str],
        skipped: int = 0,
        processed: int | None = None,
    ) -> None:
        with get_connection(self.db_path) as conn:
            # Don't overwrite a user-cancelled run with a late success/fail from the worker
            if status != "cancelled":
                row = conn.execute("SELECT status FROM scrape_runs WHERE id=?", (run_id,)).fetchone()
                if row and row["status"] == "cancelled":
                    return
            conn.execute(
                """
                UPDATE scrape_runs
                SET finished_at=?, status=?, tenders_found=?, tenders_upserted=?,
                    tenders_skipped=?, tenders_processed=?, current_category=NULL, errors=?
                WHERE id=?
                """,
                (
                    now_iso(),
                    status,
                    found,
                    upserted,
                    skipped,
                    upserted + skipped if processed is None else processed,
                    json.dumps(errors),
                    run_id,
                ),
            )

    def get_run_status(self, run_id: int) -> str | None:
        with get_connection(self.db_path) as conn:
            row = conn.execute("SELECT status FROM scrape_runs WHERE id=?", (run_id,)).fetchone()
            return row["status"] if row else None

    def cancel_run(self, run_id: int, found: int, upserted: int, errors: list[str]) -> dict[str, Any] | None:
        """Mark a run as cancelled. Returns the updated run or None if not found/not running."""
        with get_connection(self.db_path) as conn:
            row = conn.execute("SELECT * FROM scrape_runs WHERE id=?", (run_id,)).fetchone()
            if not row:
                return None
            if row["status"] != "running":
                return self._row_to_run(row)
            merged_errors = json.loads(row["errors"] or "[]")
            for err in errors:
                if err not in merged_errors:
                    merged_errors.append(err)
            conn.execute(
                """
                UPDATE scrape_runs
                SET finished_at=?, status='cancelled', tenders_found=?, tenders_upserted=?,
                    current_category=NULL, errors=?
                WHERE id=? AND status='running'
                """,
                (now_iso(), found, upserted, json.dumps(merged_errors), run_id),
            )
            updated = conn.execute("SELECT * FROM scrape_runs WHERE id=?", (run_id,)).fetchone()
            return self._row_to_run(updated) if updated else None

    @staticmethod
    def _row_to_run(r: Any) -> dict[str, Any]:
        keys = r.keys() if hasattr(r, "keys") else []
        found = r["tenders_found"] or 0
        progress_total = r["progress_total"] if "progress_total" in keys else 0
        progress_total = progress_total or 0
        categories_done = r["categories_done"] if "categories_done" in keys else 0
        categories_total = r["categories_total"] if "categories_total" in keys else 0
        categories_done = categories_done or 0
        categories_total = categories_total or 0
        # Progress tracks tenders actually dealt with (written or skipped as unchanged),
        # not the number seen in listings, which is known as soon as a page is parsed.
        processed = (r["tenders_processed"] if "tenders_processed" in keys else 0) or 0
        if progress_total > 0:
            percent = min(100, round(100 * processed / progress_total))
        elif categories_total > 0:
            percent = min(100, round(100 * categories_done / categories_total))
        else:
            percent = 0
        if r["status"] != "running":
            percent = 100 if r["status"] in ("success", "partial") else percent
        date_from = r["date_from"] if "date_from" in keys else None
        category_ids = r["category_ids"] if "category_ids" in keys else None
        return {
            "id": r["id"],
            "startedAt": r["started_at"],
            "finishedAt": r["finished_at"],
            "status": r["status"],
            "mode": r["mode"],
            "categories": json.loads(r["categories"] or "[]"),
            "tendersFound": found,
            "tendersUpserted": r["tenders_upserted"] or 0,
            "tendersSkipped": (r["tenders_skipped"] if "tenders_skipped" in keys else 0) or 0,
            "tendersProcessed": processed,
            "progressTotal": progress_total,
            "categoriesDone": categories_done,
            "categoriesTotal": categories_total,
            "currentCategory": r["current_category"] if "current_category" in keys else None,
            "progressPercent": percent,
            "dateFrom": date_from,
            "dateTo": r["date_to"] if "date_to" in keys else None,
            "categoryIds": json.loads(category_ids) if category_ids else None,
            "resumedFrom": r["resumed_from"] if "resumed_from" in keys else None,
            # An interrupted run can be picked up again; unchanged tenders are skipped
            # on the second pass, so resuming costs far less than the original run.
            "canResume": bool(date_from) and r["status"] in ("cancelled", "failed", "partial"),
            "errors": json.loads(r["errors"] or "[]"),
        }

    def get_run(self, run_id: int) -> dict[str, Any] | None:
        with get_connection(self.db_path) as conn:
            r = conn.execute("SELECT * FROM scrape_runs WHERE id=?", (run_id,)).fetchone()
            return self._row_to_run(r) if r else None

    def list_runs(self, limit: int = 50) -> list[dict[str, Any]]:
        with get_connection(self.db_path) as conn:
            rows = conn.execute(
                "SELECT * FROM scrape_runs ORDER BY id DESC LIMIT ?",
                (limit,),
            ).fetchall()
            return [self._row_to_run(r) for r in rows]

    def get_active_run(self) -> dict[str, Any] | None:
        with get_connection(self.db_path) as conn:
            r = conn.execute(
                "SELECT * FROM scrape_runs WHERE status = 'running' ORDER BY id DESC LIMIT 1"
            ).fetchone()
            return self._row_to_run(r) if r else None

    def fail_stale_running_runs(self, older_than_hours: float | None = None) -> list[int]:
        """Mark leftover ``running`` rows as failed if they are older than the threshold.

        FastAPI background scrapes die with the process, but the row stays
        ``running`` and blocks new work. A short threshold would also trip a
        still-running CLI backfill, so the default is 12 hours.
        """
        hours = config.STALE_RUN_HOURS if older_than_hours is None else older_than_hours
        cutoff = datetime.now(timezone.utc) - timedelta(hours=hours)
        failed: list[int] = []
        with get_connection(self.db_path) as conn:
            rows = conn.execute(
                "SELECT id, started_at, errors FROM scrape_runs WHERE status = 'running'"
            ).fetchall()
            for row in rows:
                started = datetime.fromisoformat(row["started_at"])
                if started.tzinfo is None:
                    started = started.replace(tzinfo=timezone.utc)
                if started > cutoff:
                    continue
                errors = json.loads(row["errors"] or "[]")
                note = (
                    f"Marked failed on startup: scrape left running for more than {hours:g} hours"
                )
                if note not in errors:
                    errors.append(note)
                conn.execute(
                    """
                    UPDATE scrape_runs
                    SET finished_at=?, status='failed', current_category=NULL, errors=?
                    WHERE id=? AND status='running'
                    """,
                    (now_iso(), json.dumps(errors), row["id"]),
                )
                failed.append(int(row["id"]))
        return failed

    def latest_raw_html_by_app(self) -> dict[int, dict[str, str]]:
        """Newest stored HTML fragment for each (app_id, kind) pair."""
        with get_connection(self.db_path) as conn:
            rows = conn.execute(
                """
                SELECT r.app_id, r.kind, r.html
                FROM raw_html r
                INNER JOIN (
                    SELECT app_id, kind, MAX(id) AS max_id
                    FROM raw_html
                    WHERE app_id IS NOT NULL
                    GROUP BY app_id, kind
                ) latest ON latest.max_id = r.id
                """
            ).fetchall()
        out: dict[int, dict[str, str]] = {}
        for row in rows:
            out.setdefault(int(row["app_id"]), {})[row["kind"]] = row["html"]
        return out

    def get_tender_key(self, app_id: int) -> str | None:
        with get_connection(self.db_path) as conn:
            row = conn.execute("SELECT key FROM tenders WHERE app_id=?", (app_id,)).fetchone()
            return row["key"] if row else None

    def prune_raw_html(self, older_than_days: int, apply: bool = False) -> dict[str, int]:
        cutoff = f"-{int(older_than_days)} days"
        with get_connection(self.db_path) as conn:
            row = conn.execute(
                """
                SELECT COUNT(*) AS c, COALESCE(SUM(LENGTH(html)), 0) AS bytes
                FROM raw_html
                WHERE datetime(fetched_at) < datetime('now', ?)
                """,
                (cutoff,),
            ).fetchone()
            deleted = 0
            if apply and row["c"]:
                cur = conn.execute(
                    "DELETE FROM raw_html WHERE datetime(fetched_at) < datetime('now', ?)",
                    (cutoff,),
                )
                deleted = int(cur.rowcount)
            return {
                "matching": int(row["c"]),
                "bytes": int(row["bytes"]),
                "deleted": deleted,
            }

    def upsert_cpv_categories(self, categories: list[tuple[int, str, str]]) -> None:
        """Replace the CPV list and move tracked rows onto the portal's current ids.

        Portal option values are not stable across codes. Insert-or-replace by id
        would violate ``code`` uniqueness when two rows swap, so the table is
        rebuilt. Tracked categories keep their code and follow the new id.
        """
        by_code = {code: (cid, name) for cid, code, name in categories}
        with get_connection(self.db_path) as conn:
            conn.execute("DELETE FROM cpv_categories")
            conn.executemany(
                "INSERT INTO cpv_categories (id, code, name) VALUES (?,?,?)",
                categories,
            )
            tracked = conn.execute(
                "SELECT id, code, name, enabled, last_scraped_at FROM tracked_categories"
            ).fetchall()
            for row in tracked:
                canon = by_code.get(row["code"])
                if not canon:
                    continue
                new_id, new_name = canon
                if new_id == row["id"] and new_name == row["name"]:
                    continue
                conn.execute(
                    "UPDATE tracked_categories SET id = ?, name = ? WHERE id = ?",
                    (-row["id"], new_name, row["id"]),
                )
            for row in tracked:
                canon = by_code.get(row["code"])
                if not canon:
                    continue
                new_id, new_name = canon
                if new_id == row["id"] and new_name == row["name"]:
                    continue
                conn.execute(
                    "UPDATE tracked_categories SET id = ?, name = ? WHERE id = ?",
                    (new_id, new_name, -row["id"]),
                )

    def all_cpv_categories(self) -> list[dict[str, Any]]:
        with get_connection(self.db_path) as conn:
            rows = conn.execute("SELECT id, code, name FROM cpv_categories ORDER BY code").fetchall()
            return [{"id": r["id"], "code": r["code"], "name": r["name"]} for r in rows]

    def get_cpv(self, category_id: int) -> dict[str, Any] | None:
        with get_connection(self.db_path) as conn:
            r = conn.execute("SELECT id, code, name FROM cpv_categories WHERE id=?", (category_id,)).fetchone()
            if not r:
                return None
            return {"id": r["id"], "code": r["code"], "name": r["name"]}
