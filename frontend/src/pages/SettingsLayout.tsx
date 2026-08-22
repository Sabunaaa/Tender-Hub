import { NavLink, Outlet } from 'react-router-dom'
import { SETTINGS_TABS } from '../lib/settingsNav'

export function SettingsLayout() {
  return (
    <div>
      <nav className="settings-tabs" aria-label="Settings sections">
        {SETTINGS_TABS.map((tab) => (
          <NavLink
            key={tab.to}
            to={tab.to}
            end={'end' in tab && tab.end}
            className={({ isActive }) => `settings-tab${isActive ? ' active' : ''}`}
          >
            <tab.icon size={15} />
            {tab.label}
          </NavLink>
        ))}
      </nav>
      <Outlet />
    </div>
  )
}
