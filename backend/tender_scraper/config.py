"""Configuration for the tender scraper and API."""

from __future__ import annotations

import os
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = Path(os.environ.get("TENDER_DATA_DIR", PROJECT_ROOT / "data"))
DB_PATH = Path(os.environ.get("TENDER_DB_PATH", DATA_DIR / "tenders.db"))
LOG_DIR = Path(os.environ.get("TENDER_LOG_DIR", DATA_DIR / "logs"))

BASE_URL = "https://tenders.procurement.gov.ge/public/"
CONTROLLER_URL = BASE_URL + "library/controller.php"

QEP_CONTROLLER_URL = BASE_URL + "library/qep/qep_controller.php"

# The site paginates search results four rows at a time and offers no page-size
# parameter, so request volume is driven almost entirely by the date window.
RESULTS_PER_PAGE = 4

# Politeness settings. The site is a small government server with no public API,
# so we stay well below the request rate a human browsing the site would produce.
REQUEST_DELAY_SECONDS = float(os.environ.get("TENDER_REQUEST_DELAY", "1.0"))
REQUEST_TIMEOUT_SECONDS = float(os.environ.get("TENDER_REQUEST_TIMEOUT", "60"))
MAX_RETRIES = int(os.environ.get("TENDER_MAX_RETRIES", "4"))
RETRY_BACKOFF_SECONDS = 5.0
# Cap how long a single failing request may spend sleeping between retries.
RETRY_BACKOFF_MAX_SECONDS = float(os.environ.get("TENDER_RETRY_BACKOFF_MAX", "15"))

# Detail tabs are fetched through a pool of independent sessions. MAX_REQUESTS_PER_SECOND
# is the politeness budget for the whole process; SCRAPE_CONCURRENCY only decides how many
# requests may be in flight at once to hide the portal's latency underneath that budget.
# Set MAX_REQUESTS_PER_SECOND=1 and SCRAPE_CONCURRENCY=1 to restore the old serial behaviour.
MAX_REQUESTS_PER_SECOND = float(os.environ.get("TENDER_MAX_RPS", "2.0"))
SCRAPE_CONCURRENCY = max(1, int(os.environ.get("TENDER_SCRAPE_CONCURRENCY", "4")))

# Statuses that mean the award stage is reached, so agency result documents may exist.
AWARDED_STATUSES = {
    "Winner identified",
    "Contract awarded",
    "Contract not awarded",
    "Terminated",
    "Did not take place",
}

USER_AGENT = os.environ.get(
    "TENDER_USER_AGENT",
    "TenderDashboardBot/1.0 (+daily public procurement archival; contact: admin@example.com)",
)

# How many days of history the backfill loads when no explicit range is given.
DEFAULT_BACKFILL_DAYS = int(os.environ.get("TENDER_BACKFILL_DAYS", "365"))

# The daily run re-checks a short trailing window rather than only "today", so
# that tenders whose status changed after announcement get refreshed too.
DAILY_LOOKBACK_DAYS = int(os.environ.get("TENDER_DAILY_LOOKBACK_DAYS", "3"))

API_HOST = os.environ.get("TENDER_API_HOST", "127.0.0.1")
API_PORT = int(os.environ.get("TENDER_API_PORT", "8000"))
FRONTEND_DIR = Path(os.environ.get("TENDER_FRONTEND_DIR", PROJECT_ROOT / "frontend" / "dist"))

# Running rows older than this are treated as leftovers from a dead process.
# A live backfill is 45–90 minutes; 12 hours stays well clear of that.
STALE_RUN_HOURS = float(os.environ.get("TENDER_STALE_RUN_HOURS", "12"))


def ensure_dirs() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
