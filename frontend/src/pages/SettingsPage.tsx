import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlarmClock, Check, Play, RotateCcw, Save, SlidersHorizontal } from 'lucide-react'
import { api, isMockMode } from '../api'
import type { AppSettings, SettingsUpdate, Weekday } from '../api'
import { ErrorState, LoadingState } from '../components/ui'
import { errorMessage } from '../lib/errors'
import { formatDateTime } from '../lib/format'

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

type Draft = Omit<AppSettings, 'nextScheduledAt' | 'taskStatus'>

function toDraft(settings: AppSettings): Draft {
  return {
    scheduleEnabled: settings.scheduleEnabled,
    scheduleTime: settings.scheduleTime,
    scheduleDays: [...settings.scheduleDays],
    dailyLookbackDays: settings.dailyLookbackDays,
    requestDelaySeconds: settings.requestDelaySeconds,
    maxRequestsPerSecond: settings.maxRequestsPerSecond,
    scrapeConcurrency: settings.scrapeConcurrency,
    requestTimeoutSeconds: settings.requestTimeoutSeconds,
    closingSoonDays: settings.closingSoonDays,
    defaultPageSize: settings.defaultPageSize,
  }
}

function sameDraft(a: Draft, b: Draft): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

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
  const settingsQuery = useQuery({
    queryKey: ['settings'],
    queryFn: () => api.getSettings(),
  })
  const [draftOverride, setDraftOverride] = useState<Draft | null>(null)
  const [savedFlash, setSavedFlash] = useState(false)
  const serverDraft = settingsQuery.data ? toDraft(settingsQuery.data) : null
  const draft = draftOverride ?? serverDraft

  const dirty = Boolean(draft && serverDraft && !sameDraft(draft, serverDraft))

  const saveMutation = useMutation({
    mutationFn: (patch: SettingsUpdate) => api.updateSettings(patch),
    onSuccess: (saved) => {
      qc.setQueryData(['settings'], saved)
      qc.invalidateQueries({ queryKey: ['runs'] })
      qc.invalidateQueries({ queryKey: ['stats'] })
      setDraftOverride(null)
      setSavedFlash(true)
      window.setTimeout(() => setSavedFlash(false), 2400)
    },
  })

  const runNowMutation = useMutation({
    mutationFn: () => api.triggerDailyScrape(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['runs'] })
      qc.invalidateQueries({ queryKey: ['stats'] })
    },
  })

  const patch = (partial: Partial<Draft>) => {
    setDraftOverride((current) => {
      const base = current ?? serverDraft
      return base ? { ...base, ...partial } : current
    })
  }

  const toggleDay = (day: Weekday) => {
    if (!draft) return
    const next = draft.scheduleDays.includes(day)
      ? draft.scheduleDays.filter((item) => item !== day)
      : [...draft.scheduleDays, day]
    patch({ scheduleDays: WEEKDAYS.map((item) => item.id).filter((id) => next.includes(id)) })
  }

  if (settingsQuery.isLoading && !draft) return <LoadingState label="Loading settings…" />
  if (settingsQuery.error && !draft) {
    return <ErrorState message={errorMessage(settingsQuery.error, 'Failed to load settings')} />
  }
  if (!draft) return <LoadingState label="Loading settings…" />

  const [hour = '06', minute = '00'] = draft.scheduleTime.split(':')
  const clock = { hour, minute }

  const saved = settingsQuery.data
  const canEnable = draft.scheduleDays.length > 0
  const task = saved?.taskStatus

  return (
    <div className="settings-page">
      <div className="settings-intro">
        <div>
          <p className="eyebrow">Control room</p>
          <h2>Settings</h2>
          <p>Pick the scrape clock, tune how hard we hit the portal, and decide how the dashboard behaves.</p>
        </div>
        <div className="settings-intro-actions">
          <button
            type="button"
            className="secondary-button"
            disabled={!dirty || saveMutation.isPending}
            onClick={() => setDraftOverride(null)}
          >
            <RotateCcw size={15} /> Reset
          </button>
          <button
            type="button"
            className="primary-button"
            disabled={!dirty || saveMutation.isPending || (draft.scheduleEnabled && !canEnable)}
            onClick={() => saveMutation.mutate(draft)}
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
            Choose the days and the exact Tbilisi time (GMT+4). Tender Hub writes a Windows scheduled task
            {isMockMode ? ' (simulated in demo mode)' : ''} so the daily scrape can start even if the dashboard is closed.
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
                  ? `${describeDays(draft.scheduleDays)} at ${draft.scheduleTime}`
                  : 'The Windows task stays unregistered until you turn this on and save.'}
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
          <label className="settings-time-label">
            Tbilisi time · GMT+4
            <input
              type="time"
              className="field-input settings-time-input"
              value={draft.scheduleTime}
              onChange={(e) => patch({ scheduleTime: e.target.value || '06:00' })}
            />
          </label>
          <div className="settings-time-presets">
            {TIME_PRESETS.map((time) => (
              <button
                key={time}
                type="button"
                className={`chip-button${draft.scheduleTime === time ? ' active' : ''}`}
                onClick={() => patch({ scheduleTime: time })}
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
              <dt>Windows task</dt>
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
            <p className="settings-ok">Daily scrape started. Watch progress on Scrape Health.</p>
          )}
        </div>
      </section>

      <section className="settings-grid">
        <article className="settings-card">
          <header>
            <SlidersHorizontal size={18} />
            <div>
              <p className="eyebrow">Scraper</p>
              <h3>How hard to hit the portal</h3>
            </div>
          </header>
          <p className="muted">
            These apply to the next scrape. Stay polite — the government server is small.
          </p>
          <label>
            <span className="filter-label">Daily lookback (days)</span>
            <input
              type="number"
              min={1}
              max={30}
              className="field-input"
              value={draft.dailyLookbackDays}
              onChange={(e) => patch({ dailyLookbackDays: Number(e.target.value) || 1 })}
            />
            <small>Each scheduled run re-checks this many trailing days for status changes.</small>
          </label>
          <label>
            <span className="filter-label">Max requests per second · {draft.maxRequestsPerSecond}</span>
            <input
              type="range"
              min={0.2}
              max={5}
              step={0.2}
              value={draft.maxRequestsPerSecond}
              onChange={(e) => patch({ maxRequestsPerSecond: Number(e.target.value) })}
            />
          </label>
          <label>
            <span className="filter-label">Delay between requests (s) · {draft.requestDelaySeconds}</span>
            <input
              type="range"
              min={0.2}
              max={5}
              step={0.2}
              value={draft.requestDelaySeconds}
              onChange={(e) => patch({ requestDelaySeconds: Number(e.target.value) })}
            />
          </label>
          <div className="two-col">
            <label>
              <span className="filter-label">Concurrency</span>
              <input
                type="number"
                min={1}
                max={8}
                className="field-input"
                value={draft.scrapeConcurrency}
                onChange={(e) => patch({ scrapeConcurrency: Number(e.target.value) || 1 })}
              />
            </label>
            <label>
              <span className="filter-label">Timeout (s)</span>
              <input
                type="number"
                min={10}
                max={180}
                className="field-input"
                value={draft.requestTimeoutSeconds}
                onChange={(e) => patch({ requestTimeoutSeconds: Number(e.target.value) || 10 })}
              />
            </label>
          </div>
        </article>

        <article className="settings-card">
          <header>
            <AlarmClock size={18} />
            <div>
              <p className="eyebrow">Dashboard</p>
              <h3>What the UI emphasises</h3>
            </div>
          </header>
          <p className="muted">These change the dashboard “closing soon” window and the explorer page size.</p>
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
        </article>
      </section>

      {dirty && (
        <div className="settings-savebar">
          <span>Unsaved schedule and preference changes</span>
          <button
            type="button"
            className="primary-button"
            disabled={saveMutation.isPending || (draft.scheduleEnabled && !canEnable)}
            onClick={() => saveMutation.mutate(draft)}
          >
            <Save size={15} /> Save now
          </button>
        </div>
      )}
    </div>
  )
}
