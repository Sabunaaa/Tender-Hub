import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { formatISO, subDays } from 'date-fns'
import { api } from '../api'
import { Card, ErrorState, FilterSection, LoadingState, StatusBadge } from '../components/ui'
import { errorMessage } from '../lib/errors'
import { formatDate, formatGel, shortCategory, shortProcurementType } from '../lib/format'
import { DEVICE_KEYWORDS, activeDatePreset, filtersFromParams, parseList } from '../lib/tenderFilters'

const COLUMN_STORAGE_KEY = 'tender-hub.visible-columns'
const FILTER_OPEN_KEY = 'tender-hub.filter-open'

const FILTER_SECTIONS = [
  'search',
  'device',
  'category',
  'cpv',
  'status',
  'type',
  'buyer',
  'announced',
  'value',
  'bidders',
  'columns',
] as const

type FilterSectionId = (typeof FILTER_SECTIONS)[number]

const DEFAULT_FILTER_OPEN: Record<FilterSectionId, boolean> = {
  search: true,
  device: true,
  category: true,
  cpv: true,
  status: true,
  type: true,
  buyer: true,
  announced: true,
  value: true,
  bidders: true,
  columns: true,
}

function loadFilterOpen(): Record<FilterSectionId, boolean> {
  try {
    const raw = localStorage.getItem(FILTER_OPEN_KEY)
    if (!raw) return { ...DEFAULT_FILTER_OPEN }
    const parsed = JSON.parse(raw) as Partial<Record<FilterSectionId, boolean>>
    return { ...DEFAULT_FILTER_OPEN, ...parsed }
  } catch {
    return { ...DEFAULT_FILTER_OPEN }
  }
}

const TABLE_COLUMNS = [
  { id: 'number', label: 'Number', required: true },
  { id: 'buyer', label: 'Buyer' },
  { id: 'category', label: 'Category' },
  { id: 'announced', label: 'Announced' },
  { id: 'deadline', label: 'Deadline' },
  { id: 'value', label: 'Value' },
  { id: 'procurementType', label: 'Procurement type' },
  { id: 'donor', label: 'Donor' },
  { id: 'spec', label: 'Spec text' },
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
  procurementType: true,
  donor: true,
  spec: true,
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

export function TendersPage() {
  const [params, setParams] = useSearchParams()
  const settingsQuery = useQuery({ queryKey: ['settings'], queryFn: () => api.getSettings() })
  const filters = useMemo(
    () => filtersFromParams(params, { pageSize: settingsQuery.data?.defaultPageSize }),
    [params, settingsQuery.data?.defaultPageSize],
  )
  const [visibleColumns, setVisibleColumns] = useState<Record<ColumnId, boolean>>(loadVisibleColumns)
  const [filterOpen, setFilterOpen] = useState<Record<FilterSectionId, boolean>>(loadFilterOpen)

  useEffect(() => {
    localStorage.setItem(COLUMN_STORAGE_KEY, JSON.stringify(visibleColumns))
  }, [visibleColumns])

  useEffect(() => {
    localStorage.setItem(FILTER_OPEN_KEY, JSON.stringify(filterOpen))
  }, [filterOpen])

  const toggleFilterSection = (id: FilterSectionId) => {
    setFilterOpen((prev) => ({ ...prev, [id]: !prev[id] }))
  }

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

  const hasSpecActive = filters.hasSpec === true

  const toggleHasSpec = () => {
    const next = new URLSearchParams(params)
    next.set('page', '1')
    if (hasSpecActive) next.delete('hasSpec')
    else next.set('hasSpec', '1')
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

  const activePreset = activeDatePreset(params)

  const totalPages = tendersQuery.data
    ? Math.max(1, Math.ceil(tendersQuery.data.total / tendersQuery.data.pageSize))
    : 1

  return (
    <div>
      <div className="section-toolbar tenders-presets">
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
      </div>

      <div className="explorer-layout">
        <Card title="Filters" className="filter-panel sticky-filters">
          {optionsQuery.isLoading ? (
            <LoadingState />
          ) : optionsQuery.error || !optionsQuery.data ? (
            <ErrorState message={errorMessage(optionsQuery.error, 'Failed to load filters')} />
          ) : (
            <div className="filter-stack">
              <FilterSection title="Search" open={filterOpen.search} onToggle={() => toggleFilterSection('search')}>
                <input
                  className="field-input"
                  placeholder="Number, buyer, title…"
                  value={filters.q ?? ''}
                  onChange={(e) => set('q', e.target.value || null)}
                />
              </FilterSection>

              <FilterSection
                title="Device / topic"
                open={filterOpen.device}
                onToggle={() => toggleFilterSection('device')}
              >
                <div className="keyword-chips">
                  {DEVICE_KEYWORDS.map((chip) => (
                    <button
                      key={chip.id}
                      type="button"
                      className={`chip-button${filters.keywords?.includes(chip.id) ? ' active' : ''}`}
                      aria-pressed={filters.keywords?.includes(chip.id) ?? false}
                      onClick={() => toggleMulti('keywords', chip.id)}
                    >
                      {chip.label}
                    </button>
                  ))}
                </div>
                <input
                  className="field-input"
                  style={{ marginTop: 8 }}
                  placeholder="ქართული სიტყვა, then Enter"
                  onKeyDown={(e) => {
                    if (e.key !== 'Enter') return
                    e.preventDefault()
                    const value = e.currentTarget.value.trim()
                    if (!value) return
                    toggleMulti('keywords', value)
                    e.currentTarget.value = ''
                  }}
                />
                {filters.keywords
                  ?.filter((k) => !DEVICE_KEYWORDS.some((chip) => chip.id === k))
                  .map((k) => (
                    <button
                      key={k}
                      type="button"
                      className="chip-button active"
                      style={{ marginTop: 8, marginRight: 6 }}
                      onClick={() => toggleMulti('keywords', k)}
                    >
                      {k} ×
                    </button>
                  ))}
              </FilterSection>

              <FilterSection
                title="Category"
                open={filterOpen.category}
                onToggle={() => toggleFilterSection('category')}
              >
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
              </FilterSection>

              <FilterSection title="CPV code" open={filterOpen.cpv} onToggle={() => toggleFilterSection('cpv')}>
                <input
                  className="field-input"
                  value={filters.cpvCode ?? ''}
                  onChange={(e) => set('cpv', e.target.value || null)}
                  placeholder="e.g. 30213"
                />
              </FilterSection>

              <FilterSection title="Status" open={filterOpen.status} onToggle={() => toggleFilterSection('status')}>
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
              </FilterSection>

              <FilterSection
                title="Procurement type"
                open={filterOpen.type}
                onToggle={() => toggleFilterSection('type')}
              >
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
              </FilterSection>

              <FilterSection title="Buyer" open={filterOpen.buyer} onToggle={() => toggleFilterSection('buyer')}>
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
              </FilterSection>

              <FilterSection
                title="Announced"
                open={filterOpen.announced}
                onToggle={() => toggleFilterSection('announced')}
              >
                <div className="two-col date-range">
                  <label>
                    <span className="filter-label">from</span>
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
              </FilterSection>

              <FilterSection title="Value" open={filterOpen.value} onToggle={() => toggleFilterSection('value')}>
                <div className="two-col">
                  <label>
                    <span className="filter-label">from</span>
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
              </FilterSection>

              <FilterSection title="Bidders" open={filterOpen.bidders} onToggle={() => toggleFilterSection('bidders')}>
                <div className="two-col">
                  <label>
                    <span className="filter-label">min</span>
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
              </FilterSection>

              <FilterSection
                title="Visible columns"
                open={filterOpen.columns}
                onToggle={() => toggleFilterSection('columns')}
              >
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
              </FilterSection>
            </div>
          )}
        </Card>

        <div className="explorer-main">
          <Card>
            <div className="toolbar-row">
              <div className="muted">
                {tendersQuery.data ? (
                  <>
                    Showing {((filters.page ?? 1) - 1) * (filters.pageSize ?? 20) + 1}–
                    {Math.min((filters.page ?? 1) * (filters.pageSize ?? 20), tendersQuery.data.total)} of{' '}
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
                <button
                  type="button"
                  className={`chip-button${hasSpecActive ? ' active' : ''}`}
                  aria-pressed={hasSpecActive}
                  onClick={toggleHasSpec}
                  title="Only tenders whose ტექნიკური attachment was parsed"
                >
                  Has spec text
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
                  className="sort-select sort-dir"
                  value={filters.sortDir}
                  onChange={(e) => set('sortDir', e.target.value)}
                >
                  <option value="desc">Desc</option>
                  <option value="asc">Asc</option>
                </select>
              </div>
            </div>

            {tendersQuery.isLoading && <LoadingState />}
            {tendersQuery.error && (
              <ErrorState message={errorMessage(tendersQuery.error, 'Failed to load tenders')} />
            )}
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
                      {visibleColumns.procurementType && <th>Procurement type</th>}
                      {visibleColumns.donor && <th>Donor</th>}
                      {visibleColumns.spec && <th>Spec text</th>}
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
                        {visibleColumns.procurementType && (
                          <td title={t.procurementType || undefined}>
                            {shortProcurementType(t.procurementType)}
                          </td>
                        )}
                        {visibleColumns.donor && <td>{t.donor?.trim() ? t.donor : 'N/A'}</td>}
                        {visibleColumns.spec && (
                          <td>
                            {t.hasSpecText ? (
                              <Link
                                to={`/tenders/${t.appId}#spec`}
                                className="status-pill info"
                                title="ტექნიკური attachment parsed — open the extracted text"
                              >
                                SPEC
                              </Link>
                            ) : (
                              <span className="muted">—</span>
                            )}
                          </td>
                        )}
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
