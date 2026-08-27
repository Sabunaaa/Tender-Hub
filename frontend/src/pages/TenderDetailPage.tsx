import { useEffect, useRef } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import { ExternalLink, Handshake } from 'lucide-react'
import { api } from '../api'
import { SpecPanel } from '../components/SpecPanel'
import { Card, ErrorState, LoadingState, StatusBadge } from '../components/ui'
import { errorMessage } from '../lib/errors'
import { formatDate, formatDateTime, formatGel } from '../lib/format'

export function TenderDetailPage() {
  const { id } = useParams()
  const appId = Number(id)
  const navigate = useNavigate()
  const { hash, pathname } = useLocation()
  const kind = pathname.startsWith('/market-research') ? 'mrs' : 'tender'
  const listPath = kind === 'mrs' ? '/market-research' : '/tenders'
  const qc = useQueryClient()
  const { data, isLoading, error } = useQuery({
    queryKey: ['tender', kind, appId],
    queryFn: () => api.getTender(appId, kind),
    enabled: Number.isFinite(appId),
  })
  const addEngagement = useMutation({
    mutationFn: (announcementNumber: string) => api.addEngagement(announcementNumber),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['engagements'] })
      navigate('/engagement')
    },
    onError: (err) => {
      if (errorMessage(err, '').toLowerCase().includes('already')) {
        navigate('/engagement')
      }
    },
  })

  const specRef = useRef<HTMLDivElement | null>(null)
  const specText = data?.specText?.trim() ?? ''

  // The spec block renders only after the query resolves, so the browser cannot
  // honour the #spec fragment on its own.
  useEffect(() => {
    if (hash !== '#spec' || !specText) return
    specRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [hash, specText])

  if (isLoading) return <LoadingState label={kind === 'mrs' ? 'Loading market research…' : 'Loading tender…'} />
  if (error || !data) return <ErrorState message={errorMessage(error, kind === 'mrs' ? 'Market research not found' : 'Tender not found')} />

  return (
    <div>
      <div className="section-toolbar tender-detail-header">
        <div>
          <h2>{data.announcementNumber}</h2>
          <p>{data.buyer}</p>
          <div className="toolbar-actions tender-detail-pills">
            <StatusBadge status={data.status} />
            <span className="status-pill neutral">{data.categoryName}</span>
            <span className="status-pill neutral">{data.procurementType}</span>
          </div>
        </div>
        <div className="tender-detail-actions">
          <div className="toolbar-actions">
            <Link to={listPath} className="secondary-button">
              Back
            </Link>
            <a href={data.sourceUrl} target="_blank" rel="noreferrer" className="primary-button">
              Open on portal <ExternalLink size={16} />
            </a>
          </div>
          <button
            type="button"
            className="secondary-button"
            disabled={addEngagement.isPending}
            onClick={() => addEngagement.mutate(data.announcementNumber)}
          >
            <Handshake size={16} />
            {addEngagement.isPending ? 'Moving…' : 'Move to engagement'}
          </button>
          {addEngagement.isError &&
            !errorMessage(addEngagement.error, '').toLowerCase().includes('already') && (
              <p className="settings-warning" style={{ margin: 0 }}>
                {errorMessage(addEngagement.error, 'Could not add to engagement')}
              </p>
            )}
        </div>
      </div>

      <div className="detail-grid-2 main">
        <Card title="Core fields">
          <dl className="fact-grid">
            {(
              [
                ['Announcement number', data.announcementNumber],
                ['Buyer', data.buyer],
                ['Announced', formatDate(data.announcementDate)],
                ['Bids accepted from', formatDate(data.bidsAcceptedFrom)],
                ['Bid deadline', formatDate(data.bidDeadline)],
                ['Estimated value', formatGel(data.estimatedValue)],
                ['Amount / volume', data.amountOrVolume?.trim() ? data.amountOrVolume : '—'],
                ['VAT terms', data.vatTerms ?? '—'],
                ['Guarantee', data.guaranteeAmount != null ? formatGel(data.guaranteeAmount) : '—'],
                ['Guarantee validity', data.guaranteeValidity ?? '—'],
                ['Bid reduction step', data.bidReductionStep != null ? formatGel(data.bidReductionStep) : '—'],
                ['Winner', data.winner ?? '—'],
                ['Procurement type', data.procurementType || '—'],
                ['Donor', data.donor?.trim() ? data.donor : 'N/A'],
                ['Bidders', String(data.bidderCount ?? 0)],
              ] as const
            ).map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
            <div className="full">
              <dt>Supply period</dt>
              <dd className="georgian">{data.supplyPeriod ?? '—'}</dd>
            </div>
            <div className="full">
              <dt>Title / object</dt>
              <dd className="georgian" title={data.title}>
                {data.title}
              </dd>
            </div>
          </dl>
        </Card>

        <div className="detail-side">
          <Card title="CPV codes">
            {data.cpvCodes.length === 0 ? (
              <div className="muted">No CPV codes.</div>
            ) : (
              <ul className="cpv-list">
                {data.cpvCodes.map((c) => (
                  <li key={c.code} className="cpv-chip">
                    <strong>{c.code}</strong>
                    <span>{c.name}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title="Attachments">
            {data.attachments.length === 0 ? (
              <div className="muted">No attachments.</div>
            ) : (
              <ul className="file-list">
                {data.attachments.map((a) => (
                  <li key={a.id}>
                    <a className="link-red" href={a.url} target="_blank" rel="noreferrer">
                      {a.name}
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title="Result documents">
            {data.resultDocuments.length === 0 ? (
              <div className="muted">No result documents yet.</div>
            ) : (
              <ul className="file-list">
                {data.resultDocuments.map((a) => (
                  <li key={a.id}>
                    <a className="link-red" href={a.url} target="_blank" rel="noreferrer">
                      {a.name}
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>

      <div className="detail-grid-2 equal">
        <Card title="Documentation">
          {data.documentSections.length === 0 && (
            <div className="muted">No document sections.</div>
          )}
          {data.documentSections.map((section) => (
            <div key={section.id} className="doc-block">
              <div className="meta-label" style={{ marginBottom: 6 }}>
                {section.title}
                {section.language === 'ka' && (
                  <span className="status-pill warning" style={{ marginLeft: 8 }}>
                    KA
                  </span>
                )}
              </div>
              <div className={section.language === 'ka' ? 'georgian' : ''} style={{ fontSize: 13 }}>
                {section.body}
              </div>
              {section.attachments.length > 0 && (
                <ul className="file-list" style={{ marginTop: 8 }}>
                  {section.attachments.map((a) => (
                    <li key={a.id}>
                      <a className="link-red" href={a.url} target="_blank" rel="noreferrer">
                        {a.name}
                      </a>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </Card>

        <Card
          title="Technical specification"
          eyebrow="Extracted from ტექნიკური file"
          className="spec-panel"
        >
          <div id="spec" ref={specRef}>
            {specText ? (
              <SpecPanel text={specText} />
            ) : (
              <div className="muted">
                No extracted text yet. The attached file is listed under Attachments.
              </div>
            )}
          </div>
        </Card>
      </div>

      <div className="detail-grid-2 equal">
        <Card title="Bids">
          {data.bids.length === 0 ? (
            <div className="muted">No bids recorded yet.</div>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Bidder</th>
                    <th>First offer</th>
                    <th>Last offer</th>
                    <th>Offers</th>
                  </tr>
                </thead>
                <tbody>
                  {data.bids.map((b, i) => (
                    <tr key={i}>
                      <td className="georgian">{b.bidderName}</td>
                      <td>
                        {formatGel(b.firstOfferAmount)}
                        <div className="muted" style={{ fontSize: 11 }}>
                          {formatDateTime(b.firstOfferAt)}
                        </div>
                      </td>
                      <td>
                        {formatGel(b.lastOfferAmount)}
                        <div className="muted" style={{ fontSize: 11 }}>
                          {formatDateTime(b.lastOfferAt)}
                        </div>
                      </td>
                      <td>{b.offerCount}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card title="Status chronology">
          <ol className="timeline">
            {data.statusHistory.map((entry, i) => (
              <li key={i}>
                <div style={{ fontWeight: 700, fontSize: 13 }}>{entry.status}</div>
                <div className="muted" style={{ fontSize: 11 }}>
                  {formatDateTime(entry.changedAt)}
                </div>
              </li>
            ))}
          </ol>
        </Card>
      </div>
    </div>
  )
}
