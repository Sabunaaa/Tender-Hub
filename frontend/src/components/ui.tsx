import type { ReactNode } from 'react'
import { cn, statusColor } from '../lib/format'

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string
  subtitle?: string
  actions?: ReactNode
}) {
  return (
    <div className="section-toolbar">
      <div>
        <h2>{title}</h2>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {actions && <div className="toolbar-actions">{actions}</div>}
    </div>
  )
}

export function Card({
  children,
  className,
  title,
  eyebrow,
  action,
}: {
  children: ReactNode
  className?: string
  title?: string
  eyebrow?: string
  action?: ReactNode
}) {
  return (
    <section className={cn('panel', className)}>
      {(title || action || eyebrow) && (
        <div className="panel-heading">
          <div>
            {eyebrow && <p className="eyebrow">{eyebrow}</p>}
            {title && <h3>{title}</h3>}
          </div>
          {action}
        </div>
      )}
      {children}
    </section>
  )
}

export function KpiCard({
  label,
  value,
  hint,
  icon,
  tone = 'red',
}: {
  label: string
  value: string
  hint?: string
  icon?: ReactNode
  tone?: 'red' | 'blue' | 'violet' | 'amber' | 'green'
}) {
  return (
    <article className="stat-card">
      {icon && <div className={`stat-icon ${tone}`}>{icon}</div>}
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
        {hint && <small>{hint}</small>}
      </div>
    </article>
  )
}

export function StatusBadge({ status }: { status: string }) {
  return <span className={`status-pill ${statusColor(status)}`}>{status}</span>
}

export function LoadingState({ label = 'Loading…' }: { label?: string }) {
  return <div className="empty-state">{label}</div>
}

export function ErrorState({ message }: { message: string }) {
  return <div className="alert-box error">{message}</div>
}

export function EmptyState({ message }: { message: string }) {
  return <div className="empty-state">{message}</div>
}

export function FilterSection({
  title,
  open,
  onToggle,
  children,
}: {
  title: string
  open: boolean
  onToggle: () => void
  children: ReactNode
}) {
  return (
    <div className={`filter-section${open ? ' open' : ''}`}>
      <button
        type="button"
        className="filter-section-toggle"
        aria-expanded={open}
        onClick={onToggle}
      >
        <span className="filter-label">{title}</span>
        <span className="filter-caret" aria-hidden="true">
          {open ? '▴' : '▾'}
        </span>
      </button>
      <div className="filter-section-body" hidden={!open}>
        {children}
      </div>
    </div>
  )
}
