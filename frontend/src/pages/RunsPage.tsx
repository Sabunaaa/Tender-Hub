import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, Play, RotateCcw, Save, SlidersHorizontal, Square } from 'lucide-react'
import { api } from '../api'
import { runsQueryOptions } from '../api/runsQuery'
import { Link } from 'react-router-dom'
import { Card, ErrorState, LoadingState, PageHeader } from '../components/ui'
import { errorMessage } from '../lib/errors'
import { formatDateTime } from '../lib/format'
import { isSettingsSliceDirty, pickSettings, useSettingsDraft } from '../lib/useSettingsDraft'

const SCRAPER_KEYS = [
  'dailyLookbackDays',
  'requestDelaySeconds',
  'maxRequestsPerSecond',
  'scrapeConcurrency',
  'requestTimeoutSeconds',
] as const

function runStatusClass(status: string): string {
  switch (status) {
    case 'success':
      return 'success'
    case 'failed':
      return 'danger'
    case 'partial':
    case 'cancelled':
      return 'warning'
    default:
      return 'info'
  }
}

export function RunsPage() {
  const qc = useQueryClient()
  const { data, isLoading, error } = useQuery(runsQueryOptions)

  const stopMutation = useMutation({
    mutationFn: () => api.stopScrape(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['runs'] })
      qc.invalidateQueries({ queryKey: ['stats'] })
      qc.invalidateQueries({ queryKey: ['tracked'] })
    },
  })

  const resumeMutation = useMutation({
    mutationFn: (runId: number) => api.resumeRun(runId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['runs'] })
      void qc.refetchQueries({ queryKey: ['runs'] })
    },
  })

  const {
    settingsQuery,
    draft,
    serverDraft,
    patch,
    reset,
    saveMutation,
    savedFlash,
  } = useSettingsDraft()

  const scraperDirty = Boolean(
    draft && serverDraft && isSettingsSliceDirty(draft, serverDraft, SCRAPER_KEYS),
  )
  const saveScraper = () => {
    if (!draft) return
    saveMutation.mutate(pickSettings(draft, SCRAPER_KEYS))
  }

  if (isLoading) return <LoadingState label="Loading scraper…" />
  if (error || !data) return <ErrorState message={errorMessage(error, 'Failed to load runs')} />

  const active = data.activeRun

  return (
    <div className={scraperDirty ? 'settings-page' : undefined}>
      <PageHeader
        title="Scraper"
        subtitle="Portal load, job history, and next scheduled run"
        actions={
          draft && scraperDirty ? (
            <div className="settings-intro-actions">
              <button type="button" className="secondary-button" disabled={saveMutation.isPending} onClick={reset}>
                <RotateCcw size={15} /> Reset
              </button>
              <button type="button" className="primary-button" disabled={saveMutation.isPending} onClick={saveScraper}>
                <Save size={15} />
                {saveMutation.isPending ? 'Saving…' : 'Save changes'}
              </button>
            </div>
          ) : undefined
        }
      />

      {settingsQuery.error && (
        <ErrorState message={errorMessage(settingsQuery.error, 'Failed to load scraper settings')} />
      )}
      {saveMutation.isError && (
        <ErrorState message={errorMessage(saveMutation.error, 'Could not save scraper settings')} />
      )}
      {savedFlash && !saveMutation.isError && (
        <div className="alert-box settings-saved">
          <Check size={14} /> Settings saved
        </div>
      )}

      {draft && (
        <section className="settings-grid" style={{ marginBottom: 18 }}>
          <article className="settings-card" style={{ gridColumn: '1 / -1' }}>
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
        </section>
      )}

      {active && (
        <Card
          title="Active scrape"
          className="mb-4"
          action={
            <button
              type="button"
              className="danger-button"
              style={{ padding: '8px 12px', fontSize: 12 }}
              disabled={stopMutation.isPending}
              onClick={() => stopMutation.mutate()}
            >
              <Square size={12} fill="currentColor" />
              {stopMutation.isPending ? 'Stopping…' : 'Stop scrape'}
            </button>
          }
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start' }}>
            <div>
              <div style={{ fontWeight: 600, textTransform: 'capitalize' }}>{active.mode} · running</div>
              <div className="muted" style={{ marginTop: 4, fontSize: 12 }}>
                {active.currentCategory ? `Category ${active.currentCategory}` : 'Preparing…'}
                {' · '}
                {active.progressTotal
                  ? `${active.tendersProcessed ?? 0} / ${active.progressTotal} tenders`
                  : `${active.tendersProcessed ?? 0} tenders processed`}
                {(active.tendersSkipped ?? 0) > 0 && ` · ${active.tendersSkipped} unchanged`}
              </div>
            </div>
            <div style={{ fontWeight: 700 }}>{active.progressPercent ?? 0}%</div>
          </div>
          <div
            className="scrape-progress"
            style={{ marginTop: 10, background: 'var(--border, #e5e7eb)' }}
            role="progressbar"
            aria-valuenow={active.progressPercent ?? 0}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <div className="scrape-progress-fill" style={{ width: `${active.progressPercent ?? 0}%` }} />
          </div>
          {stopMutation.isError && (
            <div className="muted" style={{ marginTop: 8, fontSize: 12, color: 'var(--danger)' }}>
              {errorMessage(stopMutation.error, 'Failed to stop scrape')}
            </div>
          )}
        </Card>
      )}

      <div className="stat-grid" style={{ gridTemplateColumns: '1fr 1fr', marginBottom: 18 }}>
        <Card>
          <div className="meta-label">Next scheduled run</div>
          <div style={{ marginTop: 8, fontSize: 20, fontWeight: 700 }}>{formatDateTime(data.nextScheduledAt)}</div>
          <div className="muted" style={{ marginTop: 4 }}>
            {data.nextScheduledAt ? (
              <Link className="text-button" to="/settings">Change in Settings</Link>
            ) : (
              <Link className="text-button" to="/settings">Set a schedule</Link>
            )}
          </div>
        </Card>
        <Card>
          <div className="meta-label">Last successful run</div>
          <div style={{ marginTop: 8, fontSize: 20, fontWeight: 700 }}>{formatDateTime(data.lastSuccessAt)}</div>
        </Card>
      </div>

      <Card title="Run history">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Started</th>
                <th>Finished</th>
                <th>Mode</th>
                <th>Status</th>
                <th>Progress</th>
                <th>Found</th>
                <th>Saved</th>
                <th>Unchanged</th>
                <th>Categories</th>
                <th>Errors</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data.runs.map((run) => (
                <tr key={run.id}>
                  <td style={{ whiteSpace: 'nowrap' }}>{formatDateTime(run.startedAt)}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>{formatDateTime(run.finishedAt)}</td>
                  <td style={{ textTransform: 'capitalize' }}>{run.mode}</td>
                  <td>
                    <span className={`status-pill ${runStatusClass(run.status)}`}>{run.status}</span>
                  </td>
                  <td style={{ whiteSpace: 'nowrap', fontSize: 11 }}>
                    {run.status === 'running' || run.progressPercent != null
                      ? `${run.progressPercent ?? 0}%`
                      : '—'}
                  </td>
                  <td>{run.tendersFound}</td>
                  <td>{run.tendersUpserted}</td>
                  <td>{run.tendersSkipped ?? 0}</td>
                  <td style={{ fontSize: 11 }}>{run.categories.join(', ')}</td>
                  <td style={{ maxWidth: 240, fontSize: 11, color: run.errors.length ? 'var(--danger)' : undefined }}>
                    {run.errors.length ? run.errors.join('; ') : '—'}
                  </td>
                  <td>
                    {run.canResume && !active && (
                      <button
                        type="button"
                        className="chip-button"
                        disabled={resumeMutation.isPending}
                        onClick={() => resumeMutation.mutate(run.id)}
                        title={`Resume from ${run.dateFrom ?? 'start'}`}
                      >
                        <Play size={12} />
                        {resumeMutation.isPending && resumeMutation.variables === run.id
                          ? 'Resuming…'
                          : 'Resume'}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {scraperDirty && (
        <div className="settings-savebar">
          <span>Unsaved scraper settings</span>
          <button type="button" className="primary-button" disabled={saveMutation.isPending} onClick={saveScraper}>
            <Save size={15} /> Save now
          </button>
        </div>
      )}
    </div>
  )
}
