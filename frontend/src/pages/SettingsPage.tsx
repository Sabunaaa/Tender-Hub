import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { AlarmClock, Check, Play, Plus, RotateCcw, Save, X } from 'lucide-react'
import { api, isMockMode } from '../api'
import type { Weekday } from '../api'
import { ErrorState, LoadingState } from '../components/ui'
import { errorMessage } from '../lib/errors'
import { formatDateTime } from '../lib/format'
import { isSettingsSliceDirty, pickSettings, useSettingsDraft } from '../lib/useSettingsDraft'

const WEEKDAYS: { id: Weekday; label: string; short: string }[] = [
  { id: 'mon', label: 'Monday', short: 'Mon' },
  { id: 'tue', label: 'Tuesday', short: 'Tue' },
  { id: 'wed', label: 'Wednesday', short: 'Wed' },
  { id: 'thu', label: 'Thursday', short: 'Thu' },
  { id: 'fri', label: 'Friday', short: 'Fri' },
  { id: 'sat', label: 'Saturday', short: 'Sat' },
  { id: 'sun', label: 'Sunday', short: 'Sun' },
]

const TIME_PRESETS = ['06:00', '08:00', '12:00', '18:00', '21:00'] as const

const MAX_TIMES = 6

const GENERAL_KEYS = [
  'scheduleEnabled',
  'scheduleTimes',
  'scheduleDays',
  'closingSoonDays',
  'defaultPageSize',
] as const

function describeDays(days: Weekday[]): string {
  if (days.length === 7) return 'Every day'
  if (days.length === 5 && !days.includes('sat') && !days.includes('sun')) return 'Weekdays'
  if (days.length === 2 && days.includes('sat') && days.includes('sun')) return 'Weekends'
  if (days.length === 0) return 'No days selected'
  return WEEKDAYS.filter((d) => days.includes(d.id))
    .map((d) => d.short)
    .join(', ')
}

export function SettingsPage() {
  const qc = useQueryClient()
  const {
    settingsQuery,
    draft,
    serverDraft,
    saved,
    patch,
    reset,
    saveMutation,
    savedFlash,
  } = useSettingsDraft()

  const runNowMutation = useMutation({
    mutationFn: () => api.triggerDailyScrape(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['runs'] })
      qc.invalidateQueries({ queryKey: ['stats'] })
    },
  })

  const [newTime, setNewTime] = useState('18:00')

  const toggleDay = (day: Weekday) => {
    if (!draft) return
    const next = draft.scheduleDays.includes(day)
      ? draft.scheduleDays.filter((item) => item !== day)
      : [...draft.scheduleDays, day]
    patch({ scheduleDays: WEEKDAYS.map((item) => item.id).filter((id) => next.includes(id)) })
  }

  // Kept sorted and unique so the draft matches what the backend stores.
  const setTimes = (next: string[]) => {
    patch({ scheduleTimes: [...new Set(next.filter(Boolean))].sort().slice(0, MAX_TIMES) })
  }

  const toggleTime = (time: string) => {
    if (!draft) return
    setTimes(
      draft.scheduleTimes.includes(time)
        ? draft.scheduleTimes.filter((item) => item !== time)
        : [...draft.scheduleTimes, time],
    )
  }

  if (settingsQuery.isLoading && !draft) return <LoadingState label="Loading settings…" />
  if (settingsQuery.error && !draft) {
    return <ErrorState message={errorMessage(settingsQuery.error, 'Failed to load settings')} />
  }
  if (!draft || !serverDraft) return <LoadingState label="Loading settings…" />

  const dirty = isSettingsSliceDirty(draft, serverDraft, GENERAL_KEYS)
  const save = () => saveMutation.mutate(pickSettings(draft, GENERAL_KEYS))
  const times = draft.scheduleTimes
  const [hour = '06', minute = '00'] = (times[0] ?? '06:00').split(':')
  const clock = { hour, minute }
  const canEnable = draft.scheduleDays.length > 0 && times.length > 0
  const task = saved?.taskStatus
  const saveDisabled = saveMutation.isPending || (draft.scheduleEnabled && !canEnable)

  return (
    <div className="settings-page">
      <div className="settings-intro">
        <div>
          <p className="eyebrow">Control room</p>
          <h2>General</h2>
          <p>Pick the scrape clock and decide how the dashboard behaves.</p>
        </div>
        <div className="settings-intro-actions">
          <button
            type="button"
            className="secondary-button"
            disabled={!dirty || saveMutation.isPending}
            onClick={reset}
          >
            <RotateCcw size={15} /> Reset
          </button>
          <button
            type="button"
            className="primary-button"
            disabled={!dirty || saveDisabled}
            onClick={save}
          >
            <Save size={15} />
            {saveMutation.isPending ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </div>

      {saveMutation.isError && (
        <ErrorState message={errorMessage(saveMutation.error, 'Could not save settings')} />
      )}
      {savedFlash && !saveMutation.isError && (
        <div className="alert-box settings-saved">
          <Check size={14} /> Settings saved
          {task?.message ? ` — ${task.message}` : ''}
        </div>
      )}

      <section className="settings-schedule">
        <div className="settings-schedule-copy">
          <span className="settings-kicker">
            <AlarmClock size={14} /> Automatic scrape
          </span>
          <h3>Run it whenever you want.</h3>
          <p>
            Choose the days and one or more Tbilisi times (GMT+4) — add a second time to scrape twice a day. On
            Windows, Tender Hub writes a scheduled task{isMockMode ? ' (simulated in demo mode)' : ''} so a run can
            start even when the dashboard is closed; on a server the app runs the schedule itself.
          </p>

          <label className="settings-toggle">
            <input
              type="checkbox"
              checked={draft.scheduleEnabled}
              onChange={(e) => patch({ scheduleEnabled: e.target.checked })}
            />
            <span className="settings-toggle-ui" aria-hidden="true" />
            <span>
              <strong>{draft.scheduleEnabled ? 'Schedule on' : 'Schedule off'}</strong>
              <small>
                {draft.scheduleEnabled
                  ? `${describeDays(draft.scheduleDays)} at ${times.join(', ') || 'no time set'}`
                  : 'The scheduled task stays unregistered until you turn this on and save.'}
              </small>
            </span>
          </label>

          <div className="settings-day-row" role="group" aria-label="Days of the week">
            {WEEKDAYS.map((day) => {
              const active = draft.scheduleDays.includes(day.id)
              return (
                <button
                  key={day.id}
                  type="button"
                  className={`settings-day${active ? ' active' : ''}`}
                  aria-pressed={active}
                  onClick={() => toggleDay(day.id)}
                >
                  {day.short}
                </button>
              )
            })}
          </div>
          <div className="settings-day-shortcuts">
            <button type="button" className="chip-button" onClick={() => patch({ scheduleDays: [...WEEKDAYS.map((d) => d.id)] })}>
              Every day
            </button>
            <button
              type="button"
              className="chip-button"
              onClick={() => patch({ scheduleDays: ['mon', 'tue', 'wed', 'thu', 'fri'] })}
            >
              Weekdays
            </button>
            <button type="button" className="chip-button" onClick={() => patch({ scheduleDays: ['sat', 'sun'] })}>
              Weekends
            </button>
          </div>
          {draft.scheduleEnabled && !canEnable && (
            <p className="settings-warning">Select at least one day before turning the schedule on.</p>
          )}
        </div>

        <div className="settings-clock-card">
          <div className="settings-clock">
            <span>{clock.hour}</span>
            <i>:</i>
            <span>{clock.minute}</span>
          </div>
          <p className="settings-tz-hint">Times are Georgia Standard Time — Tbilisi, GMT+4. No daylight saving.</p>

          <div className="settings-time-list" role="group" aria-label="Times of day">
            {times.length === 0 ? (
              <p className="settings-warning">Add at least one time of day.</p>
            ) : (
              times.map((time) => (
                <span key={time} className="settings-time-chip">
                  {time}
                  <button
                    type="button"
                    aria-label={`Remove ${time}`}
                    onClick={() => toggleTime(time)}
                    disabled={times.length === 1}
                    title={times.length === 1 ? 'Keep at least one time' : `Remove ${time}`}
                  >
                    <X size={12} />
                  </button>
                </span>
              ))
            )}
          </div>

          <label className="settings-time-label">
            Add a time · Tbilisi GMT+4
            <span className="settings-time-add">
              <input
                type="time"
                className="field-input settings-time-input"
                value={newTime}
                onChange={(e) => setNewTime(e.target.value || '18:00')}
              />
              <button
                type="button"
                className="secondary-button"
                onClick={() => setTimes([...times, newTime])}
                disabled={times.length >= MAX_TIMES || times.includes(newTime)}
                title={times.includes(newTime) ? 'Already scheduled' : 'Add this time'}
              >
                <Plus size={14} />
                Add
              </button>
            </span>
          </label>

          <div className="settings-time-presets">
            {TIME_PRESETS.map((time) => (
              <button
                key={time}
                type="button"
                className={`chip-button${times.includes(time) ? ' active' : ''}`}
                aria-pressed={times.includes(time)}
                onClick={() => toggleTime(time)}
                disabled={!times.includes(time) && times.length >= MAX_TIMES}
              >
                {time}
              </button>
            ))}
          </div>
          <dl className="settings-clock-meta">
            <div>
              <dt>Next run</dt>
              <dd>
                {draft.scheduleEnabled && canEnable
                  ? dirty
                    ? 'Save to confirm the new time'
                    : formatDateTime(saved?.nextScheduledAt)
                  : 'Not scheduled'}
              </dd>
            </div>
            <div>
              <dt>{task?.taskName === 'In-app scheduler' ? 'Scheduler' : 'Windows task'}</dt>
              <dd>
                {task?.registered
                  ? `${task.state ?? 'Registered'}${task.lastRunAt ? ` · last ${formatDateTime(task.lastRunAt)}` : ''}`
                  : 'Not registered'}
              </dd>
            </div>
          </dl>
          <button
            type="button"
            className="secondary-button settings-run-now"
            disabled={runNowMutation.isPending}
            onClick={() => runNowMutation.mutate()}
          >
            <Play size={15} />
            {runNowMutation.isPending ? 'Starting…' : 'Run scrape now'}
          </button>
          {runNowMutation.isError && (
            <p className="settings-warning">{errorMessage(runNowMutation.error, 'Could not start scrape')}</p>
          )}
          {runNowMutation.isSuccess && (
            <p className="settings-ok">
              Daily scrape started.{' '}
              <Link to="/settings/scraper">Watch progress</Link>
            </p>
          )}
        </div>
      </section>

      <section className="settings-grid">
        <article className="settings-card" style={{ gridColumn: '1 / -1' }}>
          <header>
            <AlarmClock size={18} />
            <div>
              <p className="eyebrow">Dashboard</p>
              <h3>What the UI emphasises</h3>
            </div>
          </header>
          <p className="muted">These change the dashboard “closing soon” window and the explorer page size.</p>
          <div className="two-col">
            <label>
              <span className="filter-label">Closing-soon window (days)</span>
              <input
                type="number"
                min={1}
                max={30}
                className="field-input"
                value={draft.closingSoonDays}
                onChange={(e) => patch({ closingSoonDays: Number(e.target.value) || 1 })}
              />
              <small>Used for the dashboard KPI, chart of upcoming deadlines, and closing-soon table.</small>
            </label>
            <label>
              <span className="filter-label">Default tenders per page</span>
              <select
                className="field-input"
                value={draft.defaultPageSize}
                onChange={(e) => patch({ defaultPageSize: Number(e.target.value) })}
              >
                {[10, 20, 30, 50, 100].map((size) => (
                  <option key={size} value={size}>
                    {size}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </article>
      </section>

      {dirty && (
        <div className="settings-savebar">
          <span>Unsaved schedule and preference changes</span>
          <button type="button" className="primary-button" disabled={saveDisabled} onClick={save}>
            <Save size={15} /> Save now
          </button>
        </div>
      )}
    </div>
  )
}
