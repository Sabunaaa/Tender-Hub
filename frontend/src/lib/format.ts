import { clsx, type ClassValue } from 'clsx'

export function cn(...inputs: ClassValue[]) {
  return clsx(inputs)
}

export function formatGel(value: number | null | undefined, currency = 'GEL'): string {
  if (value == null || Number.isNaN(value)) return '—'
  return new Intl.NumberFormat('en-GE', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(value)
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return '—'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return value
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(d)
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return value
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Tbilisi',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(d)
}

export function statusColor(status: string): string {
  const map: Record<string, string> = {
    'Tender announced': 'info',
    'Bidding commenced': 'info',
    'Bidding ended': 'violet',
    'Bidding completed': 'violet',
    'Selection/Evaluation': 'warning',
    'Winner identified': 'warning',
    'Contract awarded': 'success',
    'Contract not awarded': 'danger',
    'No bids received': 'danger',
    Terminated: 'neutral',
    'Did not take place': 'neutral',
  }
  return map[status] ?? 'neutral'
}

export function categoryColor(code: string): string {
  const map: Record<string, string> = {
    '30200000': '#c7000b',
    '32400000': '#2768c9',
    '32500000': '#7a52c7',
  }
  return map[code] ?? '#667085'
}

export function shortCategory(name: string): string {
  if (name.includes('Computer')) return 'Computers'
  if (name.includes('Network')) return 'Networks'
  if (name.includes('Telecom')) return 'Telecom'
  return name.length > 24 ? `${name.slice(0, 22)}…` : name
}
