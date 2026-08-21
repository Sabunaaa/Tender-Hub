"""Developer helper: sample an older, completed tender that has bids and results."""

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
    # Search a window from several months back so the tenders have run their course.
    listing = client.search(
        date_from=today - timedelta(days=200),
        date_to=today - timedelta(days=190),
    )
    (out / "listing_old.html").write_text(listing, encoding="utf-8")

    rows = re.findall(r"ShowApp\((\d+),'([^']*)',(\d+),'([^']+)'\)", listing)
    print("rows:", len(rows))
    for app_id, _reg, _tab, key in rows[:2]:
        for tab in ("app_main", "app_bids", "agency_docs"):
            html = client.get_tab(tab, int(app_id), key)
            (out / f"old_{tab}_{app_id}.html").write_text(html, encoding="utf-8")
        hist = client._request(
            "GET",
            "https://tenders.procurement.gov.ge/public/library/controller.php",
            params={"action": "app_statushistory", "app_id": int(app_id)},
        )
        (out / f"old_statushistory_{app_id}.html").write_text(hist, encoding="utf-8")
        print("saved", app_id)
