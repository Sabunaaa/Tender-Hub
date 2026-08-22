"""Device-keyword filters for the tender explorer.

Chips target gear Huawei Enterprise can bid on. Portal text is Georgian, so
aliases are Georgian stems, plus a few Latin tokens that actually appear in
specs (firewall, NAS). Selected chips are OR'd: Switch + Router shows either.
"""

from __future__ import annotations

from typing import Any

# Short stems so Georgian suffixes still match (კომუტატორი, კომუტატორები).
KEYWORD_ALIASES: dict[str, tuple[str, ...]] = {
    "storage": (
        "სტორიჯ",
        "მონაცემთა საცავ",
        "დისკური მასივ",
    ),
    "switch": (
        "კომუტატორ",
        "სვიჩ",
        "აქტიური ქსელ",
        "ქსელური ინფრასტრუქტ",
    ),
    "router": ("მარშრუტიზატორ", "sd-wan", "sdwan"),
    "firewall": ("ფაიერვოლ", "ფაირვოლ", "ბრანდმაუერ", "firewall", "ngfw"),
    "wifi": ("წვდომის წერტილ", "დაშვების წერტილ"),
    "screen": ("სმარტ ეკრან", "ინტერაქტიული ეკრან", "ideahub"),
}

_MAX_KEYWORDS = 12


def _clean_term(raw: str) -> str:
    return raw.strip().replace("%", "").replace("_", "")[:80]


def expand_terms(keywords: list[str] | None) -> list[str]:
    if not keywords:
        return []
    seen: set[str] = set()
    terms: list[str] = []
    for raw in keywords[:_MAX_KEYWORDS]:
        key = _clean_term(raw)
        if not key:
            continue
        aliases = KEYWORD_ALIASES.get(key.lower(), (key,))
        for alias in aliases:
            token = alias.lower()
            if token in seen:
                continue
            seen.add(token)
            terms.append(alias)
    return terms


def keyword_clause(keywords: list[str] | None) -> tuple[str, list[Any]]:
    terms = expand_terms(keywords)
    if not terms:
        return "", []
    field = """(
        title LIKE ? OR description LIKE ? OR additional_info LIKE ?
        OR amount_or_volume LIKE ? OR spec_text LIKE ?
        OR app_id IN (
            SELECT app_id FROM tender_document_sections
            WHERE body LIKE ? OR title LIKE ?
        )
    )"""
    parts: list[str] = []
    params: list[Any] = []
    for term in terms:
        like = f"%{term}%"
        parts.append(field)
        params.extend([like] * 7)
    return "(" + " OR ".join(parts) + ")", params
