import { formatISO, subDays } from 'date-fns'
import type { TenderFilters } from '../api/types'

const SORT_BY = ['announcementDate', 'bidDeadline', 'estimatedValue', 'status', 'buyer'] as const
const SORT_DIR = ['asc', 'desc'] as const

export const DEVICE_KEYWORDS = [
  { id: 'switch', label: 'Switch' },
  { id: 'router', label: 'Router' },
  { id: 'firewall', label: 'Firewall' },
  { id: 'wifi', label: 'Wi-Fi / AP' },
  { id: 'storage', label: 'Storage' },
  { id: 'screen', label: 'Smart screen' },
] as const

/** Must stay in sync with backend/tender_scraper/keywords.py */
export const DEVICE_KEYWORD_ALIASES: Record<string, string[]> = {
  storage: ['სტორიჯ', 'მონაცემთა საცავ', 'დისკური მასივ'],
  switch: ['კომუტატორ', 'სვიჩ', 'აქტიური ქსელ', 'ქსელური ინფრასტრუქტ'],
  router: ['მარშრუტიზატორ', 'sd-wan', 'sdwan'],
  firewall: ['ფაიერვოლ', 'ფაირვოლ', 'ბრანდმაუერ', 'firewall', 'ngfw'],
  wifi: ['წვდომის წერტილ', 'დაშვების წერტილ'],
  screen: ['სმარტ ეკრან', 'ინტერაქტიული ეკრან', 'ideahub'],
}

function parseList(value: string | null): string[] | undefined {
  if (!value) return undefined
  return value.split(',').filter(Boolean)
}

function parsePositiveInt(value: string | null, fallback: number, min: number, max: number): number {
  if (value == null || value === '') return fallback
  const n = Number(value)
  if (!Number.isFinite(n) || n < min) return fallback
  return Math.min(max, Math.trunc(n))
}

function parseOptionalNumber(value: string | null): number | undefined {
  if (!value) return undefined
  const n = Number(value)
  return Number.isFinite(n) ? n : undefined
}

export function filtersFromParams(
  params: URLSearchParams,
  defaults?: { pageSize?: number },
): TenderFilters {
  const sortByRaw = params.get('sortBy')
  const sortDirRaw = params.get('sortDir')
  const sortBy = SORT_BY.includes(sortByRaw as (typeof SORT_BY)[number])
    ? (sortByRaw as TenderFilters['sortBy'])
    : 'announcementDate'
  const sortDir = SORT_DIR.includes(sortDirRaw as (typeof SORT_DIR)[number])
    ? (sortDirRaw as TenderFilters['sortDir'])
    : 'desc'

  const preset = activeDatePreset(params)
  const today = formatISO(new Date(), { representation: 'date' })
  let dateFrom = params.get('dateFrom') ?? undefined
  let dateTo = params.get('dateTo') ?? undefined
  let deadlineFrom = params.get('deadlineFrom') ?? undefined
  let deadlineTo = params.get('deadlineTo') ?? undefined
  if (preset === '7d' && !deadlineFrom && !deadlineTo) {
    deadlineFrom = today
    deadlineTo = formatISO(subDays(new Date(), -7), { representation: 'date' })
  }

  return {
    q: params.get('q') ?? undefined,
    keywords: parseList(params.get('keywords')),
    categoryCodes: parseList(params.get('categories')),
    cpvCode: params.get('cpv') ?? undefined,
    status: parseList(params.get('status')),
    procurementType: parseList(params.get('type')),
    buyer: params.get('buyer') ?? undefined,
    dateFrom,
    dateTo,
    deadlineFrom,
    deadlineTo,
    withinDeadline: params.get('withinDeadline') === '1' ? true : undefined,
    hasSpec: params.get('hasSpec') === '1' ? true : undefined,
    amountFrom: parseOptionalNumber(params.get('amountFrom')),
    amountTo: parseOptionalNumber(params.get('amountTo')),
    bidderCountMin: parseOptionalNumber(params.get('biddersMin')),
    bidderCountMax: parseOptionalNumber(params.get('biddersMax')),
    page: parsePositiveInt(params.get('page'), 1, 1, 10_000),
    pageSize: parsePositiveInt(params.get('pageSize'), defaults?.pageSize ?? 20, 1, 100),
    sortBy,
    sortDir,
  }
}

export function activeDatePreset(params: URLSearchParams): string | null {
  return params.get('preset') ?? params.get('deadlinePreset')
}

export { parseList }
