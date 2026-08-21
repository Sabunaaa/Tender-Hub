"""Expand CPV seed by parsing option list from the portal homepage."""

from __future__ import annotations

import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import httpx

from tender_scraper.db import init_db
from tender_scraper.repository import Repository

PATTERN = re.compile(r'<option value="(\d+)">(\d{8})\s*-\s*([^<]+)</option>')


def main() -> None:
    init_db()
    html = httpx.get("https://tenders.procurement.gov.ge/public/?lang=en", timeout=60).text
    cats = [(int(i), code, name.strip()) for i, code, name in PATTERN.findall(html)]
    by_id = {c[0]: c for c in cats}
    repo = Repository()
    repo.upsert_cpv_categories(list(by_id.values()))
    print(f"Seeded {len(by_id)} CPV categories from portal")


if __name__ == "__main__":
    main()
