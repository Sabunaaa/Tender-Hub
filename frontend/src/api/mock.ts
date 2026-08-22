import { addDays, formatISO, subDays } from 'date-fns'
import { DEVICE_KEYWORD_ALIASES } from '../lib/tenderFilters'
import { ALL_CPV_CATEGORIES } from './cpvCategories'
import { MOCK_RUNS, MOCK_TENDERS, mockTrackedStore } from './fixtures'
import type {
  AppSettings,
  DashboardStats,
  DataSource,
  Engagement,
  FilterOptions,
  Paginated,
  ScrapeHealth,
  ScrapeRun,
  SettingsUpdate,
  TenderDetail,
  TenderFilters,
  TenderSummary,
  TrackedCategory,
  Weekday,
} from './types'

const WEEKDAYS: Weekday[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']
const JS_DAY_TO_WEEKDAY: Weekday[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']

function mockNextScheduledAt(
  settings: Pick<AppSettings, 'scheduleEnabled' | 'scheduleTimes' | 'scheduleDays'>,
): string | null {
  if (!settings.scheduleEnabled || settings.scheduleDays.length === 0) return null
  if (settings.scheduleTimes.length === 0) return null
  const now = new Date()
  for (let offset = 0; offset < 8; offset += 1) {
    const base = new Date(now)
    base.setDate(now.getDate() + offset)
    const day = JS_DAY_TO_WEEKDAY[base.getDay()]
    if (!day || !settings.scheduleDays.includes(day)) continue
    for (const time of [...settings.scheduleTimes].sort()) {
      const [hours, minutes] = time.split(':').map(Number)
      if (hours == null || minutes == null || Number.isNaN(hours) || Number.isNaN(minutes)) continue
      const candidate = new Date(base)
      candidate.setHours(hours, minutes, 0, 0)
      if (candidate > now) return formatISO(candidate)
    }
  }
  return null
}

function withDerivedSettings(base: Omit<AppSettings, 'nextScheduledAt'>): AppSettings {
  return {
    ...base,
    nextScheduledAt: mockNextScheduledAt(base),
  }
}

let mockSettings: AppSettings = withDerivedSettings({
  scheduleEnabled: true,
  scheduleTimes: ['06:00', '18:00'],
  scheduleDays: [...WEEKDAYS],
  dailyLookbackDays: 3,
  requestDelaySeconds: 1,
  maxRequestsPerSecond: 2,
  scrapeConcurrency: 4,
  requestTimeoutSeconds: 60,
  closingSoonDays: 7,
  defaultPageSize: 20,
  accountManagers: ['Nino Beridze', 'Luka Kapanadze'],
  solutionManagers: ['Giorgi Maisuradze'],
  taskStatus: {
    registered: true,
    taskName: 'TenderDashboardDailyScrape',
    state: 'Ready',
    lastRunAt: MOCK_RUNS.find((r) => r.status === 'success')?.finishedAt ?? null,
    lastTaskResult: 0,
    message: 'Mock schedule is stored in memory only.',
  },
})

let mockEngagements: Engagement[] = []

function delay(ms = 180): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

function toSummary(t: TenderDetail): TenderSummary {
  const {
    appId, key, announcementNumber, title, status, procurementType, donor, buyer, buyerOrgId,
    categoryCode, categoryName, announcementDate, bidDeadline, bidsAcceptedFrom,
    estimatedValue, currency, bidderCount, winner, contractStatus, sourceUrl, hasSpecText,
  } = t
  return {
    appId, key, announcementNumber, title, status, procurementType, donor, buyer, buyerOrgId,
    categoryCode, categoryName, announcementDate, bidDeadline, bidsAcceptedFrom,
    estimatedValue, currency, bidderCount, winner, contractStatus, sourceUrl, hasSpecText,
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
  if (filters.keywords?.length) {
    const terms = filters.keywords.flatMap((key) => DEVICE_KEYWORD_ALIASES[key] ?? [key])
    items = items.filter((t) => {
      const hay = [
        t.title,
        t.description,
        t.additionalInfo,
        t.amountOrVolume,
        t.specText,
        ...t.documentSections.flatMap((s) => [s.title, s.body]),
      ]
        .filter(Boolean)
        .join('\n')
        .toLowerCase()
      return terms.some((term) => hay.includes(term.toLowerCase()))
    })
  }
  if (filters.categoryCodes?.length) {
    const set = new Set(filters.categoryCodes)
    items = items.filter((t) => set.has(t.categoryCode))
  }
  const cpvCode = filters.cpvCode
  if (cpvCode) {
    items = items.filter((t) => t.cpvCodes.some((c) => c.code.includes(cpvCode)))
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
  const dateFrom = filters.dateFrom
  const dateTo = filters.dateTo
  const deadlineFrom = filters.deadlineFrom
  const deadlineTo = filters.deadlineTo
  if (dateFrom) items = items.filter((t) => t.announcementDate >= dateFrom)
  if (dateTo) items = items.filter((t) => t.announcementDate <= dateTo)
  if (deadlineFrom) {
    items = items.filter((t) => t.bidDeadline && t.bidDeadline >= deadlineFrom)
  }
  if (deadlineTo) {
    items = items.filter((t) => t.bidDeadline && t.bidDeadline <= deadlineTo)
  }
  if (filters.withinDeadline) {
    const today = formatISO(new Date(), { representation: 'date' })
    items = items.filter((t) => t.bidDeadline && t.bidDeadline.slice(0, 10) >= today)
  }
  if (filters.hasSpec) {
    items = items.filter((t) => t.hasSpecText)
  }
  const amountFrom = filters.amountFrom
  const amountTo = filters.amountTo
  const bidderCountMin = filters.bidderCountMin
  const bidderCountMax = filters.bidderCountMax
  if (amountFrom != null) {
    items = items.filter((t) => (t.estimatedValue ?? 0) >= amountFrom)
  }
  if (amountTo != null) {
    items = items.filter((t) => (t.estimatedValue ?? 0) <= amountTo)
  }
  if (bidderCountMin != null) {
    items = items.filter((t) => t.bidderCount >= bidderCountMin)
  }
  if (bidderCountMax != null) {
    items = items.filter((t) => t.bidderCount <= bidderCountMax)
  }

  const sortBy = filters.sortBy ?? 'announcementDate'
  const sortDir = filters.sortDir ?? 'desc'
  const sortValue = (t: TenderDetail): string | number | null => {
    switch (sortBy) {
      case 'announcementDate':
        return t.announcementDate
      case 'bidDeadline':
        return t.bidDeadline
      case 'estimatedValue':
        return t.estimatedValue
      case 'status':
        return t.status
      case 'buyer':
        return t.buyer
    }
  }
  items.sort((a, b) => {
    const av = sortValue(a)
    const bv = sortValue(b)
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
    const horizon = mockSettings.closingSoonDays
    const inHorizon = formatISO(addDays(new Date(), horizon), { representation: 'date' })

    const openTenders = items.filter((t) => OPEN_STATUSES.has(t.status)).length
    const closingSoon = items
      .filter((t) => t.bidDeadline && t.bidDeadline >= today && t.bidDeadline <= inHorizon && OPEN_STATUSES.has(t.status))
      .sort((a, b) => (a.bidDeadline ?? '').localeCompare(b.bidDeadline ?? ''))

    const weekStart = formatISO(subDays(new Date(), 6), { representation: 'date' })
    const newThisWeek = items.filter((t) => t.announcementDate.slice(0, 10) >= weekStart).length
    const trackedIds = new Set(mockEngagements.map((e) => e.appId).filter((id): id is number => id != null))
    const trackedNumbers = new Set(mockEngagements.map((e) => e.announcementNumber.toLowerCase()))
    const openUntracked = items.filter((t) => {
      if (!OPEN_STATUSES.has(t.status)) return false
      return !trackedIds.has(t.appId) && !trackedNumbers.has(t.announcementNumber.toLowerCase())
    }).length

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

    const catMap = new Map<string, { categoryCode: string; categoryName: string; count: number; openCount: number; value: number }>()
    for (const t of items) {
      const cur = catMap.get(t.categoryCode) ?? {
        categoryCode: t.categoryCode,
        categoryName: t.categoryName,
        count: 0,
        openCount: 0,
        value: 0,
      }
      cur.count += 1
      if (OPEN_STATUSES.has(t.status)) cur.openCount += 1
      cur.value += t.estimatedValue ?? 0
      catMap.set(t.categoryCode, cur)
    }

    const statusMap = new Map<string, number>()
    for (const t of items) statusMap.set(t.status, (statusMap.get(t.status) ?? 0) + 1)

    const buyerMap = new Map<string, { count: number; openCount: number; value: number }>()
    for (const t of items) {
      const cur = buyerMap.get(t.buyer) ?? { count: 0, openCount: 0, value: 0 }
      cur.count += 1
      if (OPEN_STATUSES.has(t.status)) cur.openCount += 1
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
      closingSoonDays: horizon,
      newThisWeek,
      openUntracked,
      onEngagement: mockEngagements.length,
      engagedCount: mockEngagements.filter((e) => e.engaged).length,
      currency: 'GEL',
      byMonth: [...monthMap.entries()]
        .map(([key, v]) => ({ month: key.split('|')[0]!, ...v }))
        .sort((a, b) => a.month.localeCompare(b.month)),
      byCategory: [...catMap.values()].sort((a, b) => b.openCount - a.openCount || b.count - a.count),
      byStatus: [...statusMap.entries()].map(([status, count]) => ({ status, count })),
      topBuyers: [...buyerMap.entries()]
        .map(([buyer, v]) => ({ buyer, ...v }))
        .sort((a, b) => b.openCount - a.openCount || b.count - a.count)
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

  async triggerRescrape(categoryId: number): Promise<ScrapeRun> {
    const run = await mockApi.triggerBackfill(categoryId)
    run.mode = 'rescrape'
    return run
  },

  async getScrapeHealth(): Promise<ScrapeHealth> {
    await delay(80)
    const active = MOCK_RUNS.find((r) => r.status === 'running') ?? null
    const success = MOCK_RUNS.find((r) => r.status === 'success')
    return {
      runs: [...MOCK_RUNS],
      activeRun: active,
      nextScheduledAt: mockSettings.nextScheduledAt,
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

  async triggerDailyScrape() {
    await delay(200)
    const run: ScrapeRun = {
      id: MOCK_RUNS.length + 1,
      startedAt: formatISO(new Date()),
      finishedAt: formatISO(new Date()),
      status: 'success',
      mode: 'daily',
      categories: mockTrackedStore.list().map((c) => c.code),
      tendersFound: 8,
      tendersUpserted: 2,
      tendersSkipped: 6,
      tendersProcessed: 8,
      progressTotal: 8,
      categoriesDone: mockTrackedStore.list().length,
      categoriesTotal: mockTrackedStore.list().length,
      currentCategory: null,
      progressPercent: 100,
      dateFrom: formatISO(addDays(new Date(), -mockSettings.dailyLookbackDays), { representation: 'date' }),
      dateTo: formatISO(new Date(), { representation: 'date' }),
      categoryIds: mockTrackedStore.list().map((c) => c.id),
      resumedFrom: null,
      canResume: false,
      errors: [],
    }
    MOCK_RUNS.unshift(run)
    return { ok: true, runId: run.id, message: 'Daily scrape started' }
  },

  async getSettings() {
    await delay(80)
    return { ...mockSettings, taskStatus: { ...mockSettings.taskStatus } }
  },

  async updateSettings(patch: SettingsUpdate) {
    await delay(160)
    const nextDays = patch.scheduleDays ?? mockSettings.scheduleDays
    if ((patch.scheduleEnabled ?? mockSettings.scheduleEnabled) && nextDays.length === 0) {
      throw new Error('Pick at least one weekday to enable the schedule.')
    }
    const next = withDerivedSettings({
      ...mockSettings,
      ...patch,
      scheduleDays: nextDays,
      taskStatus: {
        ...mockSettings.taskStatus,
        registered: Boolean(patch.scheduleEnabled ?? mockSettings.scheduleEnabled),
        state: (patch.scheduleEnabled ?? mockSettings.scheduleEnabled) ? 'Ready' : 'Disabled',
        message: (patch.scheduleEnabled ?? mockSettings.scheduleEnabled)
          ? 'Mock schedule updated in memory.'
          : 'Mock schedule is off.',
      },
    })
    mockSettings = next
    return { ...mockSettings, taskStatus: { ...mockSettings.taskStatus } }
  },

  async listEngagements() {
    await delay(80)
    return [...mockEngagements]
  },

  async addEngagement(announcementNumber: string) {
    await delay(120)
    const code = announcementNumber.trim()
    const tender = MOCK_TENDERS.find(
      (t) => t.announcementNumber.toLowerCase() === code.toLowerCase() || String(t.appId) === code,
    )
    if (!tender) throw new Error(`No scraped tender matches announcement number “${code}”.`)
    if (mockEngagements.some((e) => e.announcementNumber === tender.announcementNumber)) {
      throw new Error('That tender is already on the engagement list.')
    }
    const now = formatISO(new Date())
    const row: Engagement = {
      id: mockEngagements.length ? Math.max(...mockEngagements.map((e) => e.id)) + 1 : 1,
      announcementNumber: tender.announcementNumber,
      appId: tender.appId,
      engaged: false,
      accountManager: '',
      solutionManager: '',
      product: '',
      title: tender.title,
      buyer: tender.buyer,
      procurementType: tender.procurementType,
      donor: tender.donor || '',
      status: tender.status,
      categoryCode: tender.categoryCode,
      categoryName: tender.categoryName,
      announcementDate: tender.announcementDate,
      bidsAcceptedFrom: tender.bidsAcceptedFrom,
      bidDeadline: tender.bidDeadline,
      estimatedValue: tender.estimatedValue,
      currency: tender.currency,
      bidderCount: tender.bidderCount,
      createdAt: now,
      updatedAt: now,
    }
    mockEngagements.unshift(row)
    return row
  },

  async updateEngagement(id, patch) {
    await delay(80)
    const idx = mockEngagements.findIndex((e) => e.id === id)
    if (idx < 0) throw new Error('Engagement not found.')
    const current = mockEngagements[idx]!
    const next = {
      ...current,
      ...patch,
      updatedAt: formatISO(new Date()),
    }
    mockEngagements[idx] = next
    return next
  },

  async deleteEngagement(id) {
    await delay(80)
    mockEngagements = mockEngagements.filter((e) => e.id !== id)
  },
}
