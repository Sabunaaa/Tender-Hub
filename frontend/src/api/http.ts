import type {
  CpvCategory,
  DashboardStats,
  DataSource,
  FilterOptions,
  Paginated,
  ScrapeHealth,
  ScrapeRun,
  TenderDetail,
  TenderFilters,
  TenderSummary,
  TrackedCategory,
} from './types'

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    ...init,
  })
  if (!res.ok) {
    const text = await res.text()
    // FastAPI reports errors as {"detail": "..."}; show that rather than raw JSON.
    let message = text
    try {
      const parsed = JSON.parse(text)
      if (typeof parsed?.detail === 'string') message = parsed.detail
    } catch {
      // Not JSON, fall back to the raw body.
    }
    throw new Error(message || `Request failed: ${res.status}`)
  }
  if (res.status === 204) return undefined as T
  return res.json() as Promise<T>
}

function toQuery(filters: TenderFilters): string {
  const params = new URLSearchParams()
  const set = (k: string, v: string | number | undefined | null) => {
    if (v !== undefined && v !== null && v !== '') params.set(k, String(v))
  }
  set('q', filters.q)
  set('cpvCode', filters.cpvCode)
  set('buyer', filters.buyer)
  set('dateFrom', filters.dateFrom)
  set('dateTo', filters.dateTo)
  set('deadlineFrom', filters.deadlineFrom)
  set('deadlineTo', filters.deadlineTo)
  if (filters.withinDeadline) params.set('withinDeadline', '1')
  set('amountFrom', filters.amountFrom)
  set('amountTo', filters.amountTo)
  set('bidderCountMin', filters.bidderCountMin)
  set('bidderCountMax', filters.bidderCountMax)
  set('page', filters.page)
  set('pageSize', filters.pageSize)
  set('sortBy', filters.sortBy)
  set('sortDir', filters.sortDir)
  filters.categoryCodes?.forEach((c) => params.append('categoryCodes', c))
  filters.status?.forEach((c) => params.append('status', c))
  filters.procurementType?.forEach((c) => params.append('procurementType', c))
  return params.toString()
}

export const httpApi: DataSource = {
  getStats: () => request<DashboardStats>('/api/stats'),
  getTenders: (filters) =>
    request<Paginated<TenderSummary>>(`/api/tenders?${toQuery(filters)}`),
  getTender: (appId) => request<TenderDetail>(`/api/tenders/${appId}`),
  getFilterOptions: () => request<FilterOptions>('/api/filters/options'),
  getAllCategories: () => request<CpvCategory[]>('/api/categories/all'),
  getTrackedCategories: () => request<TrackedCategory[]>('/api/categories'),
  addTrackedCategory: (categoryId) =>
    request<TrackedCategory>('/api/categories', {
      method: 'POST',
      body: JSON.stringify({ categoryId }),
    }),
  removeTrackedCategory: (categoryId) =>
    request<void>(`/api/categories/${categoryId}`, { method: 'DELETE' }),
  triggerBackfill: (categoryId, options) =>
    request<ScrapeRun>(`/api/categories/${categoryId}/backfill`, {
      method: 'POST',
      body: JSON.stringify({
        dateFrom: options?.dateFrom,
        days: options?.days,
      }),
    }),
  getScrapeHealth: () => request<ScrapeHealth>('/api/runs'),
  stopScrape: () => request<{ ok: boolean; run: ScrapeRun | null }>('/api/scrape/stop', { method: 'POST' }),
  resumeRun: (runId) => request<ScrapeRun>(`/api/runs/${runId}/resume`, { method: 'POST' }),
}
