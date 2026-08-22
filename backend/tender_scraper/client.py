"""HTTP client for the Georgian State Procurement Agency public tender portal.

The portal has no public API. Its search page is a jQuery front end that posts to
a single PHP controller and receives HTML fragments back. This module reproduces
those calls directly, which is far cheaper and more reliable than driving a
headless browser.

Two behaviours of the portal shape the design here:

* Search state lives in the PHP session, not in the request. A search must be
  POSTed once to establish the filter set, after which pages are requested by
  number against that same session. A client instance therefore owns one search
  at a time and is not safe to share across concurrent searches.
* Detail pages require both the numeric ``app_id`` and a per-record ``key`` hash
  that only appears in search results, so listings must always be scraped before
  details.
"""

from __future__ import annotations

import logging
import threading
import time
from datetime import date
from typing import Iterator

import httpx

from . import config

log = logging.getLogger(__name__)


class TenderPortalError(RuntimeError):
    """Raised when the portal cannot be reached or returns an unusable response."""


class RateLimiter:
    """Caps the request rate across every client sharing this instance.

    Detail tabs are fetched from several sessions at once, so the politeness budget
    has to be enforced process-wide rather than per client. Callers block in
    :meth:`acquire` until the next slot is due, which keeps the aggregate rate at
    ``max_rps`` no matter how many threads are running.
    """

    def __init__(self, max_rps: float) -> None:
        self.min_interval = 1.0 / max_rps if max_rps > 0 else 0.0
        self._lock = threading.Lock()
        self._next_slot_at = 0.0

    def acquire(self) -> None:
        if self.min_interval <= 0:
            return
        with self._lock:
            now = time.monotonic()
            slot = max(now, self._next_slot_at)
            self._next_slot_at = slot + self.min_interval
        wait = slot - now
        if wait > 0:
            time.sleep(wait)


# Maps our filter names onto the portal's form fields. The portal ships a typo in
# its own markup (``app_date_tlll`` for the upper date bound) that we must match.
_SEARCH_DEFAULTS = {
    "action": "search_app",
    "app_t": "0",
    "search": "",
    "app_reg_id": "",
    "app_shems_id": "0",
    "org_a": "",
    "app_monac_id": "0",
    "org_b": "",
    "app_particip_status_id": "0",
    "app_donor_id": "0",
    "app_status": "0",
    "app_agr_status": "0",
    "app_type": "0",
    "app_basecode": "0",
    "app_codes": "",
    "app_date_type": "1",  # 1 = registration date, 2 = bidding date, 3 = status date
    "app_date_from": "",
    "app_date_tlll": "",
    "app_amount_from": "",
    "app_amount_to": "",
    "app_currency": "2",
    "app_pricelist": "0",
}


def _fmt_date(value: date) -> str:
    return value.strftime("%d.%m.%Y")


class TenderPortalClient:
    """A single browsing session against the tender portal."""

    def __init__(
        self,
        delay: float | None = None,
        timeout: float | None = None,
        max_retries: int | None = None,
        language: str = "en",
        limiter: RateLimiter | None = None,
    ) -> None:
        self.delay = config.REQUEST_DELAY_SECONDS if delay is None else delay
        self.max_retries = config.MAX_RETRIES if max_retries is None else max_retries
        self.language = language
        self.limiter = limiter
        self._last_request_at = 0.0
        self._session_ready = False
        self._client = httpx.Client(
            timeout=config.REQUEST_TIMEOUT_SECONDS if timeout is None else timeout,
            follow_redirects=True,
            headers={
                "User-Agent": config.USER_AGENT,
                "Accept-Language": "en-US,en;q=0.9,ka;q=0.8",
                "X-Requested-With": "XMLHttpRequest",
            },
        )

    def __enter__(self) -> "TenderPortalClient":
        return self

    def __exit__(self, *exc_info: object) -> None:
        self.close()

    def close(self) -> None:
        self._client.close()

    def _throttle(self) -> None:
        # A shared limiter owns the process-wide budget; fall back to per-client
        # spacing only when this client is running on its own.
        if self.limiter is not None:
            self.limiter.acquire()
            return
        elapsed = time.monotonic() - self._last_request_at
        if elapsed < self.delay:
            time.sleep(self.delay - elapsed)
        self._last_request_at = time.monotonic()

    def _send(self, method: str, url: str, **kwargs: object) -> httpx.Response:
        last_error: Exception | None = None
        for attempt in range(1, self.max_retries + 1):
            self._throttle()
            try:
                response = self._client.request(method, url, **kwargs)  # type: ignore[arg-type]
                response.raise_for_status()
                return response
            except httpx.HTTPStatusError as exc:
                status = exc.response.status_code
                # A 4xx means this URL is wrong or gone; retrying only burns the
                # politeness budget and delays every tender behind it.
                if status < 500 and status != 429:
                    raise TenderPortalError(f"Request to {url} failed with HTTP {status}") from exc
                last_error = exc
            except httpx.TransportError as exc:
                last_error = exc

            if attempt >= self.max_retries:
                break
            wait = min(config.RETRY_BACKOFF_SECONDS * attempt, config.RETRY_BACKOFF_MAX_SECONDS)
            log.warning(
                "Request failed (attempt %s/%s): %s - retrying in %.0fs",
                attempt,
                self.max_retries,
                last_error,
                wait,
            )
            time.sleep(wait)
        raise TenderPortalError(f"Request to {url} failed after {self.max_retries} attempts") from last_error

    def _request(self, method: str, url: str, **kwargs: object) -> str:
        response = self._send(method, url, **kwargs)
        # The portal serves UTF-8 but does not always say so, which would
        # otherwise mangle every Georgian string we read.
        response.encoding = response.encoding or "utf-8"
        return response.text

    def get_bytes(self, url: str) -> bytes:
        """Download a file (tender attachments) using the same session and rate limit."""
        return self._send("GET", url).content

    def start_session(self) -> None:
        """Load the landing page so the portal issues a PHP session cookie.

        Every later call depends on this cookie; without it the controller
        returns an empty result set rather than an error.
        """
        if self._session_ready:
            return
        self._request("GET", config.BASE_URL, params={"lang": self.language})
        self._session_ready = True
        log.debug("Session established")

    def search(
        self,
        date_from: date | None = None,
        date_to: date | None = None,
        date_type: int = 1,
        status: str | int = 0,
        procurement_type: str | int = 0,
        cpv_category: str | int = 0,
        buyer: str = "",
        amount_from: str | float = "",
        amount_to: str | float = "",
    ) -> str:
        """Run a search and return the HTML of the first page of results."""
        self.start_session()
        payload = dict(_SEARCH_DEFAULTS)
        payload.update(
            {
                "app_date_type": str(date_type),
                "app_date_from": _fmt_date(date_from) if date_from else "",
                "app_date_tlll": _fmt_date(date_to) if date_to else "",
                "app_status": str(status),
                "app_type": str(procurement_type),
                "app_basecode": str(cpv_category),
                "org_a": buyer,
                "app_amount_from": str(amount_from),
                "app_amount_to": str(amount_to),
            }
        )
        log.info("Searching tenders from %s to %s", payload["app_date_from"] or "*", payload["app_date_tlll"] or "*")
        return self._request(
            "POST",
            config.CONTROLLER_URL,
            data=payload,
            headers={"Content-Type": "application/x-www-form-urlencoded"},
        )

    def get_page(self, page: int) -> str:
        """Fetch an absolute page number within the session's current search."""
        return self._request(
            "GET",
            config.CONTROLLER_URL,
            params={"action": "search_app", "page": page},
        )

    def iter_search_pages(self, first_page_html: str, total_pages: int, start_page: int = 2) -> Iterator[str]:
        """Yield each remaining page of the current search, in order."""
        yield first_page_html
        for page in range(start_page, total_pages + 1):
            log.debug("Fetching results page %s/%s", page, total_pages)
            yield self.get_page(page)

    def get_tab(self, tab: str, app_id: int, key: str) -> str:
        """Fetch one detail tab for a tender.

        ``tab`` is one of ``app_main`` (core fields), ``app_docs`` (tender
        documentation and technical specification), ``app_bids`` (offers) or
        ``agency_docs`` (award result).
        """
        return self._request(
            "GET",
            config.CONTROLLER_URL,
            params={"action": tab, "app_id": app_id, "key": key},
        )

    def get_status_history(self, app_id: int) -> str:
        """Fetch the status timeline for a tender."""
        return self._request(
            "GET",
            config.CONTROLLER_URL,
            params={"action": "app_statushistory", "app_id": app_id},
        )

    def get_available_tabs(self, app_id: int, key: str) -> str:
        """Fetch the tab strip, which reveals which detail tabs a tender exposes."""
        return self._request(
            "GET",
            config.CONTROLLER_URL,
            params={"action": "application", "app_id": app_id, "app_reg": "", "key": key},
        )
