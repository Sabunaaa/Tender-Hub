/** Shared domain types used by mock and HTTP API clients. */

export interface CpvCategory {
  id: number
  code: string
  name: string
  nameKa?: string
}

export interface TrackedCategory extends CpvCategory {
  enabled: boolean
  tenderCount: number
  lastScrapedAt: string | null
}

export interface TenderCpvCode {
  code: string
  name: string
}

export interface TenderAttachment {
  id: string
  name: string
  url: string
  uploadedAt?: string
}

export interface TenderDocumentSection {
  id: string
  title: string
  body: string
  language: 'en' | 'ka'
  attachments: TenderAttachment[]
}

export interface TenderBid {
  bidderName: string
  bidderOrgId?: number
  firstOfferAmount: number | null
  firstOfferAt: string | null
  lastOfferAmount: number | null
  lastOfferAt: string | null
  offerCount: number
}

export interface StatusHistoryEntry {
  status: string
  changedAt: string
}

export interface TenderSummary {
  appId: number
  key: string
  announcementNumber: string
  title: string
  status: string
  procurementType: string
  buyer: string
  buyerOrgId?: number
  categoryCode: string
  categoryName: string
  announcementDate: string
  bidDeadline: string | null
  bidsAcceptedFrom: string | null
  estimatedValue: number | null
  currency: string
  bidderCount: number
  winner?: string | null
  contractStatus?: string | null
  sourceUrl: string
}

export interface TenderDetail extends TenderSummary {
  description: string
  supplyPeriod: string | null
  vatTerms: string | null
  guaranteeAmount: number | null
  guaranteeValidity: string | null
  bidReductionStep: number | null
  amountOrVolume: string | null
  additionalInfo: string | null
  specText: string
  cpvCodes: TenderCpvCode[]
  documentSections: TenderDocumentSection[]
  attachments: TenderAttachment[]
  bids: TenderBid[]
  statusHistory: StatusHistoryEntry[]
  resultDocuments: TenderAttachment[]
  scrapedAt: string
}

export interface TenderFilters {
  q?: string
  /** Device/topic chips: switch, router, firewall, wifi, storage, screen, or a custom term. */
  keywords?: string[]
  categoryCodes?: string[]
  cpvCode?: string
  status?: string[]
  procurementType?: string[]
  buyer?: string
  dateFrom?: string
  dateTo?: string
  deadlineFrom?: string
  deadlineTo?: string
  /** When true, only tenders whose bid deadline is today or later. */
  withinDeadline?: boolean
  amountFrom?: number
  amountTo?: number
  bidderCountMin?: number
  bidderCountMax?: number
  page?: number
  pageSize?: number
  sortBy?: 'announcementDate' | 'bidDeadline' | 'estimatedValue' | 'status' | 'buyer'
  sortDir?: 'asc' | 'desc'
}

export interface Paginated<T> {
  items: T[]
  total: number
  page: number
  pageSize: number
}

/** Tenders first seen by the most recent completed scrape run. */
export interface NewSinceLastRun {
  since: string | null
  runId: number | null
  runStatus: string | null
  runFinishedAt: string | null
  count: number
  items: TenderSummary[]
}

export interface DashboardStats {
  totalTenders: number
  openTenders: number
  closingWithin7Days: number
  closingSoonDays?: number
  totalEstimatedValue: number
  averageEstimatedValue: number
  currency: string
  byMonth: { month: string; categoryCode: string; categoryName: string; count: number; value: number }[]
  byCategory: { categoryCode: string; categoryName: string; count: number; value: number }[]
  byStatus: { status: string; count: number }[]
  topBuyers: { buyer: string; count: number; value: number }[]
  closingSoon: TenderSummary[]
  newSince?: NewSinceLastRun
}

export interface FilterOptions {
  statuses: string[]
  procurementTypes: string[]
  buyers: string[]
  categories: CpvCategory[]
  trackedCategories: TrackedCategory[]
}

export interface ScrapeRun {
  id: number
  startedAt: string
  finishedAt: string | null
  status: 'running' | 'success' | 'failed' | 'partial' | 'cancelled'
  mode: 'daily' | 'backfill' | 'manual'
  categories: string[]
  tendersFound: number
  tendersUpserted: number
  tendersSkipped?: number
  tendersProcessed?: number
  progressTotal?: number
  categoriesDone?: number
  categoriesTotal?: number
  currentCategory?: string | null
  progressPercent?: number
  dateFrom?: string | null
  dateTo?: string | null
  categoryIds?: number[] | null
  resumedFrom?: number | null
  canResume?: boolean
  errors: string[]
}

export interface ScrapeHealth {
  runs: ScrapeRun[]
  activeRun: ScrapeRun | null
  nextScheduledAt: string | null
  lastSuccessAt: string | null
}

export type Weekday = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun'

export interface TaskStatus {
  registered: boolean
  taskName: string
  state: string | null
  lastRunAt: string | null
  lastTaskResult: number | null
  message: string | null
}

export interface AppSettings {
  scheduleEnabled: boolean
  scheduleTime: string
  scheduleDays: Weekday[]
  dailyLookbackDays: number
  requestDelaySeconds: number
  maxRequestsPerSecond: number
  scrapeConcurrency: number
  requestTimeoutSeconds: number
  closingSoonDays: number
  defaultPageSize: number
  accountManagers: string[]
  solutionManagers: string[]
  nextScheduledAt: string | null
  taskStatus: TaskStatus
}

export type SettingsUpdate = Partial<
  Omit<AppSettings, 'nextScheduledAt' | 'taskStatus'>
>

export interface Engagement {
  id: number
  announcementNumber: string
  appId: number | null
  engaged: boolean
  accountManager: string
  solutionManager: string
  domain: string
  title: string
  buyer: string
  status: string
  categoryName: string
  announcementDate: string | null
  bidDeadline: string | null
  estimatedValue: number | null
  currency: string
  bidderCount: number
  createdAt: string
  updatedAt: string
}

export interface DataSource {
  getStats(): Promise<DashboardStats>
  getTenders(filters: TenderFilters): Promise<Paginated<TenderSummary>>
  getTender(appId: number): Promise<TenderDetail>
  getFilterOptions(): Promise<FilterOptions>
  getAllCategories(): Promise<CpvCategory[]>
  getTrackedCategories(): Promise<TrackedCategory[]>
  addTrackedCategory(categoryId: number): Promise<TrackedCategory>
  removeTrackedCategory(categoryId: number): Promise<void>
  triggerBackfill(categoryId: number, options?: { dateFrom?: string; days?: number }): Promise<ScrapeRun>
  getScrapeHealth(): Promise<ScrapeHealth>
  stopScrape(): Promise<{ ok: boolean; run: ScrapeRun | null }>
  resumeRun(runId: number): Promise<ScrapeRun>
  triggerDailyScrape(): Promise<{ ok: boolean; runId: number; message: string }>
  getSettings(): Promise<AppSettings>
  updateSettings(patch: SettingsUpdate): Promise<AppSettings>
  listEngagements(): Promise<Engagement[]>
  addEngagement(announcementNumber: string): Promise<Engagement>
  updateEngagement(
    id: number,
    patch: { engaged?: boolean; accountManager?: string; solutionManager?: string; domain?: string },
  ): Promise<Engagement>
  deleteEngagement(id: number): Promise<void>
}
