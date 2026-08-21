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

### 3. Start API

```powershell
$env:PYTHONPATH = "$PWD\backend"
.\.venv\Scripts\python.exe -m tender_scraper.cli serve
```

API: http://127.0.0.1:8000 — docs at `/docs`

### 4. Start frontend

```powershell
cd frontend
npm install
npm run dev
```

UI: http://127.0.0.1:5173

Or run both via `scripts\dev.bat`.

### 5. Register daily schedule

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\register_task.ps1 -Time 06:00
```

This creates task `TenderDashboardDailyScrape` with “start when available” so a missed run catches up after reboot.

## Frontend data mode

`frontend/.env`:

- `VITE_USE_MOCK=true` — demo fixtures (~150 fake tenders), no backend needed
- `VITE_USE_MOCK=false` — live API (default)

Vite proxies `/api` → `http://127.0.0.1:8000`.

## Pages

| Route | Purpose |
|-------|---------|
| `/` | Dashboard KPIs, charts, closing soon |
| `/tenders` | Multi-filter explorer (URL-synced) |
| `/tenders/:id` | Full detail, docs, bids, chronology |
| `/categories` | Add/remove tracked CPV categories, trigger backfill |
| `/runs` | Scrape health / run history |

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
| Frontend API errors | Ensure API is on port 8000 and `VITE_USE_MOCK=false` |
| Scrape timeouts | Increase `TENDER_REQUEST_TIMEOUT`; check network |
| Task did not run | `Get-ScheduledTaskInfo -TaskName TenderDashboardDailyScrape` |
