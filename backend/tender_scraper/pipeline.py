"""Scrape pipeline: search per tracked category, page listings, fetch full detail.

Two things dominate the cost of a run, and both are addressed here:

* Wall-clock time is almost entirely the politeness delay between requests, so the
  pipeline avoids requests it does not need. A tender whose listing row still matches
  what is stored is skipped outright, and tabs that cannot have new content for a
  given status are never asked for.
* What remains is latency-bound rather than CPU-bound, so detail tabs are fetched
  through a pool of independent portal sessions sharing one global rate limiter.
  Listing searches stay serial because they depend on PHP session state.
"""

from __future__ import annotations

import logging
import queue
import threading
import time
from concurrent.futures import FIRST_COMPLETED, ThreadPoolExecutor, wait
from contextlib import contextmanager
from dataclasses import dataclass, field
from datetime import date, timedelta
from typing import Iterator

from . import config
from .cancel import clear_stop, should_stop
from .client import RateLimiter, TenderPortalClient
from .parsers import (
    ListingRow,
    ParsedTender,
    parse_agency_docs,
    parse_bids_tab,
    parse_docs_tab,
    parse_listing_page,
    parse_main_tab,
    parse_status_history,
)
from .repository import ALL_TENDER_PARTS, Repository

log = logging.getLogger(__name__)


class ScrapeCancelled(Exception):
    """Raised when a scrape is stopped by the user."""


@dataclass
class TenderFetch:
    """Everything one worker gathered for a single tender, ready to be written."""

    row: ListingRow
    parts: frozenset[str]
    tender: ParsedTender | None = None
    raw: list[tuple[str, str]] = field(default_factory=list)
    error: str | None = None


class _ClientPool:
    """A fixed set of portal sessions that worker threads borrow one at a time."""

    def __init__(self, size: int, limiter: RateLimiter, delay: float | None) -> None:
        self._clients = [TenderPortalClient(delay=delay, limiter=limiter) for _ in range(size)]
        self._free: queue.Queue[TenderPortalClient] = queue.Queue()
        for client in self._clients:
            self._free.put(client)

    @contextmanager
    def lease(self) -> Iterator[TenderPortalClient]:
        client = self._free.get()
        try:
            yield client
        finally:
            self._free.put(client)

    def close(self) -> None:
        for client in self._clients:
            try:
                client.close()
            except Exception:  # pragma: no cover - best effort cleanup
                log.debug("Failed closing pooled client", exc_info=True)


class _ProgressWriter:
    """Batches run-progress writes.

    Progress used to be committed after every tender, which meant a connect, commit
    and WAL sync per row. The dashboard polls every two seconds, so writing at most
    once a second loses nothing visible while removing most of the write traffic.
    """

    def __init__(self, repo: Repository, run_id: int, min_interval: float = 1.0, every: int = 10) -> None:
        self.repo = repo
        self.run_id = run_id
        self.min_interval = min_interval
        self.every = every
        self._last_write = 0.0
        self._pending = 0

    def update(self, force: bool = False, **fields: object) -> None:
        self._pending += 1
        now = time.monotonic()
        due = force or self._pending >= self.every or (now - self._last_write) >= self.min_interval
        if not due:
            return
        self._last_write = now
        self._pending = 0
        self.repo.update_run_progress(self.run_id, **fields)  # type: ignore[arg-type]


def _as_amount(value: object) -> float | None:
    if value is None or value == "":
        return None
    try:
        return round(float(value), 2)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return None


def _listing_changed(row: ListingRow, state: dict) -> bool:
    """Compare a search-result row against what is already stored.

    The listing carries every volatile field (status, deadline, value, bidder count,
    winner, contract status), so a match means the five detail requests would return
    what the database already holds.
    """
    return (
        (state.get("status") or "") != (row.status or "")
        or (state.get("bidDeadline") or "") != (row.bid_deadline or "")
        or _as_amount(state.get("estimatedValue")) != _as_amount(row.estimated_value)
        or int(state.get("bidderCount") or 0) != int(row.bidder_count or 0)
        or (state.get("winner") or "") != (row.winner or "")
        or (state.get("contractStatus") or "") != (row.contract_status or "")
    )


def _parts_for(row: ListingRow, state: dict | None, force: bool) -> frozenset[str] | None:
    """Decide which detail tabs to request, or ``None`` to skip the tender entirely."""
    is_new = state is None
    if not is_new and not force and not _listing_changed(row, state or {}):
        return None

    parts = {"main"}
    # Tender documentation is published with the announcement and does not change
    # afterwards, so it is fetched once and then trusted.
    if is_new or force or not (state or {}).get("hasDocs"):
        parts.add("docs")
    # No bidders means the bids tab has nothing to show yet.
    if (row.bidder_count or 0) > 0 or int((state or {}).get("bidderCount") or 0) > 0:
        parts.add("bids")
    # Result documents only exist once the award stage is reached.
    if row.status in config.AWARDED_STATUSES or row.contract_status:
        parts.add("results")
    # The timeline only gains entries when the status moves.
    if is_new or force or (state or {}).get("status") != row.status:
        parts.add("history")
    return frozenset(parts)


class ScrapePipeline:
    def __init__(self, repo: Repository | None = None, delay: float | None = None):
        self.repo = repo or Repository()
        self.delay = delay

    def _stop_if_requested(
        self,
        run_id: int,
        found: int,
        upserted: int,
        errors: list[str],
        skipped: int = 0,
        processed: int | None = None,
    ) -> None:
        if should_stop(run_id) or self.repo.get_run_status(run_id) == "cancelled":
            clear_stop(run_id)
            msg = "Stopped by user"
            if msg not in errors:
                errors.append(msg)
            self.repo.finish_run(run_id, "cancelled", found, upserted, errors, skipped=skipped, processed=processed)
            raise ScrapeCancelled(msg)

    def fetch_tender(self, client: TenderPortalClient, row: ListingRow, parts: frozenset[str]) -> TenderFetch:
        """Fetch and parse the requested tabs. Runs on a worker thread and touches no database."""
        client.start_session()
        result = TenderFetch(row=row, parts=parts)

        main_html = client.get_tab("app_main", row.app_id, row.key)
        result.raw.append(("app_main", main_html))
        tender = parse_main_tab(main_html, row.app_id, row.key)

        # Fill gaps from listing when detail is sparse
        if not tender.announcement_number:
            tender.announcement_number = row.announcement_number
        if not tender.status:
            tender.status = row.status
        if not tender.buyer:
            tender.buyer = row.buyer
        if not tender.estimated_value:
            tender.estimated_value = row.estimated_value
        if not tender.bid_deadline:
            tender.bid_deadline = row.bid_deadline
        if not tender.announcement_date:
            tender.announcement_date = row.announcement_date
        tender.bidder_count = row.bidder_count or tender.bidder_count
        tender.winner = row.winner or tender.winner
        tender.contract_status = row.contract_status or tender.contract_status
        if not tender.procurement_type:
            tender.procurement_type = row.procurement_type

        if "docs" in parts:
            try:
                docs_html = client.get_tab("app_docs", row.app_id, row.key)
                result.raw.append(("app_docs", docs_html))
                sections, attachments = parse_docs_tab(docs_html)
                tender.document_sections = sections
                tender.attachments = attachments
                # Prefer the procurement-object name from documentation as the title
                for sec in sections:
                    title = (sec.get("title") or "").lower()
                    body = (sec.get("body") or "").strip()
                    if body and ("1.1" in title or "name of an object" in title or "ობიექტ" in title):
                        tender.title = body[:500]
                        if not tender.description or len(tender.description) > 400:
                            tender.description = body
                        break
            except Exception as exc:
                log.warning("docs failed for %s: %s", row.app_id, exc)

        if "bids" in parts:
            try:
                bids_html = client.get_tab("app_bids", row.app_id, row.key)
                result.raw.append(("app_bids", bids_html))
                tender.bids = parse_bids_tab(bids_html)
                if tender.bids:
                    tender.bidder_count = len(tender.bids)
            except Exception as exc:
                log.warning("bids failed for %s: %s", row.app_id, exc)

        if "results" in parts:
            try:
                agency_html = client.get_tab("agency_docs", row.app_id, row.key)
                result.raw.append(("agency_docs", agency_html))
                tender.result_documents = parse_agency_docs(agency_html)
            except Exception as exc:
                log.warning("agency_docs failed for %s: %s", row.app_id, exc)

        if "history" in parts:
            try:
                hist_html = client.get_status_history(row.app_id)
                result.raw.append(("statushistory", hist_html))
                tender.status_history = parse_status_history(hist_html)
            except Exception as exc:
                log.warning("status history failed for %s: %s", row.app_id, exc)

        result.tender = tender
        return result

    def _persist(self, fetch: TenderFetch, state: dict | None, category_code: str, category_name: str) -> bool:
        """Write one fetched tender. Runs on the main thread so SQLite stays single-writer."""
        tender = fetch.tender
        assert tender is not None
        # A skipped docs tab means the stored title and description are the better ones.
        if "docs" not in fetch.parts and state:
            tender.title = state.get("title") or tender.title
            tender.description = state.get("description") or tender.description
        for kind, html in fetch.raw:
            self.repo.save_raw_html(tender.app_id, kind, html)
        return self.repo.upsert_tender(
            tender,
            category_code=category_code,
            category_name=category_name,
            replace=fetch.parts & ALL_TENDER_PARTS,
        )

    def run(
        self,
        date_from: date,
        date_to: date | None = None,
        mode: str = "daily",
        category_ids: list[int] | None = None,
        max_pages: int | None = None,
        run_id: int | None = None,
        force_refresh: bool = False,
    ) -> dict:
        date_to = date_to or date.today()
        tracked = self.repo.list_tracked(enabled_only=True)
        if category_ids:
            tracked = [c for c in tracked if c["id"] in category_ids]
        if not tracked:
            raise RuntimeError("No tracked categories enabled")

        categories = [c["code"] for c in tracked]
        if run_id is None:
            run_id = self.repo.start_run(
                mode,
                categories,
                categories_total=len(tracked),
                date_from=date_from.isoformat(),
                date_to=date_to.isoformat(),
                category_ids=category_ids,
            )
        else:
            self.repo.update_run_progress(
                run_id,
                categories_total=len(tracked),
                current_category=categories[0] if categories else None,
            )
        found = 0
        upserted = 0
        skipped = 0
        processed = 0
        progress_total = 0
        errors: list[str] = []

        limiter = RateLimiter(config.MAX_REQUESTS_PER_SECOND)
        # Searching is session-stateful, so it keeps a dedicated client of its own.
        search_client = TenderPortalClient(delay=self.delay, limiter=limiter)
        pool = _ClientPool(config.SCRAPE_CONCURRENCY, limiter, self.delay)
        progress = _ProgressWriter(self.repo, run_id)

        try:
            with search_client:
                for cat_idx, cat in enumerate(tracked):
                    self._stop_if_requested(run_id, found, upserted, errors, skipped, processed)
                    log.info("Scraping category %s (%s) %s → %s", cat["code"], cat["name"], date_from, date_to)
                    progress.update(
                        force=True,
                        current_category=cat["code"],
                        categories_done=cat_idx,
                        categories_total=len(tracked),
                        found=found,
                        upserted=upserted,
                        skipped=skipped,
                        processed=processed,
                        progress_total=progress_total,
                    )
                    try:
                        first_html = search_client.search(
                            date_from=date_from,
                            date_to=date_to,
                            cpv_category=cat["id"],
                        )
                        self.repo.save_raw_html(None, f"listing:{cat['code']}:1", first_html)
                        page = parse_listing_page(first_html)
                        total_pages = page.total_pages or 1
                        if max_pages:
                            total_pages = min(total_pages, max_pages)
                        expected = page.total_records or 0
                        if max_pages and page.total_pages and max_pages < page.total_pages:
                            # Cap expected when page limit truncates the crawl
                            expected = min(expected, max_pages * max(len(page.rows), 1))
                        progress_total += expected
                        progress.update(
                            force=True,
                            progress_total=progress_total,
                            current_category=cat["code"],
                            categories_done=cat_idx,
                        )
                        log.info("  %s records across %s pages", page.total_records, total_pages)

                        rows: list[ListingRow] = list(page.rows)
                        for pnum in range(2, total_pages + 1):
                            self._stop_if_requested(run_id, found, upserted, errors, skipped, processed)
                            html = search_client.get_page(pnum)
                            self.repo.save_raw_html(None, f"listing:{cat['code']}:{pnum}", html)
                            rows.extend(parse_listing_page(html).rows)

                        # One lookup for the whole category, then decide per tender what to fetch.
                        states = self.repo.get_tender_states([r.app_id for r in rows])
                        work: list[tuple[ListingRow, frozenset[str]]] = []
                        for row in rows:
                            found += 1
                            parts = _parts_for(row, states.get(row.app_id), force_refresh)
                            if parts is None:
                                skipped += 1
                                processed += 1
                                continue
                            work.append((row, parts))

                        log.info(
                            "  %s tenders: %s to fetch, %s unchanged",
                            len(rows),
                            len(work),
                            len(rows) - len(work),
                        )
                        progress.update(
                            force=True,
                            found=found,
                            upserted=upserted,
                            skipped=skipped,
                            processed=processed,
                            progress_total=progress_total,
                            current_category=cat["code"],
                            categories_done=cat_idx,
                            categories_total=len(tracked),
                        )

                        counters = lambda: (found, upserted, skipped, processed, errors)  # noqa: E731
                        for fetch in self._fetch_all(pool, work, run_id, counters):
                            processed += 1
                            if fetch.error:
                                errors.append(fetch.error)
                            else:
                                try:
                                    self._persist(fetch, states.get(fetch.row.app_id), cat["code"], cat["name"])
                                    upserted += 1
                                    log.info("  OK %s %s", fetch.row.announcement_number or fetch.row.app_id, fetch.row.status)
                                except Exception as exc:
                                    msg = f"Failed saving app_id={fetch.row.app_id}: {exc}"
                                    log.exception(msg)
                                    errors.append(msg)
                            progress.update(
                                found=found,
                                upserted=upserted,
                                skipped=skipped,
                                processed=processed,
                                progress_total=progress_total,
                                current_category=cat["code"],
                                categories_done=cat_idx,
                                categories_total=len(tracked),
                            )

                        self.repo.mark_scraped(cat["id"])
                        progress.update(
                            force=True,
                            categories_done=cat_idx + 1,
                            categories_total=len(tracked),
                            found=found,
                            upserted=upserted,
                            skipped=skipped,
                            processed=processed,
                            progress_total=progress_total,
                        )
                    except ScrapeCancelled:
                        raise
                    except Exception as exc:
                        msg = f"Category {cat['code']} failed: {exc}"
                        log.exception(msg)
                        errors.append(msg)
                        progress.update(
                            force=True,
                            categories_done=cat_idx + 1,
                            categories_total=len(tracked),
                        )

            status = "success" if not errors else ("partial" if upserted else "failed")
            self.repo.finish_run(run_id, status, found, upserted, errors, skipped=skipped, processed=processed)
            return {
                "runId": run_id,
                "status": status,
                "tendersFound": found,
                "tendersUpserted": upserted,
                "tendersSkipped": skipped,
                "errors": errors,
            }
        except ScrapeCancelled:
            clear_stop(run_id)
            log.info("Scrape run %s stopped by user", run_id)
            return {
                "runId": run_id,
                "status": "cancelled",
                "tendersFound": found,
                "tendersUpserted": upserted,
                "tendersSkipped": skipped,
                "errors": errors,
            }
        except Exception as exc:
            errors.append(str(exc))
            self.repo.finish_run(run_id, "failed", found, upserted, errors, skipped=skipped, processed=processed)
            raise
        finally:
            pool.close()
            clear_stop(run_id)

    def _fetch_all(
        self,
        pool: _ClientPool,
        work: list[tuple[ListingRow, frozenset[str]]],
        run_id: int,
        counters,
    ) -> Iterator[TenderFetch]:
        """Fetch detail tabs across the pool, yielding results as they land.

        Workers only do network and parsing work; every database write happens in the
        caller, which keeps SQLite to a single writer.
        """
        if not work:
            return

        stop_flag = threading.Event()

        def task(row: ListingRow, parts: frozenset[str]) -> TenderFetch:
            if stop_flag.is_set():
                return TenderFetch(row=row, parts=parts, error=None)
            with pool.lease() as client:
                try:
                    return self.fetch_tender(client, row, parts)
                except Exception as exc:
                    log.exception("Failed app_id=%s", row.app_id)
                    return TenderFetch(row=row, parts=parts, error=f"Failed app_id={row.app_id}: {exc}")

        with ThreadPoolExecutor(max_workers=config.SCRAPE_CONCURRENCY) as executor:
            pending = {executor.submit(task, row, parts) for row, parts in work}
            try:
                while pending:
                    done, pending = wait(pending, timeout=1.0, return_when=FIRST_COMPLETED)
                    for future in done:
                        result = future.result()
                        if result.tender is not None or result.error:
                            yield result
                    # Counters are read after the caller has consumed everything above,
                    # so a cancellation records the true totals.
                    found, upserted, skipped, processed, errors = counters()
                    if should_stop(run_id) or self.repo.get_run_status(run_id) == "cancelled":
                        stop_flag.set()
                        for future in pending:
                            future.cancel()
                        self._stop_if_requested(run_id, found, upserted, errors, skipped, processed)
            finally:
                stop_flag.set()


def run_daily(lookback_days: int | None = None, run_id: int | None = None) -> dict:
    days = lookback_days if lookback_days is not None else config.DAILY_LOOKBACK_DAYS
    today = date.today()
    return ScrapePipeline().run(
        date_from=today - timedelta(days=days),
        date_to=today,
        mode="daily",
        run_id=run_id,
    )


def run_backfill(
    days: int | None = None,
    category_ids: list[int] | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    run_id: int | None = None,
    max_pages: int | None = None,
) -> dict:
    today = date_to or date.today()
    if date_from is None:
        lookback = days if days is not None else config.DEFAULT_BACKFILL_DAYS
        date_from = today - timedelta(days=lookback)
    if date_from > today:
        raise ValueError("date_from cannot be after date_to")
    return ScrapePipeline().run(
        date_from=date_from,
        date_to=today,
        mode="backfill",
        category_ids=category_ids,
        max_pages=max_pages,
        run_id=run_id,
    )
