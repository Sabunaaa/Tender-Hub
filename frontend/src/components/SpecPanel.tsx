import { useMemo, useState } from 'react'
import { buildHighlighter, countMatches, filterGroups, parseSpec } from '../lib/specText'

function Highlighted({ text, pattern }: { text: string; pattern: RegExp | null }) {
  if (!pattern) return <>{text}</>
  const parts = text.split(pattern)
  return (
    <>
      {parts.map((part, i) =>
        // split() with one capture group puts matches at every odd index.
        i % 2 === 1 ? <mark key={i}>{part}</mark> : part,
      )}
    </>
  )
}

export function SpecPanel({ text }: { text: string }) {
  const [query, setQuery] = useState('')
  const groups = useMemo(() => parseSpec(text), [text])
  const visible = useMemo(() => filterGroups(groups, query), [groups, query])
  const hits = useMemo(() => countMatches(groups, query), [groups, query])
  const pattern = useMemo(() => buildHighlighter(query), [query])

  const multiFile = groups.length > 1 || Boolean(groups[0]?.sheet)

  return (
    <div className="spec-panel-body">
      <div className="spec-search">
        <input
          className="field-input"
          placeholder="Search the specification…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {query.trim() && (
          <span className="muted spec-search-count">
            {hits} {hits === 1 ? 'line' : 'lines'}
          </span>
        )}
      </div>

      <div className="spec-text georgian">
        {visible.length === 0 ? (
          <div className="muted">No line matches “{query.trim()}”.</div>
        ) : (
          visible.map((group, gi) => (
            <div key={gi} className="spec-file">
              {multiFile && (group.name || group.sheet) && (
                <div className="meta-label spec-file-name">
                  {group.name}
                  {group.sheet && <span className="muted"> · {group.sheet}</span>}
                </div>
              )}
              {group.blocks.map((block, bi) =>
                block.kind === 'table' ? (
                  <div key={bi} className="table-wrap spec-table-wrap">
                    <table className="spec-table">
                      <tbody>
                        {block.rows.map((row, ri) => (
                          <tr key={ri}>
                            {row.map((cell, ci) => (
                              <td key={ci}>
                                <Highlighted text={cell} pattern={pattern} />
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div key={bi} className="spec-lines">
                    {block.lines.map((line, li) => (
                      <p key={li}>
                        <Highlighted text={line} pattern={pattern} />
                      </p>
                    ))}
                  </div>
                ),
              )}
            </div>
          ))
        )}
      </div>
    </div>
  )
}
