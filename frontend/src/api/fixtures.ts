import { addDays, formatISO, subDays } from 'date-fns'
import { TRACKED_CATEGORY_META } from './cpvCategories'
import type {
  ScrapeRun,
  TenderDetail,
  TrackedCategory,
} from './types'

const BUYERS = [
  'Ministry of Internal Affairs of Georgia',
  'Dusheti Municipality',
  'Tbilisi City Hall',
  'Ministry of Defence of Georgia',
  'Revenue Service',
  'Georgian National Botanic Garden',
  'Animals monitoring agency',
  'Ministry of Education and Science',
  'National Bank of Georgia',
  'Georgian Railway',
  'Batumi City Hall',
  'Kutaisi Municipality',
  'Public Service Development Agency',
  'Ministry of Justice of Georgia',
  'State Procurement Agency',
  'LEPL Digital Governance Agency',
  'Ministry of Economy and Sustainable Development',
  'Adjara Autonomous Republic Government',
  'Tbilisi Chugureti District Gamgeoba',
  'LTD "stadium of ramaz shengelia"',
]

const STATUSES = [
  'Tender announced',
  'Bidding commenced',
  'Bidding ended',
  'Selection/Evaluation',
  'Winner identified',
  'Contract awarded',
  'Contract not awarded',
  'Terminated',
  'Did not take place',
]

const PROCUREMENT_TYPES = [
  'Electronic Tender Without Reverse Auction(NAT)',
  'Electronic Tender With Reverse Auction(SPA)',
  'Simplified Electronic Tender Without Reverse Auction(NAT)',
  'Contest(CNT)',
  'Two-stage Electronic Tender(MEP)',
]

const CPV_BY_CATEGORY: Record<string, { code: string; name: string }[]> = {
  '30200000': [
    { code: '30200000', name: 'Computer equipment and supplies' },
    { code: '30213000', name: 'Personal computers' },
    { code: '30213100', name: 'Portable computers' },
    { code: '30213300', name: 'Desktop computer' },
    { code: '30232100', name: 'Printers and plotters' },
    { code: '30233100', name: 'Computer storage units' },
    { code: '30237000', name: 'Parts, accessories and supplies for computers' },
  ],
  '32400000': [
    { code: '32400000', name: 'Networks' },
    { code: '32410000', name: 'Local area network' },
    { code: '32412000', name: 'Communications network' },
    { code: '32420000', name: 'Network equipment' },
    { code: '32421000', name: 'Network cabling' },
    { code: '32422000', name: 'Network components' },
  ],
  '32500000': [
    { code: '32500000', name: 'Telecommunications equipment and supplies' },
    { code: '32510000', name: 'Wireless telecommunications system' },
    { code: '32520000', name: 'Telecommunications cable and equipment' },
    { code: '32522000', name: 'Telecommunications equipment' },
    { code: '32524000', name: 'Telecommunications system' },
  ],
}

const TITLES_KA: Record<string, string[]> = {
  '30200000': [
    'კომპიუტერული ტექნიკის შესყიდვა',
    'ლეპტოპებისა და აქსესუარების შესყიდვა',
    'სერვერებისა და სათავსო მოწყობილობების შესყიდვა',
    'პრინტერებისა და სახარჯი მასალების შესყიდვა',
    'სამუშაო სადგურების განახლება',
  ],
  '32400000': [
    'ქსელური ინფრასტრუქტურის მოდერნიზაცია',
    'LAN ქსელის მოწყობა',
    'ქსელური კომუტატორების შესყიდვა',
    'ქსელური კაბელებისა და აქსესუარების შესყიდვა',
  ],
  '32500000': [
    'სატელეკომუნიკაციო მოწყობილობების შესყიდვა',
    'რადიოკავშირის სისტემის განახლება',
    'IP ტელეფონიის აღჭურვილობის შესყიდვა',
  ],
}

const BIDDERS = [
  'შპს DENIZO',
  'შპს Techno Soft',
  'შპს NetLine Georgia',
  'შპს Digital Systems',
  'შპს Caucasus IT',
  'შპს SoftServe Caucasus',
  'შპს GeoCom',
  'შპს UniTech',
]

function seeded(n: number): () => number {
  let s = n
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296
    return s / 4294967296
  }
}

function pick<T>(rng: () => number, arr: T[]): T {
  return arr[Math.floor(rng() * arr.length)]!
}

function money(rng: () => number, min: number, max: number): number {
  return Math.round(min + rng() * (max - min))
}

function iso(d: Date): string {
  return formatISO(d, { representation: 'complete' })
}

function day(d: Date): string {
  return formatISO(d, { representation: 'date' })
}

function buildTender(index: number, categoryCode: string, announcement: Date): TenderDetail {
  const rng = seeded(index * 9973 + Number(categoryCode.slice(0, 5)))
  const meta = TRACKED_CATEGORY_META[categoryCode]!
  const cpvPool = CPV_BY_CATEGORY[categoryCode]!
  const status = pick(rng, STATUSES)
  const openish = ['Tender announced', 'Bidding commenced', 'Bidding ended', 'Selection/Evaluation'].includes(status)
  const deadline = addDays(announcement, 7 + Math.floor(rng() * 21))
  const acceptedFrom = addDays(announcement, 3 + Math.floor(rng() * 7))
  const value = money(rng, 5_000, 450_000)
  const bidderCount = openish && status === 'Tender announced' ? 0 : Math.floor(rng() * 6)
  const appId = 650000 + index
  const announcementNumber = `NAT26${String(100000 + index).slice(1)}`
  const buyer = pick(rng, BUYERS)
  const title = pick(rng, TITLES_KA[categoryCode]!)
  const cpvCodes = [cpvPool[0]!, pick(rng, cpvPool.slice(1))]
  const winner =
    status === 'Contract awarded' || status === 'Winner identified'
      ? pick(rng, BIDDERS)
      : null

  const statusHistory = [
    { status: 'Tender announced', changedAt: iso(announcement) },
  ]
  if (!['Tender announced'].includes(status)) {
    statusHistory.push({ status: 'Bidding commenced', changedAt: iso(acceptedFrom) })
  }
  if (['Bidding ended', 'Selection/Evaluation', 'Winner identified', 'Contract awarded', 'Contract not awarded'].includes(status)) {
    statusHistory.push({ status: 'Bidding ended', changedAt: iso(deadline) })
  }
  if (['Selection/Evaluation', 'Winner identified', 'Contract awarded', 'Contract not awarded'].includes(status)) {
    statusHistory.push({ status: 'Selection/Evaluation', changedAt: iso(addDays(deadline, 1)) })
  }
  if (status === 'Winner identified' || status === 'Contract awarded') {
    statusHistory.push({ status: 'Winner identified', changedAt: iso(addDays(deadline, 5)) })
  }
  if (status === 'Contract awarded') {
    statusHistory.push({ status: 'Contract awarded', changedAt: iso(addDays(deadline, 12)) })
  }
  if (status === 'Contract not awarded') {
    statusHistory.push({ status: 'Contract not awarded', changedAt: iso(addDays(deadline, 8)) })
  }
  if (status === 'Terminated' || status === 'Did not take place') {
    statusHistory.push({ status, changedAt: iso(addDays(announcement, 10)) })
  }

  const bids = Array.from({ length: bidderCount }, (_, i) => {
    const amount = Math.round(value * (0.7 + rng() * 0.35))
    const at = iso(addDays(acceptedFrom, i + 1))
    return {
      bidderName: BIDDERS[i % BIDDERS.length]!,
      bidderOrgId: 30000 + i,
      firstOfferAmount: amount,
      firstOfferAt: at,
      lastOfferAmount: amount,
      lastOfferAt: at,
      offerCount: 1,
    }
  })

  const hasSpecText = rng() > 0.4

  return {
    appId,
    key: `mockkey${appId}`,
    announcementNumber,
    title,
    status,
    procurementType: pick(rng, PROCUREMENT_TYPES),
    donor: rng() > 0.92 ? 'The World Bank' : '',
    buyer,
    buyerOrgId: 1000 + (index % 50),
    categoryCode,
    categoryName: meta.name,
    announcementDate: day(announcement),
    bidDeadline: day(deadline),
    bidsAcceptedFrom: day(acceptedFrom),
    estimatedValue: value,
    currency: 'GEL',
    bidderCount,
    winner,
    contractStatus: status === 'Contract awarded' ? 'Current contract' : null,
    sourceUrl: `https://tenders.procurement.gov.ge/public/?go=${appId}&lang=en`,
    hasSpecText,
    description: title,
    supplyPeriod: `ხელშეკრულების გაფორმებიდან ${30 + Math.floor(rng() * 120)} კალენდარული დღე`,
    vatTerms: rng() > 0.3 ? 'Including VAT' : 'Excluding VAT',
    guaranteeAmount: Math.round(value * 0.01),
    guaranteeValidity: `${90 + Math.floor(rng() * 90)} Day`,
    bidReductionStep: Math.round(value * 0.01),
    amountOrVolume: 'იხილეთ სატენდერო დოკუმენტაცია',
    additionalInfo: null,
    specText: hasSpecText
      ? 'ტექნიკური დავალება: ქსელური კომუტატორი, არანაკლებ 24 პორტი, PoE, მართვადი. მარშრუტიზატორი, firewall/NGFW.'
      : '',
    cpvCodes,
    documentSections: [
      {
        id: `${appId}-obj`,
        title: '1.1 name of an object of procurement',
        body: title,
        language: 'ka',
        attachments: [],
      },
      {
        id: `${appId}-tech`,
        title: '1.2 technical parameters of goods / description of services/works',
        body: 'სამუშაოები/მიწოდება უნდა განხორციელდეს შემსყიდველის მიერ წარმოდგენილი სატენდერო დოკუმენტაციის შესაბამისად. ტექნიკური მახასიათებლები მოცემულია მიბმულ ფაილებში.',
        language: 'ka',
        attachments: [
          {
            id: `${appId}-a1`,
            name: `ტექნიკური დავალება.pdf`,
            url: `https://tenders.procurement.gov.ge/public/library/files.php?mode=que&file=${appId}&code=1`,
          },
        ],
      },
    ],
    attachments: [
      {
        id: `${appId}-spec`,
        name: `ტექნიკური დავალება.pdf`,
        url: `https://tenders.procurement.gov.ge/public/library/files.php?mode=que&file=${appId}&code=1`,
      },
    ],
    bids,
    statusHistory,
    resultDocuments:
      status === 'Contract awarded'
        ? [
            {
              id: `${appId}-result`,
              name: `${announcementNumber}_protocol.pdf`,
              url: `https://tenders.procurement.gov.ge/public/library/files.php?mode=app&file=${appId}&code=2`,
            },
          ]
        : [],
    scrapedAt: iso(new Date()),
  }
}

function generateFixtures(): TenderDetail[] {
  const today = new Date()
  const tenders: TenderDetail[] = []
  let index = 1

  // Roughly proportional to real volume: ~75% computers, ~15% networks, ~10% telecom
  const plan: { code: string; count: number }[] = [
    { code: '30200000', count: 95 },
    { code: '32400000', count: 35 },
    { code: '32500000', count: 20 },
  ]

  for (const { code, count } of plan) {
    for (let i = 0; i < count; i++) {
      const daysAgo = Math.floor((i / count) * 360) + Math.floor((i * 7) % 11)
      const announcement = subDays(today, daysAgo)
      tenders.push(buildTender(index++, code, announcement))
    }
  }

  return tenders.sort((a, b) => b.announcementDate.localeCompare(a.announcementDate))
}

export const MOCK_TENDERS: TenderDetail[] = generateFixtures()

function DEFAULT_TRACKED(): TrackedCategory[] {
  return Object.entries(TRACKED_CATEGORY_META).map(([code, meta]) => ({
    id: meta.id,
    code,
    name: meta.name,
    enabled: true,
    tenderCount: MOCK_TENDERS.filter((t) => t.categoryCode === code).length,
    lastScrapedAt: iso(subDays(new Date(), 0)),
  }))
}

/** Mutable tracked-category store for the mock API. */
export const mockTrackedStore = {
  items: DEFAULT_TRACKED(),
  list(): TrackedCategory[] {
    return this.items
  },
  set(items: TrackedCategory[]) {
    this.items = items
  },
  reset() {
    this.items = DEFAULT_TRACKED()
  },
}

export const MOCK_RUNS: ScrapeRun[] = [
  {
    id: 4,
    startedAt: iso(subDays(new Date(), 0)),
    finishedAt: iso(subDays(new Date(), 0)),
    status: 'success',
    mode: 'daily',
    categories: ['30200000', '32400000', '32500000'],
    tendersFound: 3,
    tendersUpserted: 3,
    progressTotal: 3,
    categoriesDone: 3,
    categoriesTotal: 3,
    currentCategory: null,
    progressPercent: 100,
    errors: [],
  },
  {
    id: 3,
    startedAt: iso(subDays(new Date(), 1)),
    finishedAt: iso(subDays(new Date(), 1)),
    status: 'success',
    mode: 'daily',
    categories: ['30200000', '32400000', '32500000'],
    tendersFound: 2,
    tendersUpserted: 2,
    progressTotal: 2,
    categoriesDone: 3,
    categoriesTotal: 3,
    currentCategory: null,
    progressPercent: 100,
    errors: [],
  },
  {
    id: 2,
    startedAt: iso(subDays(new Date(), 2)),
    finishedAt: iso(subDays(new Date(), 2)),
    status: 'partial',
    mode: 'daily',
    categories: ['30200000', '32400000', '32500000'],
    tendersFound: 4,
    tendersUpserted: 3,
    progressTotal: 4,
    categoriesDone: 3,
    categoriesTotal: 3,
    currentCategory: null,
    progressPercent: 100,
    errors: ['Timeout fetching app_docs for app_id=650012'],
  },
  {
    id: 1,
    startedAt: iso(subDays(new Date(), 5)),
    finishedAt: iso(subDays(new Date(), 5)),
    status: 'success',
    mode: 'backfill',
    categories: ['30200000', '32400000', '32500000'],
    tendersFound: 150,
    tendersUpserted: 150,
    progressTotal: 150,
    categoriesDone: 3,
    categoriesTotal: 3,
    currentCategory: null,
    progressPercent: 100,
    errors: [],
  },
]
