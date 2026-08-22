import { NavLink, Outlet, useLocation } from 'react-router-dom'
import {
  Activity,
  ChevronLeft,
  ChevronRight,
  FolderTree,
  Handshake,
  LayoutDashboard,
  Menu,
  Search,
  Settings,
  X,
} from 'lucide-react'
import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { isMockMode } from '../api'
import { runsQueryOptions } from '../api/runsQuery'
import { cn } from '../lib/format'

const nav = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true, eyebrow: 'Overview', title: 'Tender intelligence' },
  { to: '/tenders', label: 'Tenders', icon: Search, eyebrow: 'Explorer', title: 'Procurement tenders' },
  { to: '/categories', label: 'Categories', icon: FolderTree, eyebrow: 'Tracking', title: 'CPV categories' },
  { to: '/runs', label: 'Scrape Health', icon: Activity, eyebrow: 'Operations', title: 'Scrape health' },
  { to: '/engagement', label: 'Engagement', icon: Handshake, eyebrow: 'Pipeline', title: 'Engagement' },
]

const settingsNav = {
  to: '/settings',
  label: 'Settings',
  icon: Settings,
  eyebrow: 'Workspace',
  title: 'Settings',
}

function ScrapeStatusBadge() {
  const { data } = useQuery(runsQueryOptions)

  const active = data?.activeRun ?? null
  const latest = data?.runs[0]
  const isScraping = Boolean(active)
  const lastFailed = !isScraping && latest?.status === 'failed'
  const lastPartial = !isScraping && latest?.status === 'partial'
  const lastCancelled = !isScraping && latest?.status === 'cancelled'

  const percent = Math.min(100, Math.max(0, active?.progressPercent ?? 0))
  const processed = active?.tendersProcessed ?? 0
  const total = active?.progressTotal ?? 0

  let title = isMockMode ? 'Demo fixtures' : 'Local workspace'
  let subtitle = isMockMode ? 'Mock data mode' : 'SQLite · Idle'
  let tone: 'idle' | 'running' | 'failed' | 'partial' = 'idle'

  if (isScraping) {
    title = 'Scraping now'
    subtitle = active?.currentCategory
      ? `CPV ${active.currentCategory}`
      : `${active?.mode ?? 'daily'} run`
    tone = 'running'
  } else if (lastFailed) {
    title = 'Last scrape failed'
    subtitle = isMockMode ? 'Mock data mode' : 'SQLite · Check Scrape Health'
    tone = 'failed'
  } else if (lastPartial) {
    title = 'Last scrape partial'
    subtitle = isMockMode ? 'Mock data mode' : 'SQLite · Some errors'
    tone = 'partial'
  } else if (lastCancelled) {
    title = 'Scrape stopped'
    subtitle = isMockMode ? 'Mock data mode' : 'SQLite · Cancelled'
    tone = 'partial'
  }

  return (
    <div className={cn('local-badge', `tone-${tone}`)}>
      <span className={cn('pulse-dot', tone === 'running' && 'is-pulsing')} />
      <div className="local-badge-body">
        <strong>{title}</strong>
        <small>{subtitle}</small>
        {isScraping && (
          <>
            <div className="scrape-progress-meta">
              {total > 0 ? `${processed} / ${total}` : `${processed} tenders`}
              <span>{percent}%</span>
            </div>
            <div
              className="scrape-progress"
              role="progressbar"
              aria-valuenow={percent}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label="Scrape progress"
            >
              <div className="scrape-progress-fill" style={{ width: `${percent}%` }} />
            </div>
          </>
        )}
      </div>
    </div>
  )
}

export function AppLayout() {
  const location = useLocation()
  const [collapsed, setCollapsed] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)

  const current = useMemo(() => {
    const match = [...nav, settingsNav].find((item) =>
      'end' in item && item.end ? location.pathname === '/' : location.pathname.startsWith(item.to),
    )
    return (
      match ?? {
        to: '/',
        label: 'Dashboard',
        icon: LayoutDashboard,
        end: true,
        eyebrow: 'Overview',
        title: 'Tender intelligence',
      }
    )
  }, [location.pathname])

  return (
    <div
      className={cn(
        'app-shell',
        collapsed && 'sidebar-collapsed',
        mobileOpen && 'mobile-open',
      )}
    >
      <div className="sidebar-overlay" onClick={() => setMobileOpen(false)} />

      <aside className="sidebar">
        <div className="sidebar-brand">
          <div className="huawei-glyph">
            <img src="/huawei-logo.png" alt="Huawei" width={40} height={40} />
          </div>
          {!collapsed && (
            <div>
              <strong>HUAWEI</strong>
              <small>TENDER HUB</small>
            </div>
          )}
          <button
            className="collapse-button"
            onClick={() => setCollapsed((v) => !v)}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            type="button"
          >
            {collapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
          </button>
          <button
            className="icon-button"
            style={{ display: 'none' }}
            onClick={() => setMobileOpen(false)}
            aria-label="Close menu"
            type="button"
          >
            <X size={16} />
          </button>
        </div>

        <nav className="nav-list" aria-label="Primary navigation">
          {nav.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              title={item.label}
              onClick={() => setMobileOpen(false)}
              className={({ isActive }) => cn('nav-item', isActive && 'active')}
            >
              <item.icon size={19} />
              <span>{item.label}</span>
            </NavLink>
          ))}
        </nav>

        <div className="sidebar-bottom">
          <NavLink
            to={settingsNav.to}
            title={settingsNav.label}
            onClick={() => setMobileOpen(false)}
            className={({ isActive }) => cn('nav-item', isActive && 'active')}
          >
            <settingsNav.icon size={19} />
            <span>{settingsNav.label}</span>
          </NavLink>
          {!collapsed && <ScrapeStatusBadge />}
        </div>
      </aside>

      <header className="topbar">
        <button
          className="mobile-menu-btn"
          onClick={() => setMobileOpen(true)}
          aria-label="Open menu"
          type="button"
        >
          <Menu size={18} />
        </button>
        <div>
          <p>{current.eyebrow}</p>
          <h1>{current.title}</h1>
        </div>
      </header>

      <main className="main-content">
        <Outlet />
      </main>
    </div>
  )
}
