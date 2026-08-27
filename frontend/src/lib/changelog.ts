export const APP_VERSION = '1.0.4'

export interface ReleaseNotes {
  version: string
  title: string
  items: string[]
}

export const CHANGELOG: ReleaseNotes[] = [
  {
    version: '1.0.4',
    title: 'Market research',
    items: [
      'Market research sits between Tenders and Engagement and lists MRS notices with the same explorer as Tenders.',
      'Dashboard digest can switch Tenders | MRS on last scrape / today / this week.',
      'Settings → Categories keeps two CPV lists: Tenders and Market research, each starting with computers, networks, and telecom.',
      'The scheduled daily scrape runs tenders first, then MRS, using each list’s own CPVs.',
      'Engagement includes MRS with a Kind column; Move to engagement works from an MRS detail page.',
      'Open on portal from an MRS notice opens that market-research record on the SPA site, not the homepage.',
    ],
  },
  {
    version: '1.0.3',
    title: 'Market research (MRS)',
    items: [
      'Market research is a separate explorer between Tenders and Engagement, using the portal’s MRS search rather than a tender-type filter.',
      'The dashboard digest can switch Tenders | MRS on top of last scrape / today / this week.',
      'Settings → Categories keeps independent CPV lists for tenders and MRS (same three defaults to start).',
      'The daily scrape walks enabled tender CPVs, then enabled MRS CPVs, in one job.',
      'Move MRS listings to engagement; the pipeline shows a Tender / MRS kind column.',
    ],
  },
  {
    version: '1.0.2',
    title: 'Digest views and category ownership',
    items: [
      'Dashboard digest can switch between New since last scrape, Today\'s scrape results, and This week\'s scrape results.',
      'A tender found while scraping a tracked CPV stays in that category instead of jumping to a more specific listing code.',
      'Scraping another tracked category will not steal a tender already stored under a different tracked CPV.',
      'Tenders left on an untracked CPV can be claimed back into the category you searched.',
      'Click the version and WeLink line in the top-right to open these update notes.',
    ],
  },
  {
    version: '1.0.1',
    title: 'Engagement notes and session controls',
    items: [
      'Log out from the sidebar so the password screen is required again.',
      'Engagement Info notes replace Delete: add text, save it, and the button turns yellow when notes exist.',
      'Engage Yes uses a stronger green so assigned rows are easier to spot.',
      'Clicking an already-selected Tenders date preset (Last 30d, 90d, year, Closing 7d) turns that preset off.',
      'Login particle wave runs slower so the motion is smoother.',
    ],
  },
  {
    version: '1.0.0',
    title: 'Tender Hub',
    items: [
      'Password-protected workspace for Georgia State Procurement Agency IT tenders.',
      'Scrape tracked CPV categories from the public portal (computers, networks, and telecom by default).',
      'Schedule one or more daily scrape times; Windows Task Scheduler locally, in-app scheduler on a server.',
      'Dashboard with open, closing-soon, new-this-week, untracked, and engagement KPIs plus volume, status, and buyer charts.',
      'Tenders explorer with search, device/topic chips, category, CPV, status, type, buyer, dates, value, bidders, spec text, and column picker.',
      'Tender detail with documents, bids, status history, attachments, portal link, and Move to engagement.',
      'Engagement list to assign product, account manager, solution manager, and Yes/No engage, with filters and pagination.',
      'Settings for schedule, tracked categories (backfill and rescrape), scraper health, and manager name lists.',
      'API and built UI served as one app, with Linux deploy scripts for a cloud VM.',
      'WeLink support contact in the top bar: s84404579.',
    ],
  },
]
