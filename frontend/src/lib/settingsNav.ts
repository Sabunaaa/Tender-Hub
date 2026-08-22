import { Activity, FolderTree, Handshake, SlidersHorizontal } from 'lucide-react'

export const SETTINGS_TABS = [
  { to: '/settings', label: 'General', icon: SlidersHorizontal, end: true, eyebrow: 'Workspace', title: 'Settings' },
  { to: '/settings/categories', label: 'Categories', icon: FolderTree, eyebrow: 'Settings', title: 'CPV categories' },
  { to: '/settings/scraper', label: 'Scraper', icon: Activity, eyebrow: 'Settings', title: 'Scraper' },
  { to: '/settings/engagement', label: 'Engagement', icon: Handshake, eyebrow: 'Settings', title: 'Engagement settings' },
] as const
