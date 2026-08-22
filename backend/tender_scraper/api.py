"""FastAPI application for the Tender Dashboard."""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from datetime import date, timedelta
from typing import Annotated

from fastapi import BackgroundTasks, FastAPI, HTTPException, Query, Request
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel, Field

from tender_scraper import config
from tender_scraper.cancel import request_stop
from tender_scraper.cpv_seed import seed_cpv_categories
from tender_scraper.db import init_db
from tender_scraper.pipeline import ScrapePipeline, run_backfill
from tender_scraper.queries import filter_options, get_stats, get_tender, list_tenders
from tender_scraper.engagements import (
    EngagementError,
    add_engagement,
    delete_engagement,
    list_engagements,
    update_engagement,
)
from tender_scraper.repository import ActiveScrapeError, Repository
from tender_scraper.access import (
    ACCESS_COOKIE,
    ACCESS_COOKIE_MAX_AGE,
    access_cookie_value,
    is_valid_access_cookie,
    verify_access_password,
)
from tender_scraper.settings import apply_to_config, load_settings, next_scheduled_iso, to_payload, update_settings

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)

log = logging.getLogger(__name__)
repo = Repository()


@asynccontextmanager
async def lifespan(_app: FastAPI):
    config.ensure_dirs()
    apply_to_config()
    init_db()
    seed_cpv_categories(repo)
    reaped = repo.fail_stale_running_runs()
    if reaped:
        log.warning("Marked stale scrape runs as failed: %s", reaped)
    yield


app = FastAPI(title="Tender Dashboard API", version="1.0.0", lifespan=lifespan)

_PUBLIC_API_PATHS = {"/api/auth", "/api/health"}
_COOKIE_OPTS = {
    "httponly": True,
    "samesite": "strict",
    "path": "/",
    "secure": False,
    "max_age": ACCESS_COOKIE_MAX_AGE,
}


@app.middleware("http")
async def require_access(request: Request, call_next):
    path = request.url.path
    if not path.startswith("/api/") or path in _PUBLIC_API_PATHS:
        return await call_next(request)
    if is_valid_access_cookie(request.cookies.get(ACCESS_COOKIE)):
        return await call_next(request)
    return JSONResponse({"detail": "Password required."}, status_code=401)


class PasswordBody(BaseModel):
    password: str = ""


@app.get("/api/auth")
def auth_status(request: Request):
    ok = is_valid_access_cookie(request.cookies.get(ACCESS_COOKIE))
    response = JSONResponse({"ok": ok})
    if ok:
        response.set_cookie(ACCESS_COOKIE, access_cookie_value(), **_COOKIE_OPTS)
    return response


@app.post("/api/auth")
def auth_unlock(body: PasswordBody):
    if not verify_access_password(body.password):
        raise HTTPException(401, "Incorrect password.")
    response = JSONResponse({"ok": True})
    response.set_cookie(ACCESS_COOKIE, access_cookie_value(), **_COOKIE_OPTS)
    return response


@app.delete("/api/auth")
def auth_lock():
    response = JSONResponse({"ok": True})
    response.delete_cookie(ACCESS_COOKIE, path="/")
    return response


class AddCategoryBody(BaseModel):
    categoryId: int


class BackfillBody(BaseModel):
    dateFrom: date | None = None
    days: int | None = None


class SettingsUpdateBody(BaseModel):
    scheduleEnabled: bool | None = None
    scheduleTime: str | None = None
    scheduleDays: list[str] | None = None
    dailyLookbackDays: int | None = Field(default=None, ge=1, le=30)
    requestDelaySeconds: float | None = Field(default=None, ge=0.2, le=10)
    maxRequestsPerSecond: float | None = Field(default=None, ge=0.2, le=10)
    scrapeConcurrency: int | None = Field(default=None, ge=1, le=8)
    requestTimeoutSeconds: float | None = Field(default=None, ge=10, le=180)
    closingSoonDays: int | None = Field(default=None, ge=1, le=30)
    defaultPageSize: int | None = Field(default=None, ge=5, le=100)
    accountManagers: list[str] | None = None
    solutionManagers: list[str] | None = None


@app.get("/api/health")
def health():
    return {"ok": True, "db": str(config.DB_PATH)}


@app.get("/api/stats")
def stats():
    return get_stats()


@app.get("/api/tenders")
def tenders(
    q: str | None = None,
    keywords: Annotated[list[str] | None, Query()] = None,
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
    hasSpec: bool = False,
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
            "keywords": keywords,
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
            "hasSpec": hasSpec,
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


class AddEngagementBody(BaseModel):
    announcementNumber: str = ""


class UpdateEngagementBody(BaseModel):
    engaged: bool | None = None
    accountManager: str | None = None
    solutionManager: str | None = None
    product: str | None = None
    domain: str | None = None


@app.get("/api/engagements")
def engagements():
    return list_engagements()


@app.post("/api/engagements")
def create_engagement(body: AddEngagementBody):
    try:
        return add_engagement(body.announcementNumber)
    except EngagementError as exc:
        raise HTTPException(400, str(exc)) from exc


@app.patch("/api/engagements/{engagement_id}")
def patch_engagement(engagement_id: int, body: UpdateEngagementBody):
    patch = body.model_dump(exclude_none=True)
    try:
        return update_engagement(engagement_id, patch)
    except EngagementError as exc:
        status = 404 if "not found" in str(exc).lower() else 400
        raise HTTPException(status, str(exc)) from exc


@app.delete("/api/engagements/{engagement_id}")
def remove_engagement(engagement_id: int):
    try:
        delete_engagement(engagement_id)
    except EngagementError as exc:
        raise HTTPException(404, str(exc)) from exc
    return {"ok": True}


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
    force_refresh: bool = False,
) -> None:
    run_backfill(
        days=days,
        category_ids=[category_id],
        date_from=date_from,
        run_id=run_id,
        force_refresh=force_refresh,
    )


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
    try:
        run_id = repo.start_run(
            "backfill",
            categories,
            categories_total=1,
            date_from=effective_from.isoformat(),
            date_to=date.today().isoformat(),
            category_ids=[category_id],
        )
    except ActiveScrapeError as exc:
        raise HTTPException(409, str(exc)) from exc
    if categories:
        repo.update_run_progress(run_id, current_category=categories[0], categories_total=1)
    background.add_task(_run_backfill_job, category_id, effective_from, days, run_id)
    run = repo.get_run(run_id)
    if not run:
        raise HTTPException(500, "Failed to create scrape run")
    return run


@app.post("/api/categories/{category_id}/rescrape")
def rescrape_category(category_id: int, background: BackgroundTasks):
    if repo.get_active_run():
        raise HTTPException(409, "A scrape is already running. Stop it first.")

    tracked = [c for c in repo.list_tracked() if c["id"] == category_id]
    if not tracked:
        raise HTTPException(404, "Category not found")

    cat = tracked[0]
    earliest = repo.earliest_announcement_date(cat["code"])
    try:
        effective_from = date.fromisoformat(earliest) if earliest else date.today() - timedelta(days=365)
    except ValueError:
        effective_from = date.today() - timedelta(days=365)
    try:
        run_id = repo.start_run(
            "rescrape",
            [cat["code"]],
            categories_total=1,
            date_from=effective_from.isoformat(),
            date_to=date.today().isoformat(),
            category_ids=[category_id],
        )
    except ActiveScrapeError as exc:
        raise HTTPException(409, str(exc)) from exc
    repo.update_run_progress(run_id, current_category=cat["code"], categories_total=1)
    background.add_task(_run_backfill_job, category_id, effective_from, None, run_id, True)
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

    try:
        new_run_id = repo.start_run(
            mode,
            [c["code"] for c in tracked],
            categories_total=len(tracked),
            date_from=date_from.isoformat(),
            date_to=date_to.isoformat(),
            category_ids=category_ids,
            resumed_from=run_id,
        )
    except ActiveScrapeError as exc:
        raise HTTPException(409, str(exc)) from exc

    def job():
        ScrapePipeline().run(
            date_from=date_from,
            date_to=date_to,
            mode=mode,
            category_ids=category_ids,
            run_id=new_run_id,
            force_refresh=mode == "rescrape",
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
    return {
        "runs": run_list,
        "activeRun": active,
        "nextScheduledAt": next_scheduled_iso(),
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
    date_from = date.today() - timedelta(days=load_settings().daily_lookback_days)
    try:
        run_id = repo.start_run(
            "daily",
            categories,
            categories_total=len(tracked),
            date_from=date_from.isoformat(),
            date_to=date.today().isoformat(),
        )
    except ActiveScrapeError as exc:
        raise HTTPException(409, str(exc)) from exc

    def job():
        ScrapePipeline().run(
            date_from=date_from,
            date_to=date.today(),
            mode="daily",
            run_id=run_id,
        )

    background.add_task(job)
    return {"ok": True, "message": "Daily scrape started", "runId": run_id}


@app.get("/api/settings")
def get_settings():
    return to_payload()


@app.put("/api/settings")
def put_settings(body: SettingsUpdateBody):
    patch = body.model_dump(exclude_none=True)
    if not patch:
        return to_payload()
    try:
        return update_settings(patch)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc


def _attach_frontend() -> None:
    dist = config.FRONTEND_DIR.resolve()
    index = dist / "index.html"
    if not index.is_file():
        log.warning("No frontend build at %s — run npm run build in frontend/", dist)
        return

    @app.get("/{full_path:path}")
    async def spa(full_path: str):
        if full_path == "api" or full_path.startswith("api/"):
            raise HTTPException(404)
        if full_path:
            target = (dist / full_path).resolve()
            try:
                target.relative_to(dist)
            except ValueError:
                raise HTTPException(404)
            if target.is_file():
                return FileResponse(target)
        return FileResponse(index, headers={"Cache-Control": "no-cache"})


_attach_frontend()
