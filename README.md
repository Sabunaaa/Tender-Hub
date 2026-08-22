# Tender Dashboard — Georgian Public Procurement

Full-stack app that scrapes tenders from [tenders.procurement.gov.ge](https://tenders.procurement.gov.ge/public/) for selected CPV categories and serves a filterable dashboard.

**Default tracked categories**

| CPV | Name |
|-----|------|
| 30200000 | Computer equipment and supplies |
| 32400000 | Networks |
| 32500000 | Telecommunications equipment and supplies |

Categories are manageable from the web UI (`/categories`).

## Stack

- **Frontend:** Vite + React + TypeScript + Tailwind + Recharts
- **Backend:** FastAPI + SQLite
- **Scraper:** httpx + BeautifulSoup (no browser automation)
- **Schedule:** Windows Task Scheduler (daily)

## Quick start

### 1. Backend setup

```powershell
cd "C:\Users\s84404579\Pictures\Tender Scraper"
py -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r backend\requirements.txt

$env:PYTHONPATH = "$PWD\backend"
.\.venv\Scripts\python.exe -m tender_scraper.cli init-db
.\.venv\Scripts\python.exe backend\scripts\seed_cpv_from_portal.py
```

### 2. Scrape data (one-year backfill)

~744 tenders across the three categories; polite rate limit ≈ 1 req/s → roughly **45–90 minutes**.

```powershell
$env:PYTHONPATH = "$PWD\backend"
.\.venv\Scripts\python.exe -m tender_scraper.cli backfill --days 365
```

Daily incremental (last 3 days, refreshes status changes):

```powershell
.\.venv\Scripts\python.exe -m tender_scraper.cli daily
```

Existing tenders skip the docs tab on later runs. To fill searchable text from `ტექნიკური` attachments already stored in the DB (no full backfill):

```powershell
$env:PYTHONPATH = "$PWD\backend"
.\.venv\Scripts\python.exe -m tender_scraper.cli extract-specs
```

New scrapes do this automatically when they fetch the docs tab.

### 3. Build the UI and start the app (one URL)

```powershell
cd frontend
npm install
npm run build
cd ..

$env:PYTHONPATH = "$PWD\backend"
.\.venv\Scripts\python.exe -m tender_scraper.cli serve
```

Open **http://127.0.0.1:8000** — FastAPI serves the API and the React app together.

For local UI development with hot reload, run `scripts\dev.bat` instead (API on :8000, Vite on :5173).

### 4. Schedule scrapes

Open **Settings** in the UI (`/settings`) and pick any days and one or more times of day (up to 6 — add a second time to scrape twice daily). Saving creates or updates the Windows task `TenderDashboardDailyScrape`, which gets one trigger per configured time. You can also turn the schedule off there, or run a scrape immediately.

From a shell:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\register_task.ps1 -Times "06:00,18:30" -Days "Monday,Wednesday,Friday"
```

The task uses “start when available” so a missed run catches up after reboot.

On non-Windows hosts there is no Task Scheduler, so the API process runs the schedule itself: a background thread checks the clock every 30 seconds and starts the daily scrape when a configured time comes due. The same settings drive both, and a run is skipped if another one is already active.

## Frontend data mode

`frontend/.env`:

- `VITE_USE_MOCK=true` — demo fixtures (~150 fake tenders), no backend needed
- `VITE_USE_MOCK=false` — live API (default)

Vite proxies `/api` → `http://127.0.0.1:8000` during `npm run dev`. After `npm run build`, the same origin serves both.

## Pages

| Route | Purpose |
|-------|---------|
| `/` | Dashboard KPIs, charts, closing soon |
| `/tenders` | Multi-filter explorer (URL-synced) |
| `/tenders/:id` | Full detail, docs, bids, chronology |
| `/categories` | Add/remove tracked CPV categories, trigger backfill |
| `/runs` | Scrape health / run history |
| `/settings` | Schedule, scraper politeness, dashboard defaults |

## Project layout

```
backend/tender_scraper/   # client, parsers, pipeline, API, DB
frontend/src/             # React app
data/tenders.db           # SQLite database
data/logs/                # Scraper logs
scripts/                  # Task registration + dev helpers
```

## Notes

- The portal has **no public JSON API**; we call the same PHP controller the website uses and parse HTML.
- `robots.txt` is `Disallow: /`. Data is public procurement; scrape politely and for archival/monitoring use only.
- Free-text fields (titles, specs) are often Georgian; structured fields (status, type, buyer) are requested in English (`?lang=en`).
- Raw HTML snippets are stored in `raw_html` so parsers can be re-run without re-scraping if the portal markup changes.

## Troubleshooting

| Issue | Fix |
|-------|-----|
| Empty dashboard | Run `backfill` then restart API |
| Frontend API errors | Ensure the app is on port 8000 (`cli serve`) and you built with `VITE_USE_MOCK=false` |
| Scrape timeouts | Increase `TENDER_REQUEST_TIMEOUT`; check network |
| Task did not run | `Get-ScheduledTaskInfo -TaskName TenderDashboardDailyScrape` |
