"""CLI entry points for scraping."""

from __future__ import annotations

import argparse
import logging
import sys
from datetime import date, timedelta
from pathlib import Path

# Allow running as `python -m tender_scraper.cli` from backend/
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from tender_scraper import config
from tender_scraper.cpv_seed import seed_cpv_categories
from tender_scraper.db import init_db
from tender_scraper.pipeline import ScrapePipeline, run_backfill, run_daily
from tender_scraper.repository import Repository


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Georgian SPA tender scraper")
    sub = parser.add_subparsers(dest="cmd", required=True)

    p_init = sub.add_parser("init-db", help="Create database and seed categories")
    p_daily = sub.add_parser("daily", help="Run daily incremental scrape")
    p_daily.add_argument("--lookback", type=int, default=None)

    p_backfill = sub.add_parser("backfill", help="Backfill historical tenders")
    p_backfill.add_argument("--days", type=int, default=365)
    p_backfill.add_argument("--category-id", type=int, action="append", default=None)
    p_backfill.add_argument("--max-pages", type=int, default=None, help="Limit pages per category (debug)")

    p_serve = sub.add_parser("serve", help="Start the API server")
    p_serve.add_argument("--host", default=config.API_HOST)
    p_serve.add_argument("--port", type=int, default=config.API_PORT)

    args = parser.parse_args(argv)
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
        handlers=[
            logging.StreamHandler(),
            logging.FileHandler(config.LOG_DIR / "scraper.log", encoding="utf-8"),
        ],
    )
    config.ensure_dirs()

    if args.cmd == "init-db":
        init_db()
        n = seed_cpv_categories()
        print(f"Database ready at {config.DB_PATH}; seeded {n} CPV categories")
        return 0

    if args.cmd == "daily":
        init_db()
        result = run_daily(lookback_days=args.lookback)
        print(result)
        return 0 if result["status"] != "failed" else 1

    if args.cmd == "backfill":
        init_db()
        seed_cpv_categories()
        pipeline = ScrapePipeline()
        today = date.today()
        result = pipeline.run(
            date_from=today - timedelta(days=args.days),
            date_to=today,
            mode="backfill",
            category_ids=args.category_id,
            max_pages=args.max_pages,
        )
        print(result)
        return 0 if result["status"] != "failed" else 1

    if args.cmd == "serve":
        import uvicorn

        init_db()
        seed_cpv_categories()
        uvicorn.run("tender_scraper.api:app", host=args.host, port=args.port, reload=False)
        return 0

    return 1


if __name__ == "__main__":
    raise SystemExit(main())
