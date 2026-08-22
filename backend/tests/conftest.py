from __future__ import annotations

import sys
from pathlib import Path

import pytest

BACKEND = Path(__file__).resolve().parents[1]
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

from tender_scraper import config, settings
from tender_scraper.repository import Repository

SAMPLES = Path(__file__).resolve().parents[2] / "data" / "samples"


@pytest.fixture
def samples() -> Path:
    return SAMPLES


@pytest.fixture
def tmp_repo(tmp_path, monkeypatch) -> Repository:
    monkeypatch.setattr(config, "DATA_DIR", tmp_path)
    monkeypatch.setattr(config, "DB_PATH", tmp_path / "tenders.db")
    monkeypatch.setattr(config, "LOG_DIR", tmp_path / "logs")
    settings._cache = None
    return Repository(tmp_path / "tenders.db")
