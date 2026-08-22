"""Persisted app settings and Windows Task Scheduler sync."""

from __future__ import annotations

import json
import logging
import subprocess
import sys
import threading
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, field_validator

from . import config

log = logging.getLogger(__name__)

# Georgia does not use DST. Schedule times are always Tbilisi (GMT+4).
TBILISI = timezone(timedelta(hours=4), name="GET")
TASK_NAME = "TenderDashboardDailyScrape"
WEEKDAYS = ("mon", "tue", "wed", "thu", "fri", "sat", "sun")
_PS_DAYS = {
    "mon": "Monday",
    "tue": "Tuesday",
    "wed": "Wednesday",
    "thu": "Thursday",
    "fri": "Friday",
    "sat": "Saturday",
    "sun": "Sunday",
}

_lock = threading.Lock()
_cache: AppSettings | None = None
_MAX_PEOPLE = 50
_MAX_NAME = 80


def _clean_names(value: list[str]) -> list[str]:
    seen: list[str] = []
    keys: set[str] = set()
    for raw in value:
        name = " ".join(str(raw).split()).strip()[:_MAX_NAME]
        if not name:
            continue
        key = name.casefold()
        if key in keys:
            continue
        keys.add(key)
        seen.append(name)
        if len(seen) >= _MAX_PEOPLE:
            break
    return seen


class TaskStatus(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    registered: bool = False
    task_name: str = Field(default=TASK_NAME, alias="taskName")
    state: str | None = None
    last_run_at: str | None = Field(default=None, alias="lastRunAt")
    last_task_result: int | None = Field(default=None, alias="lastTaskResult")
    message: str | None = None


class AppSettings(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    schedule_enabled: bool = Field(default=False, alias="scheduleEnabled")
    schedule_time: str = Field(default="06:00", alias="scheduleTime")
    schedule_days: list[str] = Field(default_factory=lambda: list(WEEKDAYS), alias="scheduleDays")
    daily_lookback_days: int = Field(default=3, alias="dailyLookbackDays", ge=1, le=30)
    request_delay_seconds: float = Field(default=1.0, alias="requestDelaySeconds", ge=0.2, le=10)
    max_requests_per_second: float = Field(default=2.0, alias="maxRequestsPerSecond", ge=0.2, le=10)
    scrape_concurrency: int = Field(default=4, alias="scrapeConcurrency", ge=1, le=8)
    request_timeout_seconds: float = Field(default=60, alias="requestTimeoutSeconds", ge=10, le=180)
    closing_soon_days: int = Field(default=7, alias="closingSoonDays", ge=1, le=30)
    default_page_size: int = Field(default=20, alias="defaultPageSize", ge=5, le=100)
    account_managers: list[str] = Field(default_factory=list, alias="accountManagers")
    solution_managers: list[str] = Field(default_factory=list, alias="solutionManagers")

    @field_validator("schedule_time")
    @classmethod
    def _valid_time(cls, value: str) -> str:
        parts = value.split(":")
        if len(parts) != 2:
            raise ValueError("scheduleTime must be HH:MM")
        hour, minute = int(parts[0]), int(parts[1])
        if not (0 <= hour <= 23 and 0 <= minute <= 59):
            raise ValueError("scheduleTime must be a valid 24-hour time")
        return f"{hour:02d}:{minute:02d}"

    @field_validator("schedule_days")
    @classmethod
    def _valid_days(cls, value: list[str]) -> list[str]:
        seen: list[str] = []
        for day in value:
            key = day.strip().lower()[:3]
            if key not in WEEKDAYS:
                raise ValueError(f"Unknown weekday: {day}")
            if key not in seen:
                seen.append(key)
        return seen

    @field_validator("account_managers", "solution_managers")
    @classmethod
    def _valid_people(cls, value: list[str]) -> list[str]:
        return _clean_names(value)


class SettingsPayload(AppSettings):
    next_scheduled_at: str | None = Field(default=None, alias="nextScheduledAt")
    task_status: TaskStatus = Field(default_factory=TaskStatus, alias="taskStatus")


def settings_path() -> Path:
    return config.DATA_DIR / "settings.json"


def default_settings() -> AppSettings:
    return AppSettings()


def load_settings() -> AppSettings:
    global _cache
    with _lock:
        if _cache is not None:
            return _cache.model_copy(deep=True)
        path = settings_path()
        if path.exists():
            try:
                raw = json.loads(path.read_text(encoding="utf-8"))
                _cache = AppSettings.model_validate(raw)
            except Exception:
                log.exception("Failed to read %s; using defaults", path)
                _cache = default_settings()
        else:
            _cache = default_settings()
        return _cache.model_copy(deep=True)


def save_settings(settings: AppSettings) -> AppSettings:
    global _cache
    config.ensure_dirs()
    path = settings_path()
    payload = settings.model_dump(by_alias=True)
    with _lock:
        path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
        _cache = settings.model_copy(deep=True)
    apply_to_config(settings)
    return settings.model_copy(deep=True)


def apply_to_config(settings: AppSettings | None = None) -> AppSettings:
    """Push saved settings onto the live config module."""
    current = settings or load_settings()
    config.REQUEST_DELAY_SECONDS = current.request_delay_seconds
    config.MAX_REQUESTS_PER_SECOND = current.max_requests_per_second
    config.SCRAPE_CONCURRENCY = max(1, current.scrape_concurrency)
    config.REQUEST_TIMEOUT_SECONDS = current.request_timeout_seconds
    config.DAILY_LOOKBACK_DAYS = current.daily_lookback_days
    return current


def _as_tbilisi(value: datetime | None = None) -> datetime:
    """Interpret naive datetimes as Tbilisi wall time."""
    if value is None:
        return datetime.now(TBILISI)
    if value.tzinfo is None:
        return value.replace(tzinfo=TBILISI)
    return value.astimezone(TBILISI)


def next_scheduled_at(settings: AppSettings | None = None, now: datetime | None = None) -> datetime | None:
    current = settings or load_settings()
    if not current.schedule_enabled or not current.schedule_days:
        return None
    hour, minute = (int(part) for part in current.schedule_time.split(":"))
    cursor = _as_tbilisi(now)
    for offset in range(0, 8):
        candidate = (cursor + timedelta(days=offset)).replace(
            hour=hour, minute=minute, second=0, microsecond=0
        )
        if candidate <= cursor:
            continue
        weekday = WEEKDAYS[candidate.weekday()]
        if weekday in current.schedule_days:
            return candidate
    return None


def next_scheduled_iso(settings: AppSettings | None = None) -> str | None:
    when = next_scheduled_at(settings)
    return when.isoformat(timespec="seconds") if when else None


def windows_trigger_time(tbilisi_hhmm: str, now: datetime | None = None) -> str:
    """Convert a Tbilisi HH:MM into the Windows machine's local clock time."""
    hour, minute = (int(part) for part in tbilisi_hhmm.split(":"))
    tbilisi_dt = _as_tbilisi(now).replace(hour=hour, minute=minute, second=0, microsecond=0)
    return tbilisi_dt.astimezone().strftime("%H:%M")


def _script_path() -> Any:
    return config.PROJECT_ROOT / "scripts" / "register_task.ps1"


def _run_powershell(args: list[str], timeout: int = 45) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", *args],
        capture_output=True,
        text=True,
        timeout=timeout,
        cwd=str(config.PROJECT_ROOT),
    )


def sync_schedule(settings: AppSettings) -> TaskStatus:
    """Create, update, or remove the Windows scheduled task to match settings."""
    if sys.platform != "win32":
        return TaskStatus(
            registered=False,
            message="Scheduled tasks are only supported on Windows.",
        )

    script = _script_path()
    if not script.exists():
        return TaskStatus(registered=False, message=f"Missing scheduler script: {script}")

    try:
        if not settings.schedule_enabled:
            result = _run_powershell(["-File", str(script), "-Unregister"])
            if result.returncode != 0:
                err = (result.stderr or result.stdout or "Failed to unregister task").strip()
                log.warning("Unregister task failed: %s", err)
                return TaskStatus(registered=False, message=err)
            return TaskStatus(registered=False, message="Schedule is off. The Windows task was removed.")

        if not settings.schedule_days:
            return TaskStatus(registered=False, message="Pick at least one weekday to enable the schedule.")

        days = ",".join(_PS_DAYS[day] for day in settings.schedule_days)
        result = _run_powershell(
            ["-File", str(script), "-Time", windows_trigger_time(settings.schedule_time), "-Days", days]
        )
        if result.returncode != 0:
            err = (result.stderr or result.stdout or "Failed to register task").strip()
            log.warning("Register task failed: %s", err)
            return TaskStatus(registered=False, message=err)
        status = inspect_task()
        if not status.message:
            status.message = (result.stdout or "").strip() or "Windows task updated."
        return status
    except FileNotFoundError:
        return TaskStatus(registered=False, message="PowerShell was not found on this machine.")
    except subprocess.TimeoutExpired:
        return TaskStatus(registered=False, message="Timed out talking to Task Scheduler.")
    except Exception as exc:
        log.exception("Failed syncing scheduled task")
        return TaskStatus(registered=False, message=str(exc))


def inspect_task() -> TaskStatus:
    if sys.platform != "win32":
        return TaskStatus(
            registered=False,
            message="Scheduled tasks are only supported on Windows.",
        )
    script = (
        "$ErrorActionPreference='Stop';"
        f"$name='{TASK_NAME}';"
        "$task=Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue;"
        "if (-not $task) { @{ registered=$false; taskName=$name } | ConvertTo-Json -Compress; exit 0 };"
        "$info=Get-ScheduledTaskInfo -TaskName $name;"
        "$last=$null; if ($info.LastRunTime -and $info.LastRunTime.Year -gt 2000) {"
        "  $last=$info.LastRunTime.ToString('s')"
        "};"
        "@{ registered=$true; taskName=$name; state=[string]$task.State;"
        "   lastRunAt=$last; lastTaskResult=[int]$info.LastTaskResult } | ConvertTo-Json -Compress"
    )
    try:
        result = _run_powershell(["-Command", script])
        if result.returncode != 0:
            err = (result.stderr or result.stdout or "Could not query Task Scheduler").strip()
            return TaskStatus(registered=False, message=err)
        raw = json.loads(result.stdout.strip() or "{}")
        last_run = raw.get("lastRunAt")
        if last_run:
            try:
                parsed = datetime.fromisoformat(str(last_run))
                if parsed.tzinfo is None:
                    parsed = parsed.replace(tzinfo=datetime.now().astimezone().tzinfo)
                last_run = parsed.astimezone(TBILISI).isoformat(timespec="seconds")
            except ValueError:
                pass
        return TaskStatus.model_validate(
            {
                "registered": bool(raw.get("registered")),
                "taskName": raw.get("taskName") or TASK_NAME,
                "state": raw.get("state"),
                "lastRunAt": last_run,
                "lastTaskResult": raw.get("lastTaskResult"),
            }
        )
    except Exception as exc:
        log.warning("Could not inspect scheduled task: %s", exc)
        return TaskStatus(registered=False, message=str(exc))


def to_payload(settings: AppSettings | None = None, task_status: TaskStatus | None = None) -> SettingsPayload:
    current = settings or load_settings()
    return SettingsPayload(
        **current.model_dump(),
        next_scheduled_at=next_scheduled_iso(current),
        task_status=task_status if task_status is not None else inspect_task(),
    )


def update_settings(patch: dict[str, Any]) -> SettingsPayload:
    current = load_settings()
    incoming = {**current.model_dump(by_alias=True), **patch}
    updated = AppSettings.model_validate(incoming)
    if updated.schedule_enabled and not updated.schedule_days:
        raise ValueError("Pick at least one weekday to enable the schedule.")
    saved = save_settings(updated)
    status = sync_schedule(saved)
    return to_payload(saved, status)
