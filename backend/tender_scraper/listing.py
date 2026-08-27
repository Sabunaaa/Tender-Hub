"""Tender vs market-research (MRS) listing identity.

Portal tender IDs and QEP/MRS IDs overlap (the same integer can be SPA-1300… and
an MRS row). SQLite keeps a single ``tenders.app_id`` primary key, so MRS rows
are stored at ``portal_id + MRS_APP_ID_OFFSET``. The API always speaks portal IDs.
"""

from __future__ import annotations

KIND_TENDER = "tender"
KIND_MRS = "mrs"
MRS_APP_ID_OFFSET = 1_000_000_000


def normalize_kind(value: object | None) -> str:
    token = str(value or KIND_TENDER).strip().lower()
    return KIND_MRS if token == KIND_MRS else KIND_TENDER


def store_app_id(kind: str, portal_id: int) -> int:
    if normalize_kind(kind) == KIND_MRS:
        return int(portal_id) + MRS_APP_ID_OFFSET
    return int(portal_id)


def public_app_id(kind: str, stored_id: int) -> int:
    stored = int(stored_id)
    if normalize_kind(kind) == KIND_MRS and stored >= MRS_APP_ID_OFFSET:
        return stored - MRS_APP_ID_OFFSET
    return stored
