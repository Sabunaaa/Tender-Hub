import type { CSSProperties } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { formatDistanceToNow } from 'date-fns'
import {
  Banknote,
  CalendarClock,
  FileSearch,
  FolderOpen,
  ShieldCheck,
  Sparkles,
  TrendingUp,
} from 'lucide-react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { api } from '../api'
import { Card, ErrorState, KpiCard, LoadingState, StatusBadge } from '../components/ui'
import { errorMessage } from '../lib/errors'
import { categoryColor, formatDate, formatGel, shortCategory } from '../lib/format'

const STATUS_COLORS = ['#c7000b', '#2768c9', '#7a52c7', '#b76e00', '#0f8a5f', '#667085', '#ef3340', '#2b69bf', '#c92a2a']

export function DashboardPage() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['stats'],
    queryFn: () => api.getStats(),
  })

  if (isLoading) return <LoadingState label="Loading dashboard…" />
  if (error || !data) return <ErrorState message={errorMessage(error, 'Failed to load stats')} />

  const closingSoonDays = data.closingSoonDays ?? 7

  const months = [...new Set(data.byMonth.map((m) => m.month))].sort()
  const categories = [...new Map(data.byCategory.map((c) => [c.categoryCode, c.categoryName])).entries()]
  const stacked = months.map((month) => {
    const row: Record<string, string | number> = { month }
    for (const [code, name] of categories) {
      const hit = data.byMonth.find((m) => m.month === month && m.categoryCode === code)
      row[shortCategory(name)] = hit?.count ?? 0
    }
    return row
  })

  const openPct = data.totalTenders
    ? Math.round((data.openTenders / data.totalTenders) * 100)
    : 0

  const newSince = data.newSince
  const scrapedAgo = (() => {
    if (!newSince?.since) return null
    const d = new Date(newSince.since)
    if (Number.isNaN(d.getTime())) return null
    return formatDistanceToNow(d, { addSuffix: true })
  })()

  return (
    <div>
      <section className="hero-panel">
        <div className="hero-copy">
          <span className="hero-kicker">
            <ShieldCheck size={14} /> Georgia public procurement
          </span>
          <h2>Track the IT tenders that matter.</h2>
          <p>
            Daily scrape of computers, networks, and telecom equipment from the State Procurement
            Agency portal — filter, compare values, and never miss a closing deadline.
          </p>
          <div className="hero-actions">
            <Link className="primary-button" to="/tenders">
              <FileSearch size={17} /> Explore tenders
            </Link>
            <Link className="secondary-button" to="/settings/categories">
              Manage categories
            </Link>
          </div>
        </div>
        <div className="hero-score">
          <div className="score-orbit" style={{ ['--score-pct']: `${openPct}%` } as CSSProperties}>
            <div>
              <strong>{openPct}%</strong>
              <span>Currently open</span>
            </div>
          </div>
          <p>
            {data.openTenders} open · {data.closingWithin7Days} closing in {closingSoonDays} days
          </p>
        </div>
      </section>

      <section className="stat-grid">
        <KpiCard
          label="Total tenders"
          value={String(data.totalTenders)}
          hint="In tracked categories"
          tone="red"
          icon={<FolderOpen size={19} />}
        />
        <KpiCard
          label="Currently open"
          value={String(data.openTenders)}
          hint="Announced → evaluation"
          tone="blue"
          icon={<FileSearch size={19} />}
        />
        <KpiCard
          label={`Closing in ${closingSoonDays} days`}
          value={String(data.closingWithin7Days)}
          hint={`Next ${closingSoonDays} days`}
          tone="amber"
          icon={<CalendarClock size={19} />}
        />
        <KpiCard
          label="Total value"
          value={formatGel(data.totalEstimatedValue)}
          hint="Estimated procurement value"
          tone="violet"
          icon={<Banknote size={19} />}
        />
        <KpiCard
          label="Average value"
          value={formatGel(data.averageEstimatedValue)}
          hint="Per tender"
          tone="green"
          icon={<TrendingUp size={19} />}
        />
      </section>

      {newSince && (
        <div style={{ marginBottom: 18 }}>
          <Card
            eyebrow="Daily digest"
            title="New since last scrape"
            action={
              <div className="toolbar-actions">
                {newSince.count > 0 && (
                  <span className="status-pill success">
                    <Sparkles size={11} /> {newSince.count} new
                  </span>
                )}
                <Link className="text-button" to="/settings/scraper">
                  {scrapedAgo ? `Scraped ${scrapedAgo}` : 'Scrape history'}
                </Link>
              </div>
            }
          >
            {newSince.count === 0 ? (
              <div className="empty-state" style={{ minHeight: 100 }}>
                {scrapedAgo
                  ? `No new tenders in the run that finished ${scrapedAgo}.`
                  : 'No new tenders yet — run a scrape to populate this.'}
              </div>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Number</th>
                      <th>Buyer</th>
                      <th>Category</th>
                      <th>Announced</th>
                      <th>Deadline</th>
                      <th>Value</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {newSince.items.map((t) => (
                      <tr key={t.appId}>
                        <td>
                          <Link to={`/tenders/${t.appId}`}>{t.announcementNumber}</Link>
                          <div className="georgian cell-truncate muted" title={t.title}>
                            {t.title}
                          </div>
                        </td>
                        <td title={t.buyer}>
                          <div className="cell-truncate">{t.buyer}</div>
                        </td>
                        <td>{shortCategory(t.categoryName)}</td>
                        <td style={{ whiteSpace: 'nowrap' }}>{formatDate(t.announcementDate)}</td>
                        <td style={{ whiteSpace: 'nowrap' }}>{formatDate(t.bidDeadline)}</td>
                        <td style={{ whiteSpace: 'nowrap' }}>{formatGel(t.estimatedValue)}</td>
                        <td>
                          <StatusBadge status={t.status} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {newSince.count > newSince.items.length && (
                  <div className="muted" style={{ padding: '10px 15px' }}>
                    Showing {newSince.items.length} of {newSince.count} new tenders.
                  </div>
                )}
              </div>
            )}
          </Card>
        </div>
      )}

      <section className="dashboard-grid">
        <Card eyebrow="Volume" title="Tenders per month">
          <div style={{ height: 288 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={stacked}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e6e8ec" />
                <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#667085' }} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#667085' }} />
                <Tooltip />
                <Legend />
                {categories.map(([code, name]) => (
                  <Bar
                    key={code}
                    dataKey={shortCategory(name)}
                    stackId="a"
                    fill={categoryColor(code)}
                    radius={[2, 2, 0, 0]}
                  />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card eyebrow="Mix" title="By status">
          <div style={{ height: 288 }}>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={data.byStatus}
                  dataKey="count"
                  nameKey="status"
                  innerRadius={50}
                  outerRadius={90}
                  paddingAngle={2}
                >
                  {data.byStatus.map((_, i) => (
                    <Cell key={i} fill={STATUS_COLORS[i % STATUS_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip />
                <Legend wrapperStyle={{ fontSize: 11 }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </section>

      <section className="dashboard-grid">
        <Card eyebrow="Value" title="Value by category">
          <div style={{ height: 240 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={data.byCategory.map((c) => ({
                  name: shortCategory(c.categoryName),
                  value: c.value,
                  count: c.count,
                }))}
                layout="vertical"
                margin={{ left: 20 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#e6e8ec" />
                <XAxis
                  type="number"
                  tickFormatter={(v) => `${Math.round(Number(v) / 1000)}k`}
                  tick={{ fontSize: 11, fill: '#667085' }}
                />
                <YAxis type="category" dataKey="name" width={90} tick={{ fontSize: 11, fill: '#667085' }} />
                <Tooltip formatter={(v) => formatGel(Number(v))} />
                <Bar dataKey="value" radius={[0, 6, 6, 0]}>
                  {data.byCategory.map((c) => (
                    <Cell key={c.categoryCode} fill={categoryColor(c.categoryCode)} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card
          eyebrow="Buyers"
          title="Top buyers"
          action={
            <Link className="text-button" to="/tenders">
              View all
            </Link>
          }
        >
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Buyer</th>
                  <th>Tenders</th>
                  <th>Value</th>
                </tr>
              </thead>
              <tbody>
                {data.topBuyers.map((b) => (
                  <tr key={b.buyer}>
                    <td>{b.buyer}</td>
                    <td>{b.count}</td>
                    <td>{formatGel(b.value)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </section>

      <Card
        eyebrow="Deadlines"
        title="Closing soon"
        action={
          <Link className="text-button" to="/tenders?preset=7d">
            Open explorer
          </Link>
        }
      >
        {data.closingSoon.length === 0 ? (
          <div className="empty-state" style={{ minHeight: 100 }}>
            No tenders closing in the next {closingSoonDays} days.
          </div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Number</th>
                  <th>Buyer</th>
                  <th>Category</th>
                  <th>Deadline</th>
                  <th>Value</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {data.closingSoon.map((t) => (
                  <tr key={t.appId}>
                    <td>
                      <Link to={`/tenders/${t.appId}`}>{t.announcementNumber}</Link>
                    </td>
                    <td>{t.buyer}</td>
                    <td>{shortCategory(t.categoryName)}</td>
                    <td>{formatDate(t.bidDeadline)}</td>
                    <td>{formatGel(t.estimatedValue)}</td>
                    <td>
                      <StatusBadge status={t.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  )
}
