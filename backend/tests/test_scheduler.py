from datetime import datetime, timedelta

from tender_scraper.scheduler import due_times
from tender_scraper.settings import TBILISI, AppSettings

SETTINGS = AppSettings(
    scheduleEnabled=True,
    scheduleTimes=["06:00", "18:00"],
    scheduleDays=["sat"],
)


def tick(when: str, gap_seconds: int = 30) -> tuple[datetime, datetime]:
    hour, minute, second = (int(p) for p in when.split(":"))
    now = datetime(2026, 8, 22, hour, minute, second, tzinfo=TBILISI)  # Saturday
    return now - timedelta(seconds=gap_seconds), now


def test_fires_once_the_scheduled_minute_is_reached():
    previous, now = tick("06:00:10")
    assert due_times(now, previous, SETTINGS) is True


def test_does_not_fire_between_scheduled_times():
    previous, now = tick("12:00:00")
    assert due_times(now, previous, SETTINGS) is False


def test_fires_again_at_the_second_time_of_day():
    previous, now = tick("18:00:05")
    assert due_times(now, previous, SETTINGS) is True


def test_does_not_refire_on_the_following_tick():
    _, fired_at = tick("06:00:10")
    later = fired_at + timedelta(seconds=30)
    assert due_times(later, fired_at, SETTINGS) is False


def test_silent_when_disabled_or_unconfigured():
    previous, now = tick("06:00:10")
    assert due_times(now, previous, SETTINGS.model_copy(update={"schedule_enabled": False})) is False
    assert due_times(now, previous, SETTINGS.model_copy(update={"schedule_days": []})) is False
    assert due_times(now, previous, SETTINGS.model_copy(update={"schedule_times": []})) is False


def test_skips_days_that_are_not_selected():
    hour, minute = 6, 0
    sunday = datetime(2026, 8, 23, hour, minute, 10, tzinfo=TBILISI)
    assert due_times(sunday, sunday - timedelta(seconds=30), SETTINGS) is False
