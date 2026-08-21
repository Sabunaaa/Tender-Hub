"""SQLite schema and connection helpers."""

from __future__ import annotations

import sqlite3
from contextlib import contextmanager
from pathlib import Path
from typing import Iterator

from . import config

SCHEMA = """
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS tracked_categories (
    id INTEGER PRIMARY KEY,
    code TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    last_scraped_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS tenders (
    app_id INTEGER PRIMARY KEY,
    key TEXT NOT NULL,
    announcement_number TEXT NOT NULL,
    title TEXT,
    status TEXT,
    procurement_type TEXT,
    buyer TEXT,
    buyer_org_id INTEGER,
    category_code TEXT,
    category_name TEXT,
    announcement_date TEXT,
    bid_deadline TEXT,
    bids_accepted_from TEXT,
    estimated_value REAL,
    currency TEXT DEFAULT 'GEL',
    bidder_count INTEGER DEFAULT 0,
    winner TEXT,
    contract_status TEXT,
    source_url TEXT,
    description TEXT,
    supply_period TEXT,
    vat_terms TEXT,
    guarantee_amount REAL,
    guarantee_validity TEXT,
    bid_reduction_step REAL,
    amount_or_volume TEXT,
    additional_info TEXT,
    scraped_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_tenders_category ON tenders(category_code);
CREATE INDEX IF NOT EXISTS idx_tenders_status ON tenders(status);
CREATE INDEX IF NOT EXISTS idx_tenders_announcement ON tenders(announcement_date);
CREATE INDEX IF NOT EXISTS idx_tenders_deadline ON tenders(bid_deadline);
CREATE INDEX IF NOT EXISTS idx_tenders_buyer ON tenders(buyer);
CREATE INDEX IF NOT EXISTS idx_tenders_value ON tenders(estimated_value);

CREATE TABLE IF NOT EXISTS tender_cpv_codes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    app_id INTEGER NOT NULL REFERENCES tenders(app_id) ON DELETE CASCADE,
    code TEXT NOT NULL,
    name TEXT,
    UNIQUE(app_id, code)
);

CREATE TABLE IF NOT EXISTS tender_document_sections (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    app_id INTEGER NOT NULL REFERENCES tenders(app_id) ON DELETE CASCADE,
    section_id TEXT,
    title TEXT,
    body TEXT,
    language TEXT DEFAULT 'ka'
);

CREATE TABLE IF NOT EXISTS tender_attachments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    app_id INTEGER NOT NULL REFERENCES tenders(app_id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    url TEXT NOT NULL,
    kind TEXT DEFAULT 'doc',
    uploaded_at TEXT
);

CREATE TABLE IF NOT EXISTS tender_bids (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    app_id INTEGER NOT NULL REFERENCES tenders(app_id) ON DELETE CASCADE,
    bidder_name TEXT,
    bidder_org_id INTEGER,
    first_offer_amount REAL,
    first_offer_at TEXT,
    last_offer_amount REAL,
    last_offer_at TEXT,
    offer_count INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS tender_status_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    app_id INTEGER NOT NULL REFERENCES tenders(app_id) ON DELETE CASCADE,
    status TEXT NOT NULL,
    changed_at TEXT NOT NULL,
    UNIQUE(app_id, status, changed_at)
);

CREATE TABLE IF NOT EXISTS scrape_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    started_at TEXT NOT NULL,
    finished_at TEXT,
    status TEXT NOT NULL,
    mode TEXT NOT NULL,
    categories TEXT,
    tenders_found INTEGER DEFAULT 0,
    tenders_upserted INTEGER DEFAULT 0,
    tenders_skipped INTEGER DEFAULT 0,
    tenders_processed INTEGER DEFAULT 0,
    progress_total INTEGER DEFAULT 0,
    categories_done INTEGER DEFAULT 0,
    categories_total INTEGER DEFAULT 0,
    current_category TEXT,
    date_from TEXT,
    date_to TEXT,
    category_ids TEXT,
    resumed_from INTEGER,
    errors TEXT
);

CREATE TABLE IF NOT EXISTS raw_html (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    app_id INTEGER,
    kind TEXT NOT NULL,
    fetched_at TEXT NOT NULL DEFAULT (datetime('now')),
    html TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS cpv_categories (
    id INTEGER PRIMARY KEY,
    code TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL
);
"""

DEFAULT_TRACKED = [
    (18924, "30200000", "Computer equipment and supplies"),
    (18936, "32400000", "Networks"),
    (18937, "32500000", "Telecommunications equipment and supplies"),
]


def connect(db_path: Path | None = None) -> sqlite3.Connection:
    path = db_path or config.DB_PATH
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(path), check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA journal_mode = WAL")
    return conn


@contextmanager
def get_connection(db_path: Path | None = None) -> Iterator[sqlite3.Connection]:
    conn = connect(db_path)
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def _ensure_column(conn: sqlite3.Connection, table: str, column: str, ddl: str) -> None:
    cols = {row[1] for row in conn.execute(f"PRAGMA table_info({table})").fetchall()}
    if column not in cols:
        conn.execute(f"ALTER TABLE {table} ADD COLUMN {ddl}")


def init_db(db_path: Path | None = None) -> None:
    config.ensure_dirs()
    with get_connection(db_path) as conn:
        conn.executescript(SCHEMA)
        _ensure_column(conn, "scrape_runs", "progress_total", "progress_total INTEGER DEFAULT 0")
        _ensure_column(conn, "scrape_runs", "categories_done", "categories_done INTEGER DEFAULT 0")
        _ensure_column(conn, "scrape_runs", "categories_total", "categories_total INTEGER DEFAULT 0")
        _ensure_column(conn, "scrape_runs", "current_category", "current_category TEXT")
        _ensure_column(conn, "scrape_runs", "tenders_skipped", "tenders_skipped INTEGER DEFAULT 0")
        _ensure_column(conn, "scrape_runs", "tenders_processed", "tenders_processed INTEGER DEFAULT 0")
        _ensure_column(conn, "scrape_runs", "date_from", "date_from TEXT")
        _ensure_column(conn, "scrape_runs", "date_to", "date_to TEXT")
        _ensure_column(conn, "scrape_runs", "category_ids", "category_ids TEXT")
        _ensure_column(conn, "scrape_runs", "resumed_from", "resumed_from INTEGER")
        for cat_id, code, name in DEFAULT_TRACKED:
            conn.execute(
                """
                INSERT OR IGNORE INTO tracked_categories (id, code, name, enabled)
                VALUES (?, ?, ?, 1)
                """,
                (cat_id, code, name),
            )
            conn.execute(
                "INSERT OR IGNORE INTO cpv_categories (id, code, name) VALUES (?, ?, ?)",
                (cat_id, code, name),
            )
