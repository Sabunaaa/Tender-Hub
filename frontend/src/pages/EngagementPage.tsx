import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { Plus, Trash2 } from 'lucide-react'
import { api } from '../api'
import type { Engagement } from '../api'
import { Card, ErrorState, LoadingState, PageHeader, StatusBadge } from '../components/ui'
import { errorMessage } from '../lib/errors'
import { formatDate, formatGel, shortCategory } from '../lib/format'
import { HUAWEI_ENTERPRISE_DOMAINS } from '../lib/huaweiDomains'

function ManagerSelect({
  value,
  names,
  onChange,
}: {
  value: string
  names: string[]
  onChange: (value: string) => void
}) {
  const options = names.includes(value) || !value ? names : [value, ...names]
  return (
    <select className="field-input" value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">—</option>
      {options.map((name) => (
        <option key={name} value={name}>
          {name}
        </option>
      ))}
    </select>
  )
}

export function EngagementPage() {
  const qc = useQueryClient()
  const [code, setCode] = useState('')
  const settingsQuery = useQuery({ queryKey: ['settings'], queryFn: () => api.getSettings() })
  const listQuery = useQuery({ queryKey: ['engagements'], queryFn: () => api.listEngagements() })

  const addMutation = useMutation({
    mutationFn: (announcementNumber: string) => api.addEngagement(announcementNumber),
    onSuccess: () => {
      setCode('')
      qc.invalidateQueries({ queryKey: ['engagements'] })
    },
  })

  const patchMutation = useMutation({
    mutationFn: ({
      id,
      patch,
    }: {
      id: number
      patch: { engaged?: boolean; accountManager?: string; solutionManager?: string; domain?: string }
    }) => api.updateEngagement(id, patch),
    onSuccess: (row) => {
      qc.setQueryData(['engagements'], (old: Engagement[] | undefined) =>
        old ? old.map((item) => (item.id === row.id ? row : item)) : [row],
      )
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.deleteEngagement(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['engagements'] }),
  })

  const accountManagers = settingsQuery.data?.accountManagers ?? []
  const solutionManagers = settingsQuery.data?.solutionManagers ?? []

  return (
    <div>
      <PageHeader
        title="Engagement"
        subtitle="Track which tenders Huawei will pursue, and who owns them"
      />

      <Card>
        <form
          className="engagement-add"
          onSubmit={(e) => {
            e.preventDefault()
            if (!code.trim() || addMutation.isPending) return
            addMutation.mutate(code.trim())
          }}
        >
          <input
            className="field-input"
            placeholder="Announcement number, e.g. CON260000470"
            value={code}
            onChange={(e) => setCode(e.target.value)}
          />
          <button type="submit" className="primary-button" disabled={!code.trim() || addMutation.isPending}>
            <Plus size={16} />
            {addMutation.isPending ? 'Adding…' : 'Add announcement'}
          </button>
        </form>
        {addMutation.isError && (
          <p className="settings-warning" style={{ marginTop: 10 }}>
            {errorMessage(addMutation.error, 'Could not add tender')}
          </p>
        )}
        <p className="muted" style={{ margin: '10px 0 0', fontSize: 12 }}>
          Details are filled from the scraped list using the announcement number (Number column on Tenders). Pick a Huawei Enterprise domain, then Account and Solution Manager names from Settings.
        </p>
      </Card>

      <div style={{ height: 16 }} />

      {listQuery.isLoading && <LoadingState label="Loading engagements…" />}
      {listQuery.error && <ErrorState message={errorMessage(listQuery.error, 'Failed to load engagements')} />}
      {listQuery.data && (
        <Card>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Number</th>
                  <th>Buyer</th>
                  <th>Category</th>
                  <th>Announced</th>
                  <th>Status</th>
                  <th>Value</th>
                  <th>Deadline</th>
                  <th>Domain</th>
                  <th>Account manager</th>
                  <th>Solution manager</th>
                  <th className="engage-col">Engage?</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {listQuery.data.map((row) => (
                  <tr key={row.id}>
                    <td>
                      {row.appId ? (
                        <Link to={`/tenders/${row.appId}`}>{row.announcementNumber}</Link>
                      ) : (
                        row.announcementNumber
                      )}
                      <div className="georgian cell-truncate muted" title={row.title}>
                        {row.title || '—'}
                      </div>
                    </td>
                    <td title={row.buyer}>
                      <div className="cell-truncate">{row.buyer || '—'}</div>
                    </td>
                    <td>{row.categoryName ? shortCategory(row.categoryName) : '—'}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>{formatDate(row.announcementDate)}</td>
                    <td>{row.status ? <StatusBadge status={row.status} /> : '—'}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>{formatGel(row.estimatedValue)}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>{formatDate(row.bidDeadline)}</td>
                    <td>
                      <ManagerSelect
                        value={row.domain}
                        names={[...HUAWEI_ENTERPRISE_DOMAINS]}
                        onChange={(domain) => patchMutation.mutate({ id: row.id, patch: { domain } })}
                      />
                    </td>
                    <td>
                      <ManagerSelect
                        value={row.accountManager}
                        names={accountManagers}
                        onChange={(accountManager) =>
                          patchMutation.mutate({ id: row.id, patch: { accountManager } })
                        }
                      />
                    </td>
                    <td>
                      <ManagerSelect
                        value={row.solutionManager}
                        names={solutionManagers}
                        onChange={(solutionManager) =>
                          patchMutation.mutate({ id: row.id, patch: { solutionManager } })
                        }
                      />
                    </td>
                    <td className="engage-col">
                      <div className="engage-toggle" role="group" aria-label="Engage">
                        <button
                          type="button"
                          className={`engage-btn${row.engaged ? ' active yes' : ''}`}
                          aria-pressed={row.engaged}
                          onClick={() => patchMutation.mutate({ id: row.id, patch: { engaged: true } })}
                        >
                          Y
                        </button>
                        <button
                          type="button"
                          className={`engage-btn${!row.engaged ? ' active no' : ''}`}
                          aria-pressed={!row.engaged}
                          onClick={() => patchMutation.mutate({ id: row.id, patch: { engaged: false } })}
                        >
                          N
                        </button>
                      </div>
                    </td>
                    <td>
                      <button
                        type="button"
                        className="icon-button"
                        aria-label="Remove"
                        disabled={deleteMutation.isPending}
                        onClick={() => deleteMutation.mutate(row.id)}
                      >
                        <Trash2 size={15} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {listQuery.data.length === 0 && (
              <div className="empty-state" style={{ minHeight: 120, border: 0 }}>
                Add an announcement number to start tracking engagement.
              </div>
            )}
          </div>
        </Card>
      )}
    </div>
  )
}
