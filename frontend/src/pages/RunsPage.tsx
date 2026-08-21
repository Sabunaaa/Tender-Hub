import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Play, Square } from 'lucide-react'
import { api } from '../api'
import { runsQueryOptions } from '../api/runsQuery'
import { Card, ErrorState, LoadingState, PageHeader } from '../components/ui'
import { formatDateTime } from '../lib/format'

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

  if (isLoading) return <LoadingState label="Loading scrape health…" />
  if (error || !data) return <ErrorState message={(error as Error)?.message ?? 'Failed to load runs'} />

  const active = data.activeRun

  return (
    <div>
      <PageHeader
        title="Scrape health"
        subtitle="Daily job history and next scheduled run"
      />

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
              {(stopMutation.error as Error)?.message ?? 'Failed to stop scrape'}
            </div>
          )}
        </Card>
      )}

      <div className="stat-grid" style={{ gridTemplateColumns: '1fr 1fr', marginBottom: 18 }}>
        <Card>
          <div className="meta-label">Next scheduled run</div>
          <div style={{ marginTop: 8, fontSize: 20, fontWeight: 700 }}>{formatDateTime(data.nextScheduledAt)}</div>
          <div className="muted" style={{ marginTop: 4 }}>Windows Task Scheduler (daily)</div>
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
    </div>
  )
}
