from datetime import datetime, timezone

from tender_scraper.settings import TBILISI, AppSettings, next_scheduled_at, windows_trigger_time


def test_next_run_is_tbilisi_offset():
    settings = AppSettings(
        scheduleEnabled=True,
        scheduleTime="21:00",
        scheduleDays=["sat"],
    )
    now = datetime(2026, 8, 22, 15, 0, tzinfo=TBILISI)  # Saturday afternoon
    nxt = next_scheduled_at(settings, now)
    assert nxt is not None
    assert nxt.tzinfo == TBILISI
    assert nxt.isoformat(timespec="seconds") == "2026-08-22T21:00:00+04:00"


def test_next_run_skips_to_next_tbilisi_weekday():
    settings = AppSettings(
        scheduleEnabled=True,
        scheduleTime="06:00",
        scheduleDays=["mon"],
    )
    now = datetime(2026, 8, 22, 15, 0, tzinfo=TBILISI)  # Saturday
    nxt = next_scheduled_at(settings, now)
    assert nxt is not None
    assert nxt.isoformat(timespec="seconds") == "2026-08-24T06:00:00+04:00"


def test_windows_trigger_matches_tbilisi_when_machine_is_plus_four():
    now = datetime(2026, 8, 22, 15, 0, tzinfo=TBILISI)
    machine_offset = datetime.now().astimezone().utcoffset()
    converted = windows_trigger_time("21:00", now)
    tbilisi_as_local = now.replace(hour=21, minute=0, second=0, microsecond=0).astimezone()
    assert converted == tbilisi_as_local.strftime("%H:%M")
    if machine_offset == TBILISI.utcoffset(None):
        assert converted == "21:00"


def test_aware_utc_now_converts_into_tbilisi_calendar():
    settings = AppSettings(
        scheduleEnabled=True,
        scheduleTime="01:00",
        scheduleDays=["sun"],
    )
    # Saturday 22:00 UTC = Sunday 02:00 Tbilisi, so 01:00 Sunday has already passed.
    now = datetime(2026, 8, 22, 22, 0, tzinfo=timezone.utc)
    nxt = next_scheduled_at(settings, now)
    assert nxt is not None
    assert nxt.isoformat(timespec="seconds") == "2026-08-30T01:00:00+04:00"
