import { NavLink, Outlet, useLocation } from 'react-router-dom'
import {
  ChevronLeft,
  ChevronRight,
  Handshake,
  LayoutDashboard,
  LogOut,
  Menu,
  Search,
  Settings,
  X,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { isMockMode } from '../api'
import { lockSession } from './AccessGate'
import { ChangelogModal } from './ChangelogModal'
import { APP_VERSION } from '../lib/changelog'
import { runsQueryOptions } from '../api/runsQuery'
import { cn } from '../lib/format'
import { SETTINGS_TABS } from '../lib/settingsNav'

const nav = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true, eyebrow: 'Overview', title: 'Tender intelligence' },
  { to: '/tenders', label: 'Tenders', icon: Search, eyebrow: 'Explorer', title: 'Procurement tenders' },
  { to: '/engagement', label: 'Engagement', icon: Handshake, eyebrow: 'Pipeline', title: 'Engagement' },
]

function pathMatches(item: { to: string; end?: boolean }, pathname: string) {
  return item.end ? pathname === item.to : pathname.startsWith(item.to)
}

function ScrapeStatusBadge({ onNavigate }: { onNavigate?: () => void }) {
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
    subtitle = isMockMode ? 'Mock data mode' : 'SQLite · Check Scraper'
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
    <NavLink
      to="/settings/scraper"
      className={() => cn('local-badge', `tone-${tone}`)}
      onClick={onNavigate}
    >
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
    </NavLink>
  )
}

function SettingsNav({
  collapsed,
  onNavigate,
}: {
  collapsed: boolean
  onNavigate: () => void
}) {
  const location = useLocation()
  const inSettings = location.pathname.startsWith('/settings')
  const [open, setOpen] = useState(inSettings && !collapsed)

  useEffect(() => {
    if (collapsed) {
      setOpen(false)
      return
    }
    if (inSettings) setOpen(true)
  }, [collapsed, inSettings])

  return (
    <div className={cn('nav-group', open && 'is-open', inSettings && 'is-current')}>
      <button
        type="button"
        className={cn('nav-item', (open || inSettings) && 'active')}
        title="Settings"
        aria-expanded={open}
        aria-controls="settings-submenu"
        onClick={() => setOpen((v) => !v)}
      >
        <Settings size={19} />
        <span>Settings</span>
        <ChevronRight className="nav-caret" size={14} />
      </button>
      {open && (
        <div id="settings-submenu" className="nav-sub" role="group" aria-label="Settings sections">
          {SETTINGS_TABS.map((tab) => (
            <NavLink
              key={tab.to}
              to={tab.to}
              end={'end' in tab && tab.end}
              title={tab.label}
              onClick={() => {
                onNavigate()
                if (collapsed) setOpen(false)
              }}
              className={({ isActive }) => cn('nav-subitem', isActive && 'active')}
            >
              <tab.icon size={15} />
              <span>{tab.label}</span>
            </NavLink>
          ))}
        </div>
      )}
    </div>
  )
}

export function AppLayout() {
  const location = useLocation()
  const [collapsed, setCollapsed] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [changelogOpen, setChangelogOpen] = useState(false)

  const current = useMemo(() => {
    const settingsMatch = [...SETTINGS_TABS]
      .sort((a, b) => b.to.length - a.to.length)
      .find((item) => pathMatches(item, location.pathname))
    const match = settingsMatch ?? nav.find((item) => pathMatches(item, location.pathname))
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
          <SettingsNav collapsed={collapsed} onNavigate={() => setMobileOpen(false)} />
          <button
            type="button"
            className="nav-item logout-item"
            title="Log out"
            onClick={() => {
              void lockSession()
              setMobileOpen(false)
            }}
          >
            <LogOut size={19} />
            <span>Log out</span>
          </button>
          {!collapsed && <ScrapeStatusBadge onNavigate={() => setMobileOpen(false)} />}
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
        <button
          type="button"
          className="topbar-meta"
          onClick={() => setChangelogOpen(true)}
          title="Version notes"
        >
          <strong>v{APP_VERSION}</strong>
          <p>support: s84404579 - WeLink</p>
        </button>
      </header>

      <main className="main-content">
        <Outlet />
      </main>
      {changelogOpen && <ChangelogModal onClose={() => setChangelogOpen(false)} />}
    </div>
  )
}
