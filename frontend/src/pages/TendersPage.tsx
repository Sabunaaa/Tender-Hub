import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { formatISO, subDays } from 'date-fns'
import { api, type TenderFilters } from '../api'
import { Card, ErrorState, LoadingState, PageHeader, StatusBadge } from '../components/ui'
import { formatDate, formatGel, shortCategory } from '../lib/format'

const COLUMN_STORAGE_KEY = 'tender-hub.visible-columns'

const TABLE_COLUMNS = [
  { id: 'number', label: 'Number', required: true },
  { id: 'buyer', label: 'Buyer' },
  { id: 'category', label: 'Category' },
  { id: 'announced', label: 'Announced' },
  { id: 'deadline', label: 'Deadline' },
  { id: 'value', label: 'Value' },
  { id: 'bidders', label: 'Bidders' },
  { id: 'status', label: 'Status' },
] as const

type ColumnId = (typeof TABLE_COLUMNS)[number]['id']

const DEFAULT_COLUMNS: Record<ColumnId, boolean> = {
  number: true,
  buyer: true,
  category: true,
  announced: true,
  deadline: true,
  value: true,
  bidders: true,
  status: true,
}

function loadVisibleColumns(): Record<ColumnId, boolean> {
  try {
    const raw = localStorage.getItem(COLUMN_STORAGE_KEY)
    if (!raw) return { ...DEFAULT_COLUMNS }
    const parsed = JSON.parse(raw) as Partial<Record<ColumnId, boolean>>
    return { ...DEFAULT_COLUMNS, ...parsed, number: true }
  } catch {
    return { ...DEFAULT_COLUMNS }
  }
}

function parseList(value: string | null): string[] | undefined {
  if (!value) return undefined
  return value.split(',').filter(Boolean)
}

function filtersFromParams(params: URLSearchParams): TenderFilters {
  return {
    q: params.get('q') ?? undefined,
    categoryCodes: parseList(params.get('categories')),
    cpvCode: params.get('cpv') ?? undefined,
    status: parseList(params.get('status')),
    procurementType: parseList(params.get('type')),
    buyer: params.get('buyer') ?? undefined,
    dateFrom: params.get('dateFrom') ?? undefined,
    dateTo: params.get('dateTo') ?? undefined,
    deadlineFrom: params.get('deadlineFrom') ?? undefined,
    deadlineTo: params.get('deadlineTo') ?? undefined,
    withinDeadline: params.get('withinDeadline') === '1' ? true : undefined,
    amountFrom: params.get('amountFrom') ? Number(params.get('amountFrom')) : undefined,
    amountTo: params.get('amountTo') ? Number(params.get('amountTo')) : undefined,
    bidderCountMin: params.get('biddersMin') ? Number(params.get('biddersMin')) : undefined,
    bidderCountMax: params.get('biddersMax') ? Number(params.get('biddersMax')) : undefined,
    page: Number(params.get('page') ?? 1),
    pageSize: Number(params.get('pageSize') ?? 20),
    sortBy: (params.get('sortBy') as TenderFilters['sortBy']) ?? 'announcementDate',
    sortDir: (params.get('sortDir') as TenderFilters['sortDir']) ?? 'desc',
  }
}

export function TendersPage() {
  const [params, setParams] = useSearchParams()
  const filters = useMemo(() => filtersFromParams(params), [params])
  const [visibleColumns, setVisibleColumns] = useState<Record<ColumnId, boolean>>(loadVisibleColumns)

  useEffect(() => {
    localStorage.setItem(COLUMN_STORAGE_KEY, JSON.stringify(visibleColumns))
  }, [visibleColumns])

  const toggleColumn = (id: ColumnId) => {
    const col = TABLE_COLUMNS.find((c) => c.id === id)
    if (col && 'required' in col && col.required) return
    setVisibleColumns((prev) => ({ ...prev, [id]: !prev[id] }))
  }

  const optionsQuery = useQuery({ queryKey: ['filter-options'], queryFn: () => api.getFilterOptions() })
  const tendersQuery = useQuery({
    queryKey: ['tenders', filters],
    queryFn: () => api.getTenders(filters),
  })

  const set = (key: string, value: string | null) => {
    const next = new URLSearchParams(params)
    if (!value) next.delete(key)
    else next.set(key, value)
    if (key !== 'page') next.set('page', '1')
    // Manual filter edits clear the date-preset highlight
    if (key !== 'preset' && key !== 'page' && key !== 'sortBy' && key !== 'sortDir') {
      next.delete('preset')
    }
    setParams(next)
  }

  const toggleMulti = (key: string, value: string) => {
    const current = new Set(parseList(params.get(key)) ?? [])
    if (current.has(value)) current.delete(value)
    else current.add(value)
    set(key, current.size ? [...current].join(',') : null)
  }

  const VALUE_THRESHOLDS = {
    under100k: 100_000,
    over100k: 100_000,
    over200k: 200_000,
  } as const

  type ValueQuickFilter = keyof typeof VALUE_THRESHOLDS

  const applyValueQuickFilter = (kind: ValueQuickFilter) => {
    const next = new URLSearchParams(params)
    next.set('page', '1')

    const threshold = VALUE_THRESHOLDS[kind]
    const isUnder = kind.startsWith('under')
    const currentlyActive = isUnder
      ? filters.amountTo === threshold && filters.amountFrom == null
      : filters.amountFrom === threshold && filters.amountTo == null

    if (currentlyActive) {
      next.delete('amountFrom')
      next.delete('amountTo')
    } else if (isUnder) {
      next.delete('amountFrom')
      next.set('amountTo', String(threshold))
    } else {
      next.set('amountFrom', String(threshold))
      next.delete('amountTo')
    }

    setParams(next)
  }

  const valueQuickFilter: ValueQuickFilter | null = (() => {
    if (filters.amountFrom == null && filters.amountTo === 100_000) return 'under100k'
    if (filters.amountFrom === 100_000 && filters.amountTo == null) return 'over100k'
    if (filters.amountFrom === 200_000 && filters.amountTo == null) return 'over200k'
    return null
  })()

  const withinDeadlineActive = filters.withinDeadline === true

  const toggleWithinDeadline = () => {
    const next = new URLSearchParams(params)
    next.set('page', '1')
    if (withinDeadlineActive) next.delete('withinDeadline')
    else next.set('withinDeadline', '1')
    setParams(next)
  }

  const applyPreset = (preset: string) => {
    const today = formatISO(new Date(), { representation: 'date' })
    if (preset === 'clear') {
      setParams(new URLSearchParams())
      return
    }

    // Keep existing filters (value chips, categories, etc.) and only swap the date range
    const next = new URLSearchParams(params)
    next.set('preset', preset)
    next.set('page', '1')

    if (preset === '30d' || preset === '90d' || preset === 'year') {
      const days = preset === '30d' ? 30 : preset === '90d' ? 90 : 365
      next.set('dateFrom', formatISO(subDays(new Date(), days), { representation: 'date' }))
      next.set('dateTo', today)
      next.delete('deadlineFrom')
      next.delete('deadlineTo')
    } else if (preset === '7d') {
      next.set('deadlineFrom', today)
      next.set('deadlineTo', formatISO(subDays(new Date(), -7), { representation: 'date' }))
      next.delete('dateFrom')
      next.delete('dateTo')
    }

    setParams(next)
  }

  const activePreset = params.get('preset')

  const totalPages = tendersQuery.data
    ? Math.max(1, Math.ceil(tendersQuery.data.total / tendersQuery.data.pageSize))
    : 1

  return (
    <div>
      <PageHeader
        title="Tenders"
        subtitle="Filter and explore tracked procurement announcements"
        actions={
          <div className="toolbar-actions">
            {(['30d', '90d', 'year', '7d', 'clear'] as const).map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => applyPreset(p)}
                className={`chip-button${activePreset === p ? ' active' : ''}`}
                aria-pressed={activePreset === p}
              >
                {p === '7d' ? 'Closing 7d' : p === 'clear' ? 'Clear' : `Last ${p}`}
              </button>
            ))}
          </div>
        }
      />

      <div className="explorer-layout">
        <Card title="Filters" className="filter-panel sticky-filters">
          {!optionsQuery.data ? (
            <LoadingState />
          ) : (
            <div className="filter-stack">
              <label>
                <span className="filter-label">Search</span>
                <input
                  className="field-input"
                  placeholder="Number, buyer, title…"
                  value={filters.q ?? ''}
                  onChange={(e) => set('q', e.target.value || null)}
                />
              </label>

              <div>
                <div className="filter-label">Category</div>
                <div className="check-list">
                  {optionsQuery.data.categories.map((c) => (
                    <label key={c.code} className="check-row">
                      <input
                        type="checkbox"
                        checked={filters.categoryCodes?.includes(c.code) ?? false}
                        onChange={() => toggleMulti('categories', c.code)}
                      />
                      <span>{shortCategory(c.name)}</span>
                    </label>
                  ))}
                </div>
              </div>

              <label>
                <span className="filter-label">CPV code</span>
                <input
                  className="field-input"
                  value={filters.cpvCode ?? ''}
                  onChange={(e) => set('cpv', e.target.value || null)}
                  placeholder="e.g. 30213"
                />
              </label>

              <div>
                <div className="filter-label">Status</div>
                <div className="check-list">
                  {optionsQuery.data.statuses.map((s) => (
                    <label key={s} className="check-row">
                      <input
                        type="checkbox"
                        checked={filters.status?.includes(s) ?? false}
                        onChange={() => toggleMulti('status', s)}
                      />
                      <span>{s}</span>
                    </label>
                  ))}
                </div>
              </div>

              <div>
                <div className="filter-label">Procurement type</div>
                <div className="check-list">
                  {optionsQuery.data.procurementTypes.map((s) => (
                    <label key={s} className="check-row">
                      <input
                        type="checkbox"
                        checked={filters.procurementType?.includes(s) ?? false}
                        onChange={() => toggleMulti('type', s)}
                      />
                      <span>{s}</span>
                    </label>
                  ))}
                </div>
              </div>

              <label>
                <span className="filter-label">Buyer</span>
                <input
                  list="buyers"
                  className="field-input"
                  value={filters.buyer ?? ''}
                  onChange={(e) => set('buyer', e.target.value || null)}
                  placeholder="Type to filter…"
                />
                <datalist id="buyers">
                  {optionsQuery.data.buyers.map((b) => (
                    <option key={b} value={b} />
                  ))}
                </datalist>
              </label>

              <div className="two-col date-range">
                <label>
                  <span className="filter-label">Announced from</span>
                  <input
                    type="date"
                    className="field-input date-input"
                    value={filters.dateFrom ?? ''}
                    onChange={(e) => set('dateFrom', e.target.value || null)}
                  />
                </label>
                <label>
                  <span className="filter-label">to</span>
                  <input
                    type="date"
                    className="field-input date-input"
                    value={filters.dateTo ?? ''}
                    onChange={(e) => set('dateTo', e.target.value || null)}
                  />
                </label>
              </div>

              <div className="two-col">
                <label>
                  <span className="filter-label">Value from</span>
                  <input
                    type="number"
                    className="field-input"
                    value={filters.amountFrom ?? ''}
                    onChange={(e) => set('amountFrom', e.target.value || null)}
                  />
                </label>
                <label>
                  <span className="filter-label">to</span>
                  <input
                    type="number"
                    className="field-input"
                    value={filters.amountTo ?? ''}
                    onChange={(e) => set('amountTo', e.target.value || null)}
                  />
                </label>
              </div>

              <div className="two-col">
                <label>
                  <span className="filter-label">Bidders min</span>
                  <input
                    type="number"
                    className="field-input"
                    value={filters.bidderCountMin ?? ''}
                    onChange={(e) => set('biddersMin', e.target.value || null)}
                  />
                </label>
                <label>
                  <span className="filter-label">max</span>
                  <input
                    type="number"
                    className="field-input"
                    value={filters.bidderCountMax ?? ''}
                    onChange={(e) => set('biddersMax', e.target.value || null)}
                  />
                </label>
              </div>

              <div>
                <div className="filter-label">Visible columns</div>
                <div className="check-list" style={{ maxHeight: 'none' }}>
                  {TABLE_COLUMNS.map((col) => (
                    <label key={col.id} className="check-row">
                      <input
                        type="checkbox"
                        checked={visibleColumns[col.id]}
                        disabled={'required' in col && col.required}
                        onChange={() => toggleColumn(col.id)}
                      />
                      <span>{col.label}</span>
                    </label>
                  ))}
                </div>
              </div>
            </div>
          )}
        </Card>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
          <Card>
            <div className="toolbar-row">
              <div className="muted">
                {tendersQuery.data ? (
                  <>
                    Showing {(filters.page! - 1) * filters.pageSize! + 1}–
                    {Math.min(filters.page! * filters.pageSize!, tendersQuery.data.total)} of{' '}
                    {tendersQuery.data.total}
                  </>
                ) : (
                  'Loading…'
                )}
              </div>
              <div className="toolbar-actions">
                <button
                  type="button"
                  className={`chip-button${withinDeadlineActive ? ' active' : ''}`}
                  aria-pressed={withinDeadlineActive}
                  onClick={toggleWithinDeadline}
                >
                  Within deadline
                </button>
                {(
                  [
                    { id: 'under100k' as const, label: '< ₾100K' },
                    { id: 'over100k' as const, label: '> ₾100K' },
                    { id: 'over200k' as const, label: '> ₾200K' },
                  ] as const
                ).map((chip) => (
                  <button
                    key={chip.id}
                    type="button"
                    className={`chip-button${valueQuickFilter === chip.id ? ' active' : ''}`}
                    aria-pressed={valueQuickFilter === chip.id}
                    onClick={() => applyValueQuickFilter(chip.id)}
                  >
                    {chip.label}
                  </button>
                ))}
                <select
                  className="sort-select"
                  value={filters.sortBy}
                  onChange={(e) => set('sortBy', e.target.value)}
                >
                  <option value="announcementDate">Announcement date</option>
                  <option value="bidDeadline">Bid deadline</option>
                  <option value="estimatedValue">Estimated value</option>
                  <option value="status">Status</option>
                  <option value="buyer">Buyer</option>
                </select>
                <select
                  className="sort-select"
                  value={filters.sortDir}
                  onChange={(e) => set('sortDir', e.target.value)}
                >
                  <option value="desc">Desc</option>
                  <option value="asc">Asc</option>
                </select>
              </div>
            </div>

            {tendersQuery.isLoading && <LoadingState />}
            {tendersQuery.error && <ErrorState message={(tendersQuery.error as Error).message} />}
            {tendersQuery.data && (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      {visibleColumns.number && <th>Number</th>}
                      {visibleColumns.buyer && <th>Buyer</th>}
                      {visibleColumns.category && <th>Category</th>}
                      {visibleColumns.announced && <th>Announced</th>}
                      {visibleColumns.deadline && <th>Deadline</th>}
                      {visibleColumns.value && <th>Value</th>}
                      {visibleColumns.bidders && <th>Bidders</th>}
                      {visibleColumns.status && <th>Status</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {tendersQuery.data.items.map((t) => (
                      <tr key={t.appId}>
                        {visibleColumns.number && (
                          <td>
                            <Link to={`/tenders/${t.appId}`}>{t.announcementNumber}</Link>
                            <div className="georgian cell-truncate muted" title={t.title}>
                              {t.title}
                            </div>
                          </td>
                        )}
                        {visibleColumns.buyer && (
                          <td title={t.buyer}>
                            <div className="cell-truncate">{t.buyer}</div>
                          </td>
                        )}
                        {visibleColumns.category && <td>{shortCategory(t.categoryName)}</td>}
                        {visibleColumns.announced && (
                          <td style={{ whiteSpace: 'nowrap' }}>{formatDate(t.announcementDate)}</td>
                        )}
                        {visibleColumns.deadline && (
                          <td style={{ whiteSpace: 'nowrap' }}>{formatDate(t.bidDeadline)}</td>
                        )}
                        {visibleColumns.value && (
                          <td style={{ whiteSpace: 'nowrap' }}>{formatGel(t.estimatedValue)}</td>
                        )}
                        {visibleColumns.bidders && <td>{t.bidderCount}</td>}
                        {visibleColumns.status && (
                          <td>
                            <StatusBadge status={t.status} />
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
                {tendersQuery.data.items.length === 0 && (
                  <div className="empty-state" style={{ minHeight: 120, border: 0 }}>
                    No tenders match these filters.
                  </div>
                )}
              </div>
            )}
          </Card>

          <div className="pager">
            <button
              type="button"
              disabled={(filters.page ?? 1) <= 1}
              onClick={() => set('page', String((filters.page ?? 1) - 1))}
              className="secondary-button"
            >
              Previous
            </button>
            <div className="muted">
              Page {filters.page} / {totalPages}
            </div>
            <button
              type="button"
              disabled={(filters.page ?? 1) >= totalPages}
              onClick={() => set('page', String((filters.page ?? 1) + 1))}
              className="secondary-button"
            >
              Next
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
