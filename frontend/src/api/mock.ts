import { addDays, formatISO } from 'date-fns'
import { ALL_CPV_CATEGORIES } from './cpvCategories'
import { MOCK_RUNS, MOCK_TENDERS, mockTrackedStore } from './fixtures'
import type {
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

function delay(ms = 180): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

function toSummary(t: TenderDetail): TenderSummary {
  const {
    appId, key, announcementNumber, title, status, procurementType, buyer, buyerOrgId,
    categoryCode, categoryName, announcementDate, bidDeadline, bidsAcceptedFrom,
    estimatedValue, currency, bidderCount, winner, contractStatus, sourceUrl,
  } = t
  return {
    appId, key, announcementNumber, title, status, procurementType, buyer, buyerOrgId,
    categoryCode, categoryName, announcementDate, bidDeadline, bidsAcceptedFrom,
    estimatedValue, currency, bidderCount, winner, contractStatus, sourceUrl,
  }
}

function filterTenders(filters: TenderFilters): TenderDetail[] {
  let items = [...MOCK_TENDERS]
  const tracked = new Set(mockTrackedStore.list().filter((c) => c.enabled).map((c) => c.code))
  items = items.filter((t) => tracked.has(t.categoryCode))

  if (filters.q) {
    const q = filters.q.toLowerCase()
    items = items.filter(
      (t) =>
        t.announcementNumber.toLowerCase().includes(q) ||
        t.title.toLowerCase().includes(q) ||
        t.buyer.toLowerCase().includes(q) ||
        t.description.toLowerCase().includes(q),
    )
  }
  if (filters.categoryCodes?.length) {
    const set = new Set(filters.categoryCodes)
    items = items.filter((t) => set.has(t.categoryCode))
  }
  if (filters.cpvCode) {
    items = items.filter((t) => t.cpvCodes.some((c) => c.code.includes(filters.cpvCode!)))
  }
  if (filters.status?.length) {
    const set = new Set(filters.status)
    items = items.filter((t) => set.has(t.status))
  }
  if (filters.procurementType?.length) {
    const set = new Set(filters.procurementType)
    items = items.filter((t) => set.has(t.procurementType))
  }
  if (filters.buyer) {
    const b = filters.buyer.toLowerCase()
    items = items.filter((t) => t.buyer.toLowerCase().includes(b))
  }
  if (filters.dateFrom) items = items.filter((t) => t.announcementDate >= filters.dateFrom!)
  if (filters.dateTo) items = items.filter((t) => t.announcementDate <= filters.dateTo!)
  if (filters.deadlineFrom) {
    items = items.filter((t) => t.bidDeadline && t.bidDeadline >= filters.deadlineFrom!)
  }
  if (filters.deadlineTo) {
    items = items.filter((t) => t.bidDeadline && t.bidDeadline <= filters.deadlineTo!)
  }
  if (filters.withinDeadline) {
    const today = formatISO(new Date(), { representation: 'date' })
    items = items.filter((t) => t.bidDeadline && t.bidDeadline.slice(0, 10) >= today)
  }
  if (filters.amountFrom != null) {
    items = items.filter((t) => (t.estimatedValue ?? 0) >= filters.amountFrom!)
  }
  if (filters.amountTo != null) {
    items = items.filter((t) => (t.estimatedValue ?? 0) <= filters.amountTo!)
  }
  if (filters.bidderCountMin != null) {
    items = items.filter((t) => t.bidderCount >= filters.bidderCountMin!)
  }
  if (filters.bidderCountMax != null) {
    items = items.filter((t) => t.bidderCount <= filters.bidderCountMax!)
  }

  const sortBy = filters.sortBy ?? 'announcementDate'
  const sortDir = filters.sortDir ?? 'desc'
  items.sort((a, b) => {
    const av = a[sortBy]
    const bv = b[sortBy]
    if (av == null && bv == null) return 0
    if (av == null) return 1
    if (bv == null) return -1
    if (av < bv) return sortDir === 'asc' ? -1 : 1
    if (av > bv) return sortDir === 'asc' ? 1 : -1
    return 0
  })
  return items
}

const OPEN_STATUSES = new Set([
  'Tender announced',
  'Bidding commenced',
  'Bidding ended',
  'Selection/Evaluation',
])

export const mockApi: DataSource = {
  async getStats(): Promise<DashboardStats> {
    await delay()
    const tracked = new Set(mockTrackedStore.list().filter((c) => c.enabled).map((c) => c.code))
    const items = MOCK_TENDERS.filter((t) => tracked.has(t.categoryCode))
    const today = formatISO(new Date(), { representation: 'date' })
    const in7 = formatISO(addDays(new Date(), 7), { representation: 'date' })

    const openTenders = items.filter((t) => OPEN_STATUSES.has(t.status)).length
    const closingSoon = items
      .filter((t) => t.bidDeadline && t.bidDeadline >= today && t.bidDeadline <= in7 && OPEN_STATUSES.has(t.status))
      .sort((a, b) => (a.bidDeadline ?? '').localeCompare(b.bidDeadline ?? ''))

    const values = items.map((t) => t.estimatedValue ?? 0)
    const totalEstimatedValue = values.reduce((a, b) => a + b, 0)

    const monthMap = new Map<string, { categoryCode: string; categoryName: string; count: number; value: number }>()
    for (const t of items) {
      const month = t.announcementDate.slice(0, 7)
      const key = `${month}|${t.categoryCode}`
      const cur = monthMap.get(key) ?? {
        categoryCode: t.categoryCode,
        categoryName: t.categoryName,
        count: 0,
        value: 0,
      }
      cur.count += 1
      cur.value += t.estimatedValue ?? 0
      monthMap.set(key, cur)
    }

    const catMap = new Map<string, { categoryCode: string; categoryName: string; count: number; value: number }>()
    for (const t of items) {
      const cur = catMap.get(t.categoryCode) ?? {
        categoryCode: t.categoryCode,
        categoryName: t.categoryName,
        count: 0,
        value: 0,
      }
      cur.count += 1
      cur.value += t.estimatedValue ?? 0
      catMap.set(t.categoryCode, cur)
    }

    const statusMap = new Map<string, number>()
    for (const t of items) statusMap.set(t.status, (statusMap.get(t.status) ?? 0) + 1)

    const buyerMap = new Map<string, { count: number; value: number }>()
    for (const t of items) {
      const cur = buyerMap.get(t.buyer) ?? { count: 0, value: 0 }
      cur.count += 1
      cur.value += t.estimatedValue ?? 0
      buyerMap.set(t.buyer, cur)
    }

    const lastRun = MOCK_RUNS.find((r) => r.status !== 'running')
    const newlyAdded = [...items]
      .sort((a, b) => b.announcementDate.localeCompare(a.announcementDate))
      .slice(0, 4)

    return {
      totalTenders: items.length,
      openTenders,
      closingWithin7Days: closingSoon.length,
      totalEstimatedValue,
      averageEstimatedValue: items.length ? totalEstimatedValue / items.length : 0,
      currency: 'GEL',
      byMonth: [...monthMap.entries()]
        .map(([key, v]) => ({ month: key.split('|')[0]!, ...v }))
        .sort((a, b) => a.month.localeCompare(b.month)),
      byCategory: [...catMap.values()].sort((a, b) => b.count - a.count),
      byStatus: [...statusMap.entries()].map(([status, count]) => ({ status, count })),
      topBuyers: [...buyerMap.entries()]
        .map(([buyer, v]) => ({ buyer, ...v }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 10),
      closingSoon: closingSoon.slice(0, 8).map(toSummary),
      newSince: {
        since: lastRun?.startedAt ?? null,
        runId: lastRun?.id ?? null,
        runStatus: lastRun?.status ?? null,
        runFinishedAt: lastRun?.finishedAt ?? null,
        count: newlyAdded.length,
        items: newlyAdded.map(toSummary),
      },
    }
  },

  async getTenders(filters: TenderFilters): Promise<Paginated<TenderSummary>> {
    await delay()
    const items = filterTenders(filters)
    const page = filters.page ?? 1
    const pageSize = filters.pageSize ?? 20
    const start = (page - 1) * pageSize
    return {
      items: items.slice(start, start + pageSize).map(toSummary),
      total: items.length,
      page,
      pageSize,
    }
  },

  async getTender(appId: number): Promise<TenderDetail> {
    await delay()
    const t = MOCK_TENDERS.find((x) => x.appId === appId)
    if (!t) throw new Error(`Tender ${appId} not found`)
    return t
  },

  async getFilterOptions(): Promise<FilterOptions> {
    await delay(80)
    const trackedList = mockTrackedStore.list()
    const tracked = new Set(trackedList.filter((c) => c.enabled).map((c) => c.code))
    const items = MOCK_TENDERS.filter((t) => tracked.has(t.categoryCode))
    return {
      statuses: [...new Set(items.map((t) => t.status))].sort(),
      procurementTypes: [...new Set(items.map((t) => t.procurementType))].sort(),
      buyers: [...new Set(items.map((t) => t.buyer))].sort(),
      categories: trackedList.map(({ id, code, name }) => ({ id, code, name })),
      trackedCategories: [...trackedList],
    }
  },

  async getAllCategories() {
    await delay(50)
    return ALL_CPV_CATEGORIES
  },

  async getTrackedCategories(): Promise<TrackedCategory[]> {
    await delay(50)
    return [...mockTrackedStore.list()]
  },

  async addTrackedCategory(categoryId: number): Promise<TrackedCategory> {
    await delay()
    const cat = ALL_CPV_CATEGORIES.find((c) => c.id === categoryId)
    if (!cat) throw new Error('Category not found')
    const existing = mockTrackedStore.list().find((c) => c.id === categoryId)
    if (existing) return existing
    const entry: TrackedCategory = {
      ...cat,
      enabled: true,
      tenderCount: 0,
      lastScrapedAt: null,
    }
    mockTrackedStore.set([...mockTrackedStore.list(), entry])
    return entry
  },

  async removeTrackedCategory(categoryId: number): Promise<void> {
    await delay()
    mockTrackedStore.set(mockTrackedStore.list().filter((c) => c.id !== categoryId))
  },

  async triggerBackfill(
    categoryId: number,
    options?: { dateFrom?: string; days?: number },
  ): Promise<ScrapeRun> {
    await delay(300)
    const cat = mockTrackedStore.list().find((c) => c.id === categoryId)
    const run: ScrapeRun = {
      id: MOCK_RUNS.length + 1,
      startedAt: formatISO(new Date()),
      finishedAt: null,
      status: 'running',
      mode: 'backfill',
      categories: cat ? [cat.code] : [],
      tendersFound: 12,
      tendersUpserted: 0,
      tendersSkipped: 0,
      tendersProcessed: 0,
      progressTotal: 12,
      categoriesDone: 0,
      categoriesTotal: 1,
      currentCategory: cat?.code ?? null,
      progressPercent: 0,
      dateFrom: options?.dateFrom ?? null,
      dateTo: formatISO(new Date()).slice(0, 10),
      categoryIds: [categoryId],
      resumedFrom: null,
      canResume: false,
      errors: [],
    }
    MOCK_RUNS.unshift(run)
    // Simulate progress then complete
    void (async () => {
      for (let i = 1; i <= 12; i++) {
        await delay(400)
        const active = MOCK_RUNS.find((r) => r.id === run.id)
        if (!active || active.status !== 'running') return
        active.tendersUpserted = i
        active.tendersProcessed = i
        active.progressPercent = Math.round((100 * i) / 12)
        if (i === 12) {
          active.status = 'success'
          active.finishedAt = formatISO(new Date())
          active.currentCategory = null
          active.categoriesDone = 1
          if (cat) {
            cat.lastScrapedAt = formatISO(new Date())
            cat.tenderCount += 12
          }
        }
      }
    })()
    return run
  },

  async getScrapeHealth(): Promise<ScrapeHealth> {
    await delay(80)
    const active = MOCK_RUNS.find((r) => r.status === 'running') ?? null
    const success = MOCK_RUNS.find((r) => r.status === 'success')
    return {
      runs: [...MOCK_RUNS],
      activeRun: active,
      nextScheduledAt: formatISO(addDays(new Date(), 1)),
      lastSuccessAt: success?.finishedAt ?? null,
    }
  },

  async stopScrape(): Promise<{ ok: boolean; run: ScrapeRun | null }> {
    await delay(120)
    const active = MOCK_RUNS.find((r) => r.status === 'running')
    if (!active) {
      throw new Error('No active scrape to stop')
    }
    active.status = 'cancelled'
    active.finishedAt = formatISO(new Date())
    active.currentCategory = null
    active.canResume = Boolean(active.dateFrom)
    if (!active.errors.includes('Stopped by user')) {
      active.errors = [...active.errors, 'Stopped by user']
    }
    return { ok: true, run: active }
  },

  async resumeRun(runId: number): Promise<ScrapeRun> {
    await delay(200)
    const previous = MOCK_RUNS.find((r) => r.id === runId)
    if (!previous || !previous.canResume) {
      throw new Error('This run cannot be resumed')
    }
    const categoryId = previous.categoryIds?.[0]
    if (categoryId == null) {
      throw new Error('This run has no categories to resume')
    }
    return mockApi.triggerBackfill(categoryId, { dateFrom: previous.dateFrom ?? undefined })
  },
}
