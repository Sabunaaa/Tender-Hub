"""Re-run parsers against stored raw_html. Opt-in; writes only with --apply."""

from __future__ import annotations

from typing import Any

from .parsers import parse_agency_docs, parse_bids_tab, parse_docs_tab, parse_main_tab, parse_status_history
from .repository import ALL_TENDER_PARTS, Repository

KIND_TO_PART = {
    "app_main": "main",
    "app_docs": "docs",
    "app_bids": "bids",
    "agency_docs": "results",
}


def reparse_from_raw(repo: Repository | None = None, apply: bool = False) -> dict[str, Any]:
    repo = repo or Repository()
    latest = repo.latest_raw_html_by_app()
    updated = 0
    skipped = 0
    for app_id, kinds in latest.items():
        main_html = kinds.get("app_main")
        if not main_html:
            skipped += 1
            continue
        key = repo.get_tender_key(app_id) or ""
        tender = parse_main_tab(main_html, app_id, key)
        parts: set[str] = {"main"}
        if "app_docs" in kinds:
            sections, attachments = parse_docs_tab(kinds["app_docs"])
            tender.document_sections = sections
            tender.attachments = attachments
            parts.add("docs")
        if "app_bids" in kinds:
            tender.bids = parse_bids_tab(kinds["app_bids"])
            parts.add("bids")
        if "agency_docs" in kinds:
            tender.result_documents = parse_agency_docs(kinds["agency_docs"])
            parts.add("results")
        if "statushistory" in kinds:
            tender.status_history = parse_status_history(kinds["statushistory"])
        if apply:
            repo.upsert_tender(tender, replace=parts & ALL_TENDER_PARTS)
        updated += 1
    return {
        "apply": apply,
        "updated": updated,
        "skipped": skipped,
        "appsSeen": len(latest),
    }
