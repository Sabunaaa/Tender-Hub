from datetime import datetime, timezone

import pytest

from tender_scraper.settings import (
    TBILISI,
    AppSettings,
    _migrate,
    next_scheduled_at,
    windows_trigger_time,
    windows_trigger_times,
)


def test_next_run_is_tbilisi_offset():
    settings = AppSettings(
        scheduleEnabled=True,
        scheduleTimes=["21:00"],
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
        scheduleTimes=["06:00"],
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
        scheduleTimes=["01:00"],
        scheduleDays=["sun"],
    )
    # Saturday 22:00 UTC = Sunday 02:00 Tbilisi, so 01:00 Sunday has already passed.
    now = datetime(2026, 8, 22, 22, 0, tzinfo=timezone.utc)
    nxt = next_scheduled_at(settings, now)
    assert nxt is not None
    assert nxt.isoformat(timespec="seconds") == "2026-08-30T01:00:00+04:00"


def test_next_run_picks_the_soonest_of_several_times():
    settings = AppSettings(
        scheduleEnabled=True,
        scheduleTimes=["18:00", "06:00"],
        scheduleDays=["sat", "sun"],
    )
    saturday_morning = datetime(2026, 8, 22, 5, 0, tzinfo=TBILISI)
    saturday_midday = datetime(2026, 8, 22, 12, 0, tzinfo=TBILISI)
    saturday_night = datetime(2026, 8, 22, 20, 0, tzinfo=TBILISI)

    assert next_scheduled_at(settings, saturday_morning).isoformat(timespec="seconds") == (
        "2026-08-22T06:00:00+04:00"
    )
    assert next_scheduled_at(settings, saturday_midday).isoformat(timespec="seconds") == (
        "2026-08-22T18:00:00+04:00"
    )
    # Past the last slot, so it rolls to the first slot on the next enabled day.
    assert next_scheduled_at(settings, saturday_night).isoformat(timespec="seconds") == (
        "2026-08-23T06:00:00+04:00"
    )


def test_times_are_sorted_deduplicated_and_capped():
    settings = AppSettings(scheduleTimes=["18:00", "06:00", "06:00"])
    assert settings.schedule_times == ["06:00", "18:00"]

    with pytest.raises(ValueError):
        AppSettings(scheduleTimes=["25:00"])
    with pytest.raises(ValueError):
        AppSettings(scheduleTimes=[f"{h:02d}:00" for h in range(7)])


def test_legacy_single_time_setting_is_migrated():
    assert _migrate({"scheduleTime": "07:30"})["scheduleTimes"] == ["07:30"]
    # An explicit list wins over the legacy key.
    migrated = _migrate({"scheduleTime": "07:30", "scheduleTimes": ["09:00"]})
    assert migrated["scheduleTimes"] == ["09:00"]
    assert "scheduleTime" not in migrated


def test_legacy_time_in_a_patch_still_updates_the_schedule(tmp_path, monkeypatch):
    import tender_scraper.settings as settings_module

    monkeypatch.setattr(settings_module, "settings_path", lambda: tmp_path / "settings.json")
    monkeypatch.setattr(settings_module, "_cache", None)
    monkeypatch.setattr(settings_module, "sync_schedule", lambda *_a, **_k: None)

    saved = settings_module.update_settings({"scheduleTime": "07:15"})
    assert saved.schedule_times == ["07:15"]


def test_windows_trigger_times_converts_every_entry():
    now = datetime(2026, 8, 22, 15, 0, tzinfo=TBILISI)
    assert windows_trigger_times(["06:00", "18:00"], now) == [
        windows_trigger_time("06:00", now),
        windows_trigger_time("18:00", now),
    ]
