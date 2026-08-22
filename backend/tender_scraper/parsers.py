"""HTML parsers for SPA tender portal fragments."""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any

from bs4 import BeautifulSoup

SHOW_APP_RE = re.compile(r"ShowApp\((\d+),'([^']*)',(\d+),'([^']+)'\)")
RECORD_COUNT_RE = re.compile(r"(\d+)&nbsp;Record\(s\)&nbsp;\(page:\s*(\d+)/(\d+)\)")
AMOUNT_RE = re.compile(r"([\d`\s.,]+)\s*(GEL|USD|EUR)?", re.I)
PROFILE_RE = re.compile(r"ShowProfile\((\d+)\)")
FILE_HREF_RE = re.compile(r"library/files\.php\?[^\"']+")


@dataclass
class ListingRow:
    app_id: int
    key: str
    announcement_number: str
    status: str
    procurement_type: str
    buyer: str
    category_code: str
    category_name: str
    announcement_date: str | None
    bid_deadline: str | None
    estimated_value: float | None
    currency: str
    bidder_count: int
    winner: str | None
    contract_status: str | None
    raw_html: str


@dataclass
class ListingPage:
    rows: list[ListingRow]
    total_records: int
    page: int
    total_pages: int


@dataclass
class ParsedTender:
    app_id: int
    key: str
    announcement_number: str = ""
    title: str = ""
    status: str = ""
    procurement_type: str = ""
    buyer: str = ""
    buyer_org_id: int | None = None
    category_code: str = ""
    category_name: str = ""
    announcement_date: str | None = None
    bid_deadline: str | None = None
    bids_accepted_from: str | None = None
    estimated_value: float | None = None
    currency: str = "GEL"
    bidder_count: int = 0
    winner: str | None = None
    contract_status: str | None = None
    source_url: str = ""
    description: str = ""
    supply_period: str | None = None
    vat_terms: str | None = None
    guarantee_amount: float | None = None
    guarantee_validity: str | None = None
    bid_reduction_step: float | None = None
    amount_or_volume: str | None = None
    additional_info: str | None = None
    spec_text: str | None = None
    cpv_codes: list[dict[str, str]] = field(default_factory=list)
    document_sections: list[dict[str, Any]] = field(default_factory=list)
    attachments: list[dict[str, str]] = field(default_factory=list)
    bids: list[dict[str, Any]] = field(default_factory=list)
    status_history: list[dict[str, str]] = field(default_factory=list)
    result_documents: list[dict[str, str]] = field(default_factory=list)


def _text(el: Any) -> str:
    if el is None:
        return ""
    return " ".join(el.get_text(" ", strip=True).split())


def _parse_amount(text: str) -> tuple[float | None, str]:
    if not text:
        return None, "GEL"
    cleaned = text.replace("`", "").replace("\xa0", " ").strip()
    m = AMOUNT_RE.search(cleaned)
    if not m:
        return None, "GEL"
    num = m.group(1).replace(" ", "").replace(",", "")
    try:
        return float(num), (m.group(2) or "GEL").upper()
    except ValueError:
        return None, "GEL"


def _dmy_to_iso(value: str | None) -> str | None:
    """Convert DD.MM.YYYY or DD.MM.YYYY HH:MM to ISO date/datetime."""
    if not value:
        return None
    value = value.strip()
    m = re.match(r"(\d{2})\.(\d{2})\.(\d{4})(?:\s+(\d{2}):(\d{2}))?", value)
    if not m:
        return value
    d, mo, y, hh, mm = m.groups()
    if hh and mm:
        return f"{y}-{mo}-{d}T{hh}:{mm}:00"
    return f"{y}-{mo}-{d}"


def _field_map(soup: BeautifulSoup) -> dict[str, str]:
    result: dict[str, str] = {}
    for tr in soup.select("table.with-label tr"):
        cells = tr.find_all("td", recursive=False)
        if len(cells) < 2:
            continue
        label = _text(cells[0]).rstrip(":").strip()
        value = _text(cells[1])
        if label:
            result[label] = value
    return result


def parse_listing_page(html: str) -> ListingPage:
    soup = BeautifulSoup(html, "html.parser")
    rows: list[ListingRow] = []
    for tr in soup.select("tr[id^=A]"):
        onclick = tr.get("onclick") or ""
        m = SHOW_APP_RE.search(onclick)
        if not m:
            continue
        app_id = int(m.group(1))
        key = m.group(4)
        status_el = tr.select_one("p.status")
        status_text = _text(status_el)
        status = status_text.split("Bidders")[0].strip() if status_text else ""
        bidder_m = re.search(r"Bidders\s*-\s*(\d+)", status_text or "")
        bidder_count = int(bidder_m.group(1)) if bidder_m else 0
        winner_el = tr.select_one("span.color-2")
        winner = None
        if winner_el and "Winner:" in _text(winner_el):
            winner = _text(winner_el).replace("Winner:", "").strip()
        contract_el = tr.select_one("span[class^=agrfg]")
        contract_status = _text(contract_el) or None
        type_el = tr.select_one("p.lbl")
        fields: dict[str, str] = {}
        for p in tr.select("td > p"):
            t = _text(p)
            if ":" in t and "lbl" not in (p.get("class") or []) and "status" not in (p.get("class") or []):
                k, _, v = t.partition(":")
                fields[k.strip()] = v.strip()
        cat_text = fields.get("Procuring category", "")
        cat_code = ""
        cat_name = cat_text
        cm = re.match(r"(\d+)\s*-\s*(.*)", cat_text)
        if cm:
            cat_code, cat_name = cm.group(1), cm.group(2)
        value_text = fields.get("Estimated value of procurement", "")
        amount, currency = _parse_amount(value_text)
        rows.append(
            ListingRow(
                app_id=app_id,
                key=key,
                announcement_number=fields.get("Announcment number") or fields.get("Announcement number") or "",
                status=status.replace("Bidders", "").strip(" -"),
                procurement_type=_text(type_el),
                buyer=fields.get("Procuring entities", ""),
                category_code=cat_code,
                category_name=cat_name,
                announcement_date=_dmy_to_iso(fields.get("Procurement announcment date") or fields.get("Procurement announcement date")),
                bid_deadline=_dmy_to_iso(fields.get("Offer reception term")),
                estimated_value=amount,
                currency=currency,
                bidder_count=bidder_count,
                winner=winner,
                contract_status=contract_status,
                raw_html=str(tr),
            )
        )

    total_records = page = total_pages = 0
    m = RECORD_COUNT_RE.search(html)
    if m:
        total_records, page, total_pages = int(m.group(1)), int(m.group(2)), int(m.group(3))
    elif rows:
        page, total_pages, total_records = 1, 1, len(rows)
    return ListingPage(rows=rows, total_records=total_records, page=page, total_pages=total_pages)


def parse_main_tab(html: str, app_id: int, key: str) -> ParsedTender:
    soup = BeautifulSoup(html, "html.parser")
    fields = _field_map(soup)
    tender = ParsedTender(app_id=app_id, key=key)
    tender.procurement_type = fields.get("Procurement type", "").strip()
    tender.announcement_number = (
        fields.get("Announcment number") or fields.get("Announcement number") or ""
    ).strip()
    status_raw = fields.get("Procurement proceeding status", "")
    tender.status = re.sub(r"^.*?png\s*", "", status_raw).strip() or status_raw
    buyer_cell = None
    for tr in soup.select("table.with-label tr"):
        cells = tr.find_all("td", recursive=False)
        if len(cells) >= 2 and "Procuring entities" in _text(cells[0]):
            buyer_cell = cells[1]
            break
    if buyer_cell:
        tender.buyer = _text(buyer_cell)
        pm = PROFILE_RE.search(str(buyer_cell))
        if pm:
            tender.buyer_org_id = int(pm.group(1))
    tender.announcement_date = _dmy_to_iso(
        fields.get("Procurement announcment date") or fields.get("Procurement announcement date")
    )
    tender.bids_accepted_from = _dmy_to_iso(fields.get("Bids accepted from"))
    tender.bid_deadline = _dmy_to_iso(fields.get("Deadline for bid submission"))
    amount, currency = _parse_amount(fields.get("Estimated value of procurement", ""))
    tender.estimated_value = amount
    tender.currency = currency
    tender.vat_terms = fields.get("Bid must be submitted") or None
    cat = fields.get("Procuring category", "")
    cm = re.match(r"(\d+)\s*-\s*(.*)", cat)
    if cm:
        tender.category_code, tender.category_name = cm.group(1), cm.group(2)
    else:
        tender.category_name = cat
    tender.supply_period = fields.get("Supply Period") or None
    tender.amount_or_volume = fields.get("Amount or Volume of Procurements") or None
    step, _ = _parse_amount(fields.get("Bid reduction step", ""))
    tender.bid_reduction_step = step
    guar, _ = _parse_amount(fields.get("Guarantee amount", ""))
    tender.guarantee_amount = guar
    tender.guarantee_validity = fields.get("Guarantee validity period") or None

    blabla = soup.select_one("div.blabla")
    if blabla:
        desc = _text(blabla)
        # Guard against accidentally grabbing a huge block of field labels
        if desc and "Procurement type" not in desc and len(desc) < 800:
            tender.description = desc
            tender.title = desc
        elif desc:
            tender.description = desc[:500]
            tender.title = desc[:200]
    if not tender.title:
        tender.title = tender.announcement_number

    cpv_codes: list[dict[str, str]] = []
    for li in soup.select("ul li"):
        t = _text(li)
        m = re.match(r"(\d{8})\s*-\s*(.+)", t)
        if m:
            cpv_codes.append({"code": m.group(1), "name": m.group(2)})
    tender.cpv_codes = cpv_codes

    link_pre = soup.select_one("pre")
    if link_pre and "http" in _text(link_pre):
        um = re.search(r"https?://\S+", _text(link_pre))
        if um:
            tender.source_url = um.group(0).rstrip(".")
    else:
        tender.source_url = f"https://tenders.procurement.gov.ge/public/?go={app_id}&lang=en"
    return tender


def parse_docs_tab(html: str) -> tuple[list[dict[str, Any]], list[dict[str, str]]]:
    soup = BeautifulSoup(html, "html.parser")
    sections: list[dict[str, Any]] = []
    attachments: list[dict[str, str]] = []
    for section in soup.select("section.question"):
        title_el = section.select_one("p.q > span")
        body_el = section.select_one("div.a")
        title = _text(title_el)
        body = _text(body_el)
        sec_atts: list[dict[str, str]] = []
        for a in section.select("a[href*='files.php']"):
            href = a.get("href") or ""
            if not href.startswith("http"):
                href = "https://tenders.procurement.gov.ge/public/" + href.lstrip("/")
            att = {"name": _text(a) or href, "url": href}
            sec_atts.append(att)
            attachments.append(att)
        if title or body:
            sections.append(
                {
                    "section_id": section.get("id") or "",
                    "title": title,
                    "body": body,
                    "language": "ka",
                    "attachments": sec_atts,
                }
            )
    # Fallback: any file links not captured
    if not attachments:
        for a in soup.select("a[href*='files.php']"):
            href = a.get("href") or ""
            if not href.startswith("http"):
                href = "https://tenders.procurement.gov.ge/public/" + href.lstrip("/")
            attachments.append({"name": _text(a) or href, "url": href})
    return sections, attachments


def parse_bids_tab(html: str) -> list[dict[str, Any]]:
    soup = BeautifulSoup(html, "html.parser")
    bids: list[dict[str, Any]] = []
    for tr in soup.select("#app_bids table.ktable tbody tr"):
        cells = tr.find_all("td", recursive=False)
        if len(cells) < 4:
            continue
        name = _text(cells[0])
        if not name or name == "Bidder":
            continue
        pm = PROFILE_RE.search(str(cells[0]))
        last_amt, _ = _parse_amount(_text(cells[1]))
        first_amt, _ = _parse_amount(_text(cells[2]))
        last_date_el = cells[1].select_one(".date")
        first_date_el = cells[2].select_one(".date")
        offer_m = re.search(r"\[(\d+)\]", _text(cells[3]))
        bids.append(
            {
                "bidder_name": name,
                "bidder_org_id": int(pm.group(1)) if pm else None,
                "first_offer_amount": first_amt,
                "first_offer_at": _dmy_to_iso(_text(first_date_el)) if first_date_el else None,
                "last_offer_amount": last_amt,
                "last_offer_at": _dmy_to_iso(_text(last_date_el)) if last_date_el else None,
                "offer_count": int(offer_m.group(1)) if offer_m else 1,
            }
        )
    return bids


def parse_agency_docs(html: str) -> list[dict[str, str]]:
    soup = BeautifulSoup(html, "html.parser")
    docs: list[dict[str, str]] = []
    for a in soup.select("#agency_docs a[href*='files.php'], #reports a[href*='files.php']"):
        href = a.get("href") or ""
        if not href.startswith("http"):
            href = "https://tenders.procurement.gov.ge/public/" + href.lstrip("/")
        docs.append({"name": _text(a) or href, "url": href})
    return docs


def parse_status_history(html: str) -> list[dict[str, str]]:
    soup = BeautifulSoup(html, "html.parser")
    history: list[dict[str, str]] = []
    for tr in soup.select("table.with-free-label-history tr, #z table tr"):
        cells = tr.find_all("td", recursive=False)
        if len(cells) < 2:
            continue
        changed = _dmy_to_iso(_text(cells[0]))
        status = _text(cells[1])
        if changed and status:
            history.append({"status": status, "changed_at": changed})
    # Chronology is newest-first; reverse for timeline display
    history.reverse()
    return history
