"""Developer helper: save live HTML samples for parser development."""

import logging
import re
import sys
from datetime import date, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from tender_scraper.client import TenderPortalClient  # noqa: E402

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")

out = Path(__file__).resolve().parents[1] / "data" / "samples"
out.mkdir(parents=True, exist_ok=True)

today = date.today()
with TenderPortalClient(delay=1.0) as client:
    listing = client.search(date_from=today - timedelta(days=2), date_to=today)
    (out / "listing.html").write_text(listing, encoding="utf-8")

    page2 = client.get_page(2)
    (out / "listing_page2.html").write_text(page2, encoding="utf-8")

    rows = re.findall(r"ShowApp\((\d+),'([^']*)',(\d+),'([^']+)'\)", listing)
    print("rows found:", len(rows))
    for idx, (app_id, _reg, _tab, key) in enumerate(rows[:3]):
        tabs = client.get_available_tabs(int(app_id), key)
        (out / f"tabs_{app_id}.html").write_text(tabs, encoding="utf-8")
        for tab in ("app_main", "app_docs", "app_bids", "agency_docs"):
            html = client.get_tab(tab, int(app_id), key)
            (out / f"{tab}_{app_id}.html").write_text(html, encoding="utf-8")
        print("saved", app_id)
        if idx == 0:
            print(tabs[:400])
