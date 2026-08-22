"""Extract searchable text from ტექნიკური დავალება attachments."""

from __future__ import annotations

import io
import logging
import re
from pathlib import Path
from typing import Iterable

log = logging.getLogger(__name__)

SPEC_MARKER = "ტექნიკური"
MAX_FILES = 4
MAX_FILE_BYTES = 15 * 1024 * 1024
MAX_CHARS = 200_000
SUPPORTED_EXT = {".pdf", ".xlsx", ".xls", ".docx"}

_SPACE = re.compile(r"\s+")


def is_spec_filename(name: str | None) -> bool:
    return SPEC_MARKER in (name or "")


def spec_files(attachments: Iterable[dict]) -> list[dict]:
    """Unique URL list for attachments whose filename contains ტექნიკური."""
    seen: set[str] = set()
    out: list[dict] = []
    for att in attachments:
        name = att.get("name") or ""
        url = att.get("url") or ""
        if not url or url in seen or not is_spec_filename(name):
            continue
        ext = Path(name).suffix.lower()
        if ext and ext not in SUPPORTED_EXT:
            continue
        seen.add(url)
        out.append({"name": name, "url": url})
        if len(out) >= MAX_FILES:
            break
    return out


def _clean(text: str) -> str:
    return _SPACE.sub(" ", text).strip()[:MAX_CHARS]


def extract_bytes(data: bytes, filename: str) -> str:
    ext = Path(filename).suffix.lower()
    if ext == ".pdf":
        return _from_pdf(data)
    if ext == ".xlsx":
        return _from_xlsx(data)
    if ext == ".xls":
        return _from_xls(data)
    if ext == ".docx":
        return _from_docx(data)
    return ""


def _from_pdf(data: bytes) -> str:
    from pypdf import PdfReader

    reader = PdfReader(io.BytesIO(data))
    parts: list[str] = []
    for page in reader.pages:
        parts.append(page.extract_text() or "")
    return _clean(" ".join(parts))


def _from_xlsx(data: bytes) -> str:
    from openpyxl import load_workbook

    wb = load_workbook(io.BytesIO(data), read_only=True, data_only=True)
    parts: list[str] = []
    try:
        for sheet in wb.worksheets:
            for row in sheet.iter_rows(values_only=True):
                for cell in row:
                    if cell is None or cell == "":
                        continue
                    parts.append(str(cell))
    finally:
        wb.close()
    return _clean(" ".join(parts))


def _from_xls(data: bytes) -> str:
    import xlrd

    book = xlrd.open_workbook(file_contents=data)
    parts: list[str] = []
    for sheet in book.sheets():
        for r in range(sheet.nrows):
            for cell in sheet.row_values(r):
                if cell is None or cell == "":
                    continue
                parts.append(str(cell))
    return _clean(" ".join(parts))


def _from_docx(data: bytes) -> str:
    import docx

    document = docx.Document(io.BytesIO(data))
    parts = [p.text for p in document.paragraphs if p.text]
    for table in document.tables:
        for row in table.rows:
            for cell in row.cells:
                if cell.text:
                    parts.append(cell.text)
    return _clean(" ".join(parts))


def extract_spec_text(client, attachments: Iterable[dict]) -> str:
    """Download matching files through the portal session and concatenate text.

    Returns ``""`` when nothing could be extracted so callers can mark the
    tender as attempted and skip it next time.
    """
    chunks: list[str] = []
    for att in spec_files(attachments):
        try:
            data = client.get_bytes(att["url"])
        except Exception as exc:
            log.warning("spec download failed (%s): %s", att["name"], exc)
            continue
        if not data or len(data) > MAX_FILE_BYTES:
            log.warning("spec skipped (%s): empty or too large (%s bytes)", att["name"], len(data or b""))
            continue
        try:
            text = extract_bytes(data, att["name"])
        except Exception as exc:
            log.warning("spec parse failed (%s): %s", att["name"], exc)
            continue
        if text:
            chunks.append(text)
    return _clean(" ".join(chunks))
