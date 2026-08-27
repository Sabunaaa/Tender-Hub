import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { Info, Plus } from 'lucide-react'
import { api } from '../api'
import type { Engagement } from '../api'
import { Card, ErrorState, LoadingState } from '../components/ui'
import { errorMessage } from '../lib/errors'
import { formatDateTime, formatGel, formatProcurementType, shortCategory } from '../lib/format'
import { HUAWEI_ENTERPRISE_PRODUCTS } from '../lib/huaweiDomains'

const UNASSIGNED = '__none__'
const PAGE_SIZES = [10, 20, 30, 50, 100] as const
const PAGE_SIZE_KEY = 'tender-hub.engagement-page-size'

function loadPageSize(): number {
  const raw = Number(localStorage.getItem(PAGE_SIZE_KEY))
  return PAGE_SIZES.includes(raw as (typeof PAGE_SIZES)[number]) ? raw : 20
}

function uniqueSorted(values: string[]) {
  return [...new Set(values.map((v) => v.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b))
}

function matchesChoice(value: string, selected: string) {
  if (!selected) return true
  if (selected === UNASSIGNED) return !value.trim()
  return value === selected
}

function dateOnOrAfter(iso: string | null, from: string) {
  if (!from) return true
  if (!iso) return false
  return iso.slice(0, 10) >= from
}

function ManagerSelect({
  value,
  names,
  onChange,
  className,
}: {
  value: string
  names: string[]
  onChange: (value: string) => void
  className?: string
}) {
  const options = names.includes(value) || !value ? names : [value, ...names]
  return (
    <select
      className={className ? `field-input ${className}` : 'field-input'}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      <option value="">—</option>
      {options.map((name) => (
        <option key={name} value={name}>
          {name}
        </option>
      ))}
    </select>
  )
}

function procuringCategory(code: string, name: string): string {
  if (code && name) return `${code} - ${name}`
  return name || code || '—'
}

function ColumnSelect({
  label,
  value,
  onChange,
  children,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  children: ReactNode
}) {
  return (
    <select
      className="col-filter"
      aria-label={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      {children}
    </select>
  )
}

export function EngagementPage() {
  const qc = useQueryClient()
  const [code, setCode] = useState('')
  const [kindFilter, setKindFilter] = useState('')
  const [typeFilter, setTypeFilter] = useState('')
  const [donorFilter, setDonorFilter] = useState('')
  const [announcementFilter, setAnnouncementFilter] = useState('')
  const [customerFilter, setCustomerFilter] = useState('')
  const [announcedFrom, setAnnouncedFrom] = useState('')
  const [bidsFrom, setBidsFrom] = useState('')
  const [deadlineFrom, setDeadlineFrom] = useState('')
  const [valueMin, setValueMin] = useState('')
  const [valueMax, setValueMax] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('')
  const [productFilter, setProductFilter] = useState('')
  const [accountFilter, setAccountFilter] = useState('')
  const [solutionFilter, setSolutionFilter] = useState('')
  const [engageFilter, setEngageFilter] = useState('')
  const [pageSize, setPageSize] = useState(loadPageSize)
  const [page, setPage] = useState(1)
  const [infoRow, setInfoRow] = useState<Engagement | null>(null)
  const [infoDraft, setInfoDraft] = useState('')
  const settingsQuery = useQuery({ queryKey: ['settings'], queryFn: () => api.getSettings() })
  const listQuery = useQuery({ queryKey: ['engagements'], queryFn: () => api.listEngagements() })
  const rows = listQuery.data ?? []

  const typeOptions = useMemo(() => uniqueSorted(rows.map((r) => r.procurementType)), [rows])
  const donorOptions = useMemo(
    () => uniqueSorted(rows.map((r) => (r.donor.trim() ? r.donor : 'N/A'))),
    [rows],
  )
  const categoryOptions = useMemo(() => {
    const map = new Map<string, string>()
    for (const row of rows) {
      const key = row.categoryCode || row.categoryName
      if (!key) continue
      map.set(key, row.categoryCode || shortCategory(row.categoryName))
    }
    return [...map.entries()].sort((a, b) => a[1].localeCompare(b[1]))
  }, [rows])

  const filtersActive = Boolean(
    kindFilter ||
    typeFilter ||
      donorFilter ||
      announcementFilter.trim() ||
      customerFilter.trim() ||
      announcedFrom ||
      bidsFrom ||
      deadlineFrom ||
      valueMin ||
      valueMax ||
      categoryFilter ||
      productFilter ||
      accountFilter ||
      solutionFilter ||
      engageFilter,
  )

  const filtered = useMemo(() => {
    const announcementQ = announcementFilter.trim().toLowerCase()
    const customerQ = customerFilter.trim().toLowerCase()
    const min = valueMin ? Number(valueMin) : null
    const max = valueMax ? Number(valueMax) : null
    return rows.filter((row) => {
      if (kindFilter && (row.kind ?? 'tender') !== kindFilter) return false
      if (typeFilter && row.procurementType !== typeFilter) return false
      if (donorFilter) {
        const donor = row.donor.trim() || 'N/A'
        if (donor !== donorFilter) return false
      }
      if (
        announcementQ &&
        !`${row.announcementNumber} ${row.title}`.toLowerCase().includes(announcementQ)
      ) {
        return false
      }
      if (customerQ && !row.buyer.toLowerCase().includes(customerQ)) return false
      if (!dateOnOrAfter(row.announcementDate, announcedFrom)) return false
      if (!dateOnOrAfter(row.bidsAcceptedFrom, bidsFrom)) return false
      if (!dateOnOrAfter(row.bidDeadline, deadlineFrom)) return false
      if (min != null && !Number.isNaN(min) && (row.estimatedValue == null || row.estimatedValue < min)) {
        return false
      }
      if (max != null && !Number.isNaN(max) && (row.estimatedValue == null || row.estimatedValue > max)) {
        return false
      }
      if (categoryFilter && row.categoryCode !== categoryFilter && row.categoryName !== categoryFilter) {
        return false
      }
      if (!matchesChoice(row.product, productFilter)) return false
      if (!matchesChoice(row.accountManager, accountFilter)) return false
      if (!matchesChoice(row.solutionManager, solutionFilter)) return false
      if (engageFilter === 'yes' && !row.engaged) return false
      if (engageFilter === 'no' && row.engaged) return false
      return true
    })
  }, [
    rows,
    kindFilter,
    typeFilter,
    donorFilter,
    announcementFilter,
    customerFilter,
    announcedFrom,
    bidsFrom,
    deadlineFrom,
    valueMin,
    valueMax,
    categoryFilter,
    productFilter,
    accountFilter,
    solutionFilter,
    engageFilter,
  ])

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize))
  const currentPage = Math.min(page, totalPages)
  const paged = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize)
  const rangeStart = filtered.length === 0 ? 0 : (currentPage - 1) * pageSize + 1
  const rangeEnd = Math.min(currentPage * pageSize, filtered.length)

  useEffect(() => {
    localStorage.setItem(PAGE_SIZE_KEY, String(pageSize))
  }, [pageSize])

  useEffect(() => {
    setPage(1)
  }, [
    pageSize,
    kindFilter,
    typeFilter,
    donorFilter,
    announcementFilter,
    customerFilter,
    announcedFrom,
    bidsFrom,
    deadlineFrom,
    valueMin,
    valueMax,
    categoryFilter,
    productFilter,
    accountFilter,
    solutionFilter,
    engageFilter,
  ])

  useEffect(() => {
    if (page > totalPages) setPage(totalPages)
  }, [page, totalPages])

  const clearFilters = () => {
    setKindFilter('')
    setTypeFilter('')
    setDonorFilter('')
    setAnnouncementFilter('')
    setCustomerFilter('')
    setAnnouncedFrom('')
    setBidsFrom('')
    setDeadlineFrom('')
    setValueMin('')
    setValueMax('')
    setCategoryFilter('')
    setProductFilter('')
    setAccountFilter('')
    setSolutionFilter('')
    setEngageFilter('')
  }

  const addMutation = useMutation({
    mutationFn: (announcementNumber: string) => api.addEngagement(announcementNumber),
    onSuccess: () => {
      setCode('')
      qc.invalidateQueries({ queryKey: ['engagements'] })
    },
  })

  const patchMutation = useMutation({
    mutationFn: ({
      id,
      patch,
    }: {
      id: number
      patch: { engaged?: boolean; accountManager?: string; solutionManager?: string; product?: string; info?: string }
    }) => api.updateEngagement(id, patch),
    onSuccess: (row) => {
      qc.setQueryData(['engagements'], (old: Engagement[] | undefined) =>
        old ? old.map((item) => (item.id === row.id ? row : item)) : [row],
      )
      if (infoRow?.id === row.id) {
        setInfoRow(row)
        setInfoDraft(row.info)
      }
    },
  })

  const accountManagers = settingsQuery.data?.accountManagers ?? []
  const solutionManagers = settingsQuery.data?.solutionManagers ?? []

  return (
    <div>
      <div className="engagement-page-toolbar">
        <div className="muted">
          {listQuery.data
            ? filtered.length === 0
              ? 'No matching engagements'
              : `Showing ${rangeStart}–${rangeEnd} of ${filtered.length}`
            : ' '}
        </div>
        <label>
          Per page
          <select
            className="field-input"
            value={pageSize}
            onChange={(e) => setPageSize(Number(e.target.value))}
          >
            {PAGE_SIZES.map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
        </label>
      </div>
      <Card>
        <form
          className="engagement-add"
          onSubmit={(e) => {
            e.preventDefault()
            if (!code.trim() || addMutation.isPending) return
            addMutation.mutate(code.trim())
          }}
        >
          <input
            className="field-input"
            placeholder="Announcement number, e.g. CON260000470"
            value={code}
            onChange={(e) => setCode(e.target.value)}
          />
          <button type="submit" className="primary-button" disabled={!code.trim() || addMutation.isPending}>
            <Plus size={16} />
            {addMutation.isPending ? 'Adding…' : 'Add announcement'}
          </button>
        </form>
        {addMutation.isError && (
          <p className="settings-warning" style={{ marginTop: 10 }}>
            {errorMessage(addMutation.error, 'Could not add tender')}
          </p>
        )}
        <p className="muted" style={{ margin: '10px 0 0', fontSize: 12 }}>
          Details come from the scraped portal record. Pick a product, then Account and Solution Manager names from{' '}
          <Link className="text-button" to="/settings/engagement">
            Settings
          </Link>
          .
        </p>
      </Card>

      <div style={{ height: 16 }} />

      {listQuery.isLoading && <LoadingState label="Loading engagements…" />}
      {listQuery.error && <ErrorState message={errorMessage(listQuery.error, 'Failed to load engagements')} />}
      {listQuery.data && (
        <Card className="engagement-board">
          <div className="table-wrap">
            <table className="engagement-table">
              <thead>
                <tr className="engagement-filter-row">
                  <th>
                    <ColumnSelect label="Filter listing kind" value={kindFilter} onChange={setKindFilter}>
                      <option value="">All</option>
                      <option value="tender">Tender</option>
                      <option value="mrs">MRS</option>
                    </ColumnSelect>
                  </th>
                  <th>
                    <ColumnSelect label="Filter type" value={typeFilter} onChange={setTypeFilter}>
                      <option value="">All types</option>
                      {typeOptions.map((type) => (
                        <option key={type} value={type}>
                          {formatProcurementType(type)}
                        </option>
                      ))}
                    </ColumnSelect>
                  </th>
                  <th>
                    <ColumnSelect label="Filter donor" value={donorFilter} onChange={setDonorFilter}>
                      <option value="">All donors</option>
                      {donorOptions.map((donor) => (
                        <option key={donor} value={donor}>
                          {donor}
                        </option>
                      ))}
                    </ColumnSelect>
                  </th>
                  <th className="announce-col">
                    <input
                      className="col-filter"
                      aria-label="Filter announcement"
                      placeholder="Search"
                      value={announcementFilter}
                      onChange={(e) => setAnnouncementFilter(e.target.value)}
                    />
                  </th>
                  <th>
                    <input
                      className="col-filter"
                      aria-label="Filter customer"
                      placeholder="Search"
                      value={customerFilter}
                      onChange={(e) => setCustomerFilter(e.target.value)}
                    />
                  </th>
                  <th>
                    <input
                      className="col-filter"
                      aria-label="Filter announced from"
                      type="date"
                      value={announcedFrom}
                      onChange={(e) => setAnnouncedFrom(e.target.value)}
                    />
                  </th>
                  <th>
                    <input
                      className="col-filter"
                      aria-label="Filter bids from"
                      type="date"
                      value={bidsFrom}
                      onChange={(e) => setBidsFrom(e.target.value)}
                    />
                  </th>
                  <th>
                    <input
                      className="col-filter"
                      aria-label="Filter bid deadline from"
                      type="date"
                      value={deadlineFrom}
                      onChange={(e) => setDeadlineFrom(e.target.value)}
                    />
                  </th>
                  <th className="value-col">
                    <div className="col-filter-pair">
                      <input
                        className="col-filter"
                        aria-label="Minimum value"
                        type="number"
                        min={0}
                        placeholder="Min"
                        value={valueMin}
                        onChange={(e) => setValueMin(e.target.value)}
                      />
                      <input
                        className="col-filter"
                        aria-label="Maximum value"
                        type="number"
                        min={0}
                        placeholder="Max"
                        value={valueMax}
                        onChange={(e) => setValueMax(e.target.value)}
                      />
                    </div>
                  </th>
                  <th>
                    <ColumnSelect label="Filter category" value={categoryFilter} onChange={setCategoryFilter}>
                      <option value="">All</option>
                      {categoryOptions.map(([key, label]) => (
                        <option key={key} value={key}>
                          {label}
                        </option>
                      ))}
                    </ColumnSelect>
                  </th>
                  <th className="product-col">
                    <ColumnSelect label="Filter product" value={productFilter} onChange={setProductFilter}>
                      <option value="">All</option>
                      <option value={UNASSIGNED}>Unassigned</option>
                      {HUAWEI_ENTERPRISE_PRODUCTS.map((name) => (
                        <option key={name} value={name}>
                          {name}
                        </option>
                      ))}
                    </ColumnSelect>
                  </th>
                  <th className="manager-col">
                    <ColumnSelect label="Filter account manager" value={accountFilter} onChange={setAccountFilter}>
                      <option value="">All</option>
                      <option value={UNASSIGNED}>Unassigned</option>
                      {accountManagers.map((name) => (
                        <option key={name} value={name}>
                          {name}
                        </option>
                      ))}
                    </ColumnSelect>
                  </th>
                  <th className="manager-col">
                    <ColumnSelect label="Filter solution manager" value={solutionFilter} onChange={setSolutionFilter}>
                      <option value="">All</option>
                      <option value={UNASSIGNED}>Unassigned</option>
                      {solutionManagers.map((name) => (
                        <option key={name} value={name}>
                          {name}
                        </option>
                      ))}
                    </ColumnSelect>
                  </th>
                  <th className="engage-col">
                    <ColumnSelect label="Filter engage" value={engageFilter} onChange={setEngageFilter}>
                      <option value="">All</option>
                      <option value="yes">Yes</option>
                      <option value="no">No</option>
                    </ColumnSelect>
                  </th>
                  <th className="engage-col">
                    {filtersActive ? (
                      <button type="button" className="text-button" onClick={clearFilters}>
                        Clear
                      </button>
                    ) : null}
                  </th>
                </tr>
                <tr>
                  <th>Kind</th>
                  <th>Type</th>
                  <th>Donor</th>
                  <th className="announce-col">Announcement No.</th>
                  <th>Customer</th>
                  <th>Announced</th>
                  <th>Bids from</th>
                  <th>Bid deadline</th>
                  <th className="value-col">Value</th>
                  <th>Category</th>
                  <th className="product-col">Product</th>
                  <th className="manager-col">Account</th>
                  <th className="manager-col">Solution</th>
                  <th className="engage-col">Engage?</th>
                  <th className="engage-col">Info</th>
                </tr>
              </thead>
              <tbody>
                {paged.map((row) => (
                  <tr key={row.id}>
                    <td className="type-col">
                      <span className={`status-pill ${row.kind === 'mrs' ? 'violet' : 'info'}`}>
                        {row.kind === 'mrs' ? 'MRS' : 'Tender'}
                      </span>
                    </td>
                    <td className="type-col" title={row.procurementType || undefined}>
                      {formatProcurementType(row.procurementType)}
                    </td>
                    <td className="nowrap-col">{row.donor?.trim() ? row.donor : 'N/A'}</td>
                    <td className="announce-col">
                      {row.appId ? (
                        <Link to={row.kind === 'mrs' ? `/market-research/${row.appId}` : `/tenders/${row.appId}`}>
                          {row.announcementNumber}
                        </Link>
                      ) : (
                        row.announcementNumber
                      )}
                      <div className="georgian cell-truncate muted announce-sub" title={row.title}>
                        {row.title || '—'}
                      </div>
                    </td>
                    <td className="customer-col" title={row.buyer}>
                      <div className="cell-truncate">{row.buyer || '—'}</div>
                    </td>
                    <td className="nowrap-col">{formatDateTime(row.announcementDate)}</td>
                    <td className="nowrap-col">{formatDateTime(row.bidsAcceptedFrom)}</td>
                    <td className="nowrap-col">{formatDateTime(row.bidDeadline)}</td>
                    <td className="value-col nowrap-col">{formatGel(row.estimatedValue, row.currency)}</td>
                    <td className="category-col" title={procuringCategory(row.categoryCode, row.categoryName)}>
                      <div className="cell-truncate">
                        {row.categoryCode || shortCategory(row.categoryName) || '—'}
                      </div>
                    </td>
                    <td className="product-col">
                      <ManagerSelect
                        className="product-select"
                        value={row.product}
                        names={[...HUAWEI_ENTERPRISE_PRODUCTS]}
                        onChange={(product) => patchMutation.mutate({ id: row.id, patch: { product } })}
                      />
                    </td>
                    <td className="manager-col">
                      <ManagerSelect
                        className="manager-select"
                        value={row.accountManager}
                        names={accountManagers}
                        onChange={(accountManager) =>
                          patchMutation.mutate({ id: row.id, patch: { accountManager } })
                        }
                      />
                    </td>
                    <td className="manager-col">
                      <ManagerSelect
                        className="manager-select"
                        value={row.solutionManager}
                        names={solutionManagers}
                        onChange={(solutionManager) =>
                          patchMutation.mutate({ id: row.id, patch: { solutionManager } })
                        }
                      />
                    </td>
                    <td className="engage-col">
                      <div className="engage-toggle" role="group" aria-label="Engage">
                        <button
                          type="button"
                          className={`engage-btn${row.engaged ? ' active yes' : ''}`}
                          aria-pressed={row.engaged}
                          onClick={() => patchMutation.mutate({ id: row.id, patch: { engaged: true } })}
                        >
                          Y
                        </button>
                        <button
                          type="button"
                          className={`engage-btn${!row.engaged ? ' active no' : ''}`}
                          aria-pressed={!row.engaged}
                          onClick={() => patchMutation.mutate({ id: row.id, patch: { engaged: false } })}
                        >
                          N
                        </button>
                      </div>
                    </td>
                    <td className="engage-col">
                      <button
                        type="button"
                        className={`icon-button${(row.info ?? '').trim() ? ' has-info' : ''}`}
                        aria-label={(row.info ?? '').trim() ? 'Edit information' : 'Add information'}
                        title={(row.info ?? '').trim() ? row.info : 'Add information'}
                        onClick={() => {
                          setInfoRow(row)
                          setInfoDraft(row.info)
                        }}
                      >
                        <Info size={15} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {listQuery.data.length === 0 && (
              <div className="empty-state" style={{ minHeight: 120, border: 0 }}>
                Add an announcement number to start tracking engagement.
              </div>
            )}
            {listQuery.data.length > 0 && filtered.length === 0 && (
              <div className="empty-state" style={{ minHeight: 120, border: 0 }}>
                No engagements match these filters.
              </div>
            )}
          </div>
          {filtered.length > pageSize && (
            <div className="pager" style={{ marginTop: 12 }}>
              <button
                type="button"
                className="secondary-button"
                disabled={currentPage <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                Previous
              </button>
              <div className="muted">
                Page {currentPage} / {totalPages}
              </div>
              <button
                type="button"
                className="secondary-button"
                disabled={currentPage >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              >
                Next
              </button>
            </div>
          )}
        </Card>
      )}

      {infoRow && (
        <div
          className="modal-backdrop"
          onClick={() => {
            if (!patchMutation.isPending) setInfoRow(null)
          }}
        >
          <div
            className="modal-panel info-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="info-dialog-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="info-dialog-title">Information</h2>
            <p className="muted" style={{ marginTop: 6, fontSize: 13 }}>
              {infoRow.announcementNumber}
              {infoRow.buyer ? ` · ${infoRow.buyer}` : ''}
            </p>
            <textarea
              className="field-input"
              aria-label="Information"
              rows={6}
              maxLength={4000}
              value={infoDraft}
              onChange={(e) => setInfoDraft(e.target.value)}
              placeholder="Notes for this engagement…"
              autoFocus
            />
            {patchMutation.isError && (
              <div style={{ marginTop: 10, fontSize: 12, color: 'var(--danger)' }}>
                {errorMessage(patchMutation.error, 'Could not save information')}
              </div>
            )}
            <div className="modal-actions">
              <button
                type="button"
                className="secondary-button"
                disabled={patchMutation.isPending}
                onClick={() => setInfoRow(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="primary-button"
                disabled={patchMutation.isPending}
                onClick={() =>
                  patchMutation.mutate(
                    { id: infoRow.id, patch: { info: infoDraft } },
                    { onSuccess: () => setInfoRow(null) },
                  )
                }
              >
                {patchMutation.isPending ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
