"""Tracked Huawei engagement rows, joined to scraped tender details."""

from __future__ import annotations

from typing import Any

from .db import get_connection
from .repository import now_iso

# Huawei Enterprise ICT product lines used as engagement domains.
HUAWEI_ENTERPRISE_DOMAINS = (
    "Storage",
    "IdeaHub",
    "Datacom",
    "DWDM",
    "Optical",
    "WLAN",
    "Security",
    "Computing",
    "Cloud",
    "Intelligent Vision",
    "Private Wireless",
)


class EngagementError(ValueError):
    """User-facing engagement failure (unknown code, duplicate, missing row)."""


def _normalize_domain(value: str | None) -> str:
    token = (value or "").strip()
    if not token:
        return ""
    for name in HUAWEI_ENTERPRISE_DOMAINS:
        if name.casefold() == token.casefold():
            return name
    raise EngagementError(f"Unknown domain “{token}”.")


def _row(r) -> dict[str, Any]:
    return {
        "id": r["id"],
        "announcementNumber": r["announcement_number"],
        "appId": r["app_id"],
        "engaged": bool(r["engaged"]),
        "accountManager": r["account_manager"] or "",
        "solutionManager": r["solution_manager"] or "",
        "domain": r["domain"] or "",
        "title": r["title"] or "",
        "buyer": r["buyer"] or "",
        "status": r["status"] or "",
        "categoryName": r["category_name"] or "",
        "announcementDate": r["announcement_date"],
        "bidDeadline": r["bid_deadline"],
        "estimatedValue": r["estimated_value"],
        "currency": r["currency"] or "GEL",
        "bidderCount": r["bidder_count"] or 0,
        "createdAt": r["created_at"],
        "updatedAt": r["updated_at"],
    }


_SELECT = """
    SELECT e.id, e.announcement_number, e.app_id, e.engaged, e.account_manager, e.solution_manager,
           e.domain, e.created_at, e.updated_at,
           t.title, t.buyer, t.status, t.category_name, t.announcement_date, t.bid_deadline,
           t.estimated_value, t.currency, t.bidder_count
    FROM engagements e
    LEFT JOIN tenders t ON t.app_id = e.app_id
"""


def list_engagements(db_path=None) -> list[dict[str, Any]]:
    with get_connection(db_path) as conn:
        rows = conn.execute(_SELECT + " ORDER BY e.created_at DESC, e.id DESC").fetchall()
    return [_row(r) for r in rows]


def _find_tender(conn, code: str):
    token = code.strip()
    if not token:
        return None
    row = conn.execute(
        "SELECT app_id, announcement_number FROM tenders WHERE announcement_number = ? COLLATE NOCASE",
        (token,),
    ).fetchone()
    if row:
        return row
    if token.isdigit():
        return conn.execute(
            "SELECT app_id, announcement_number FROM tenders WHERE app_id = ?",
            (int(token),),
        ).fetchone()
    return None


def add_engagement(code: str, db_path=None) -> dict[str, Any]:
    token = (code or "").strip()
    if not token:
        raise EngagementError("Enter an announcement number.")
    with get_connection(db_path) as conn:
        tender = _find_tender(conn, token)
        if not tender:
            raise EngagementError(f"No scraped tender matches announcement number “{token}”.")
        existing = conn.execute(
            "SELECT id FROM engagements WHERE announcement_number = ? COLLATE NOCASE",
            (tender["announcement_number"],),
        ).fetchone()
        if existing:
            raise EngagementError("That tender is already on the engagement list.")
        stamp = now_iso()
        conn.execute(
            """
            INSERT INTO engagements (
                announcement_number, app_id, engaged, account_manager, solution_manager, domain,
                created_at, updated_at
            ) VALUES (?, ?, 0, '', '', '', ?, ?)
            """,
            (tender["announcement_number"], tender["app_id"], stamp, stamp),
        )
        new_id = conn.execute("SELECT last_insert_rowid() AS id").fetchone()["id"]
        row = conn.execute(_SELECT + " WHERE e.id = ?", (new_id,)).fetchone()
    return _row(row)


def update_engagement(engagement_id: int, patch: dict[str, Any], db_path=None) -> dict[str, Any]:
    with get_connection(db_path) as conn:
        current = conn.execute("SELECT id FROM engagements WHERE id = ?", (engagement_id,)).fetchone()
        if not current:
            raise EngagementError("Engagement not found.")
        fields: list[str] = []
        params: list[Any] = []
        if "engaged" in patch and patch["engaged"] is not None:
            fields.append("engaged = ?")
            params.append(1 if patch["engaged"] else 0)
        if "accountManager" in patch:
            fields.append("account_manager = ?")
            params.append((patch["accountManager"] or "").strip()[:80])
        if "solutionManager" in patch:
            fields.append("solution_manager = ?")
            params.append((patch["solutionManager"] or "").strip()[:80])
        if "domain" in patch:
            fields.append("domain = ?")
            params.append(_normalize_domain(patch["domain"]))
        if fields:
            fields.append("updated_at = ?")
            params.append(now_iso())
            params.append(engagement_id)
            conn.execute(f"UPDATE engagements SET {', '.join(fields)} WHERE id = ?", params)
        row = conn.execute(_SELECT + " WHERE e.id = ?", (engagement_id,)).fetchone()
    return _row(row)


def delete_engagement(engagement_id: int, db_path=None) -> None:
    with get_connection(db_path) as conn:
        cur = conn.execute("DELETE FROM engagements WHERE id = ?", (engagement_id,))
        if cur.rowcount == 0:
            raise EngagementError("Engagement not found.")
