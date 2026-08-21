"""FastAPI application for the Tender Dashboard."""

from __future__ import annotations

import logging
from datetime import date, timedelta
from pathlib import Path
from typing import Annotated

from fastapi import BackgroundTasks, FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from tender_scraper import config
from tender_scraper.cancel import request_stop
from tender_scraper.cpv_seed import seed_cpv_categories
from tender_scraper.db import init_db
from tender_scraper.pipeline import ScrapePipeline, run_backfill
from tender_scraper.queries import filter_options, get_stats, get_tender, list_tenders
from tender_scraper.repository import Repository

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)

app = FastAPI(title="Tender Dashboard API", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

repo = Repository()


@app.on_event("startup")
def on_startup() -> None:
    config.ensure_dirs()
    init_db()
    seed_cpv_categories(repo)


class AddCategoryBody(BaseModel):
    categoryId: int


class BackfillBody(BaseModel):
    dateFrom: date | None = None
    days: int | None = None


@app.get("/api/health")
def health():
    return {"ok": True, "db": str(config.DB_PATH)}


@app.get("/api/stats")
def stats():
    return get_stats()


@app.get("/api/tenders")
def tenders(
    q: str | None = None,
    categoryCodes: Annotated[list[str] | None, Query()] = None,
    cpvCode: str | None = None,
    status: Annotated[list[str] | None, Query()] = None,
    procurementType: Annotated[list[str] | None, Query()] = None,
    buyer: str | None = None,
    dateFrom: str | None = None,
    dateTo: str | None = None,
    deadlineFrom: str | None = None,
    deadlineTo: str | None = None,
    withinDeadline: bool = False,
    amountFrom: float | None = None,
    amountTo: float | None = None,
    bidderCountMin: int | None = None,
    bidderCountMax: int | None = None,
    page: int = 1,
    pageSize: int = 20,
    sortBy: str = "announcementDate",
    sortDir: str = "desc",
):
    return list_tenders(
        {
            "q": q,
            "categoryCodes": categoryCodes,
            "cpvCode": cpvCode,
            "status": status,
            "procurementType": procurementType,
            "buyer": buyer,
            "dateFrom": dateFrom,
            "dateTo": dateTo,
            "deadlineFrom": deadlineFrom,
            "deadlineTo": deadlineTo,
            "withinDeadline": withinDeadline,
            "amountFrom": amountFrom,
            "amountTo": amountTo,
            "bidderCountMin": bidderCountMin,
            "bidderCountMax": bidderCountMax,
            "page": page,
            "pageSize": pageSize,
            "sortBy": sortBy,
            "sortDir": sortDir,
        }
    )


@app.get("/api/tenders/{app_id}")
def tender_detail(app_id: int):
    data = get_tender(app_id)
    if not data:
        raise HTTPException(404, "Tender not found")
    return data


@app.get("/api/filters/options")
def options():
    return filter_options(repo)


@app.get("/api/categories")
def categories():
    return repo.list_tracked()


@app.get("/api/categories/all")
def all_categories():
    return repo.all_cpv_categories()


@app.post("/api/categories")
def add_category(body: AddCategoryBody):
    cat = repo.get_cpv(body.categoryId)
    if not cat:
        raise HTTPException(404, "Unknown CPV category")
    return repo.add_tracked(cat["id"], cat["code"], cat["name"])


@app.delete("/api/categories/{category_id}")
def remove_category(category_id: int):
    repo.remove_tracked(category_id)
    return {"ok": True}


def _run_backfill_job(
    category_id: int,
    date_from: date | None = None,
    days: int | None = None,
    run_id: int | None = None,
) -> None:
    run_backfill(days=days, category_ids=[category_id], date_from=date_from, run_id=run_id)


@app.post("/api/categories/{category_id}/backfill")
def backfill_category(category_id: int, background: BackgroundTasks, body: BackfillBody | None = None):
    body = body or BackfillBody()
    date_from = body.dateFrom
    days = body.days
    if date_from is None and days is None:
        days = 365
    if date_from is not None and date_from > date.today():
        raise HTTPException(400, "dateFrom cannot be in the future")

    if repo.get_active_run():
        raise HTTPException(409, "A scrape is already running. Stop it first.")

    tracked = [c for c in repo.list_tracked() if c["id"] == category_id]
    if not tracked:
        # Allow backfill only for tracked categories
        cat = repo.get_cpv(category_id)
        if not cat:
            raise HTTPException(404, "Category not found")
        repo.add_tracked(cat["id"], cat["code"], cat["name"])
        tracked = [c for c in repo.list_tracked() if c["id"] == category_id]

    categories = [c["code"] for c in tracked]
    effective_from = date_from or (date.today() - timedelta(days=days or 365))
    run_id = repo.start_run(
        "backfill",
        categories,
        categories_total=1,
        date_from=effective_from.isoformat(),
        date_to=date.today().isoformat(),
        category_ids=[category_id],
    )
    if categories:
        repo.update_run_progress(run_id, current_category=categories[0], categories_total=1)
    background.add_task(_run_backfill_job, category_id, effective_from, days, run_id)
    run = repo.get_run(run_id)
    if not run:
        raise HTTPException(500, "Failed to create scrape run")
    return run


@app.post("/api/runs/{run_id}/resume")
def resume_run(run_id: int, background: BackgroundTasks):
    """Restart an interrupted run with its original date range and categories.

    Tenders already stored from the first attempt are recognised as unchanged and
    skipped, so resuming re-walks the listings but repeats almost none of the
    per-tender detail requests.
    """
    previous = repo.get_run(run_id)
    if not previous:
        raise HTTPException(404, "Run not found")
    if not previous.get("canResume"):
        raise HTTPException(400, "This run cannot be resumed")
    if repo.get_active_run():
        raise HTTPException(409, "A scrape is already running. Stop it first.")

    date_from = date.fromisoformat(previous["dateFrom"])
    date_to = date.fromisoformat(previous["dateTo"]) if previous.get("dateTo") else date.today()
    category_ids = previous.get("categoryIds")
    mode = previous["mode"]

    tracked = repo.list_tracked(enabled_only=True)
    if category_ids:
        tracked = [c for c in tracked if c["id"] in category_ids]
    if not tracked:
        raise HTTPException(400, "The categories for this run are no longer tracked")

    new_run_id = repo.start_run(
        mode,
        [c["code"] for c in tracked],
        categories_total=len(tracked),
        date_from=date_from.isoformat(),
        date_to=date_to.isoformat(),
        category_ids=category_ids,
        resumed_from=run_id,
    )

    def job():
        ScrapePipeline().run(
            date_from=date_from,
            date_to=date_to,
            mode=mode,
            category_ids=category_ids,
            run_id=new_run_id,
        )

    background.add_task(job)
    run = repo.get_run(new_run_id)
    if not run:
        raise HTTPException(500, "Failed to create scrape run")
    return run


@app.get("/api/runs")
def runs():
    run_list = repo.list_runs()
    active = repo.get_active_run()
    success = next((r for r in run_list if r["status"] == "success"), None)
    # Next scheduled: tomorrow 06:00 local (informational)
    tomorrow = date.today() + timedelta(days=1)
    return {
        "runs": run_list,
        "activeRun": active,
        "nextScheduledAt": f"{tomorrow.isoformat()}T06:00:00",
        "lastSuccessAt": success["finishedAt"] if success else None,
    }


@app.post("/api/scrape/stop")
def stop_scrape():
    active = repo.get_active_run()
    if not active:
        raise HTTPException(404, "No active scrape to stop")
    request_stop(active["id"])
    cancelled = repo.cancel_run(
        active["id"],
        active["tendersFound"],
        active["tendersUpserted"],
        ["Stopped by user"],
    )
    return {"ok": True, "run": cancelled}


@app.post("/api/scrape/daily")
def scrape_daily(background: BackgroundTasks):
    if repo.get_active_run():
        raise HTTPException(409, "A scrape is already running. Stop it first.")

    tracked = repo.list_tracked(enabled_only=True)
    if not tracked:
        raise HTTPException(400, "No tracked categories enabled")
    categories = [c["code"] for c in tracked]
    date_from = date.today() - timedelta(days=config.DAILY_LOOKBACK_DAYS)
    run_id = repo.start_run(
        "daily",
        categories,
        categories_total=len(tracked),
        date_from=date_from.isoformat(),
        date_to=date.today().isoformat(),
    )

    def job():
        ScrapePipeline().run(
            date_from=date_from,
            date_to=date.today(),
            mode="daily",
            run_id=run_id,
        )

    background.add_task(job)
    return {"ok": True, "message": "Daily scrape started", "runId": run_id}
