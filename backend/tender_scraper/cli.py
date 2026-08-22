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
from tender_scraper.reparse import reparse_from_raw
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

    p_serve = sub.add_parser("serve", help="Start the app (API + built UI)")
    p_serve.add_argument("--host", default=config.API_HOST)
    p_serve.add_argument("--port", type=int, default=config.API_PORT)

    p_reparse = sub.add_parser(
        "reparse",
        help="Re-run parsers on stored raw_html (dry-run unless --apply)",
    )
    p_reparse.add_argument(
        "--apply",
        action="store_true",
        help="Write re-parsed fields back to tenders. Default is a count-only dry-run.",
    )

    p_prune = sub.add_parser(
        "prune-raw",
        help="Count or delete raw_html rows older than N days (dry-run unless --apply)",
    )
    p_prune.add_argument("--days", type=int, default=30, help="Delete rows older than this many days")
    p_prune.add_argument(
        "--apply",
        action="store_true",
        help="Actually delete matching rows. Default is a count-only dry-run.",
    )

    p_specs = sub.add_parser(
        "extract-specs",
        help="Download ტექნიკური attachments and store searchable text (existing tenders)",
    )
    p_specs.add_argument("--limit", type=int, default=None, help="Max tenders to process")
    p_specs.add_argument(
        "--force",
        action="store_true",
        help="Re-parse every tender with a ტექნიკური attachment, not just the ones never attempted",
    )

    args = parser.parse_args(argv)
    config.ensure_dirs()
    from tender_scraper.settings import apply_to_config

    apply_to_config()
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
        handlers=[
            logging.StreamHandler(),
            logging.FileHandler(config.LOG_DIR / "scraper.log", encoding="utf-8"),
        ],
    )

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

    if args.cmd == "reparse":
        init_db()
        result = reparse_from_raw(apply=args.apply)
        mode = "updated" if args.apply else "would update"
        print(
            f"Reparse {mode} {result['updated']} tenders "
            f"(skipped {result['skipped']} without app_main; "
            f"{result['appsSeen']} apps in raw_html)"
        )
        return 0

    if args.cmd == "prune-raw":
        init_db()
        result = Repository().prune_raw_html(args.days, apply=args.apply)
        mb = result["bytes"] / (1024 * 1024)
        if args.apply:
            print(f"Deleted {result['deleted']} raw_html rows older than {args.days} days ({mb:.1f} MB)")
        else:
            print(
                f"Would delete {result['matching']} raw_html rows older than {args.days} days "
                f"({mb:.1f} MB). Re-run with --apply to delete."
            )
        return 0

    if args.cmd == "extract-specs":
        init_db()
        result = ScrapePipeline().extract_missing_specs(limit=args.limit, force=args.force)
        print(
            f"Extracted spec text for {result['withText']} tenders "
            f"({result['empty']} with no usable text, {result['errors']} errors, "
            f"{result['attempted']} attempted)"
        )
        return 0 if result["errors"] == 0 else 1

    return 1


if __name__ == "__main__":
    raise SystemExit(main())
