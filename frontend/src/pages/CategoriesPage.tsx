import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { format, subDays, subYears } from 'date-fns'
import { Plus, RefreshCw, RotateCcw, Trash2 } from 'lucide-react'
import { api } from '../api'
import type { TrackedCategory } from '../api'
import { Card, ErrorState, LoadingState, PageHeader } from '../components/ui'
import { errorMessage } from '../lib/errors'
import { formatDateTime } from '../lib/format'

function defaultBackfillFrom(): string {
  return format(subYears(new Date(), 1), 'yyyy-MM-dd')
}

function toDateInput(d: Date): string {
  return format(d, 'yyyy-MM-dd')
}

export function CategoriesPage() {
  return (
    <div>
      <PageHeader
        title="Tracked categories"
        subtitle="Tenders and market research keep separate CPV lists, so you can scrape them independently"
      />
      <TrackedCategorySection kind="tender" heading="Tenders" />
      <div style={{ height: 32 }} />
      <TrackedCategorySection kind="mrs" heading="Market research" />
    </div>
  )
}

function TrackedCategorySection({ kind, heading }: { kind: 'tender' | 'mrs'; heading: string }) {
  const qc = useQueryClient()
  const [pickerOpen, setPickerOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [backfillTarget, setBackfillTarget] = useState<TrackedCategory | null>(null)
  const [backfillFrom, setBackfillFrom] = useState(defaultBackfillFrom)

  const trackedQuery = useQuery({
    queryKey: ['tracked', kind],
    queryFn: () => api.getTrackedCategories(kind),
  })
  const allQuery = useQuery({
    queryKey: ['all-categories'],
    queryFn: () => api.getAllCategories(),
    enabled: pickerOpen,
  })

  const addMutation = useMutation({
    mutationFn: (id: number) => api.addTrackedCategory(id, kind),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tracked', kind] })
      qc.invalidateQueries({ queryKey: ['filter-options'] })
      qc.invalidateQueries({ queryKey: ['stats'] })
      setPickerOpen(false)
      setQuery('')
    },
  })

  const removeMutation = useMutation({
    mutationFn: (id: number) => api.removeTrackedCategory(id, kind),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tracked', kind] })
      qc.invalidateQueries({ queryKey: ['filter-options'] })
      qc.invalidateQueries({ queryKey: ['stats'] })
    },
  })

  const backfillMutation = useMutation({
    mutationFn: ({ id, dateFrom }: { id: number; dateFrom: string }) =>
      api.triggerBackfill(id, { dateFrom, kind }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tracked', kind] })
      qc.invalidateQueries({ queryKey: ['runs'] })
      void qc.refetchQueries({ queryKey: ['runs'] })
      setBackfillTarget(null)
      setBackfillFrom(defaultBackfillFrom())
    },
  })

  const rescrapeMutation = useMutation({
    mutationFn: (id: number) => api.triggerRescrape(id, kind),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tracked', kind] })
      qc.invalidateQueries({ queryKey: ['runs'] })
      void qc.refetchQueries({ queryKey: ['runs'] })
    },
  })

  const trackedIds = useMemo(
    () => new Set((trackedQuery.data ?? []).map((c) => c.id)),
    [trackedQuery.data],
  )

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return (allQuery.data ?? [])
      .filter((c) => !trackedIds.has(c.id))
      .filter((c) => !q || c.code.includes(q) || c.name.toLowerCase().includes(q))
      .slice(0, 40)
  }, [allQuery.data, query, trackedIds])

  const today = format(new Date(), 'yyyy-MM-dd')
  const canStartBackfill = Boolean(backfillFrom) && backfillFrom <= today
  const scrapeBusy = backfillMutation.isPending || rescrapeMutation.isPending

  return (
    <div>
      <PageHeader
        title={heading}
        subtitle={
          kind === 'mrs'
            ? 'CPV categories scraped from the portal’s Market research (MRS) search'
            : 'CPV categories scraped from the portal’s procurement tenders search'
        }
        actions={
          <button type="button" onClick={() => setPickerOpen((v) => !v)} className="primary-button">
            <Plus size={16} /> Add category
          </button>
        }
      />

      {pickerOpen && (
        <div style={{ marginBottom: 24 }}>
          <Card title="Add CPV category" className="filter-panel">
            <input
              autoFocus
              className="field-input"
              style={{ marginBottom: 12 }}
              placeholder="Search by code or name…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            {allQuery.isLoading && <LoadingState />}
            {allQuery.error && <ErrorState message={errorMessage(allQuery.error, 'Failed to load categories')} />}
            <div className="picker-list">
              {filtered.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => addMutation.mutate(c.id)}
                  className="picker-item"
                >
                  <span>
                    <span className="code">{c.code}</span>
                    <span className="name">{c.name}</span>
                  </span>
                  <span className="action">Add</span>
                </button>
              ))}
              {!allQuery.isLoading && filtered.length === 0 && (
                <div className="empty-state" style={{ minHeight: 100, border: 0 }}>
                  No matching categories.
                </div>
              )}
            </div>
          </Card>
        </div>
      )}

      {trackedQuery.isLoading && <LoadingState />}
      {trackedQuery.error && <ErrorState message={errorMessage(trackedQuery.error, 'Failed to load tracked categories')} />}
      {rescrapeMutation.isError && (
        <div style={{ marginBottom: 12, fontSize: 12, color: 'var(--danger)' }}>
          {errorMessage(rescrapeMutation.error, 'Failed to start rescrape')}
        </div>
      )}

      {trackedQuery.data && (
        <div className="category-grid">
          {trackedQuery.data.map((c) => (
            <div key={c.id} className="category-card">
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start' }}>
                <div>
                  <div className="code">{c.code}</div>
                  <h3>{c.name}</h3>
                </div>
                <span className={`status-pill ${c.enabled ? 'success' : 'neutral'}`}>
                  {c.enabled ? 'Enabled' : 'Disabled'}
                </span>
              </div>
              <dl className="two-col" style={{ marginTop: 16 }}>
                <div>
                  <dt className="meta-label">{kind === 'mrs' ? 'MRS' : 'Tenders'}</dt>
                  <dd style={{ margin: '4px 0 0', fontWeight: 700 }}>{c.tenderCount}</dd>
                </div>
                <div>
                  <dt className="meta-label">Last scraped</dt>
                  <dd style={{ margin: '4px 0 0', fontWeight: 600, fontSize: 13 }}>
                    {formatDateTime(c.lastScrapedAt)}
                  </dd>
                </div>
              </dl>
              <div className="category-actions">
                <button
                  type="button"
                  onClick={() => {
                    setBackfillFrom(defaultBackfillFrom())
                    setBackfillTarget(c)
                  }}
                  disabled={scrapeBusy}
                  className="secondary-button"
                  style={{ flex: 1 }}
                >
                  <RefreshCw size={16} /> Backfill
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (
                      confirm(
                        `Rescrape every ${kind === 'mrs' ? 'market research listing' : 'tender'} in ${c.code} from scratch? Existing rows will be fetched again, not skipped. This can take a long time.`,
                      )
                    ) {
                      rescrapeMutation.mutate(c.id)
                    }
                  }}
                  disabled={scrapeBusy}
                  className="secondary-button"
                  style={{ flex: 1 }}
                >
                  <RotateCcw size={16} /> {rescrapeMutation.isPending ? 'Starting…' : 'Rescrape'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (confirm(`Stop tracking ${c.code}?`)) removeMutation.mutate(c.id)
                  }}
                  className="danger-button"
                  aria-label="Remove"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {backfillTarget && (
        <div
          className="modal-backdrop"
          onClick={() => {
            if (!backfillMutation.isPending) setBackfillTarget(null)
          }}
        >
          <div
            className="modal-panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby="backfill-dialog-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="backfill-dialog-title">Backfill {backfillTarget.code}</h2>
            <p className="muted" style={{ marginTop: 6, fontSize: 13 }}>
              Choose the start date. {kind === 'mrs' ? 'Market research listings' : 'Tenders'} will be scraped from that day through today for{' '}
              <strong>{backfillTarget.name}</strong>.
            </p>
            <label className="meta-label" style={{ display: 'block', marginTop: 16 }} htmlFor="backfill-from">
              Backfill from
            </label>
            <input
              id="backfill-from"
              type="date"
              className="field-input"
              style={{ marginTop: 6, width: '100%' }}
              value={backfillFrom}
              max={today}
              onChange={(e) => setBackfillFrom(e.target.value)}
              autoFocus
            />
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
              {[
                { label: '30 days', date: toDateInput(subDays(new Date(), 30)) },
                { label: '90 days', date: toDateInput(subDays(new Date(), 90)) },
                { label: '1 year', date: defaultBackfillFrom() },
                { label: '2 years', date: toDateInput(subYears(new Date(), 2)) },
              ].map((preset) => (
                <button
                  key={preset.label}
                  type="button"
                  className="chip-button"
                  onClick={() => setBackfillFrom(preset.date)}
                >
                  {preset.label}
                </button>
              ))}
            </div>
            {backfillMutation.isError && (
              <div style={{ marginTop: 10, fontSize: 12, color: 'var(--danger)' }}>
                {errorMessage(backfillMutation.error, 'Failed to start backfill')}
              </div>
            )}
            <div className="modal-actions">
              <button
                type="button"
                className="secondary-button"
                disabled={backfillMutation.isPending}
                onClick={() => setBackfillTarget(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="primary-button"
                disabled={!canStartBackfill || backfillMutation.isPending}
                onClick={() =>
                  backfillMutation.mutate({ id: backfillTarget.id, dateFrom: backfillFrom })
                }
              >
                <RefreshCw size={16} />
                {backfillMutation.isPending ? 'Starting…' : 'Start backfill'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
