import { useMemo, useState } from 'react'
import { DEVICE_KEYWORD_ALIASES } from '../lib/tenderFilters'

/** Must stay in sync with backend/tender_scraper/specs.py */
const FILE_PREFIX = '\u0001'
const SHEET_PREFIX = '\u0002'
const CELL_SEP = '\t'

const TRACKED_TERMS = Object.values(DEVICE_KEYWORD_ALIASES).flat()

type Block =
  | { kind: 'text'; lines: string[] }
  | { kind: 'table'; rows: string[][] }

interface FileGroup {
  name: string
  sheet: string | null
  blocks: Block[]
}

/**
 * The extractor emits one line per spreadsheet row / document paragraph, with
 * tab-separated cells. Older rows predate that format and arrive as one long
 * line, which still renders fine as a single text block.
 */
function parseSpec(text: string): FileGroup[] {
  const groups: FileGroup[] = []

  for (const raw of text.split('\n')) {
    const line = raw.replace(/\s+$/, '')
    if (!line.trim()) continue

    if (line.startsWith(FILE_PREFIX)) {
      groups.push({ name: line.slice(FILE_PREFIX.length).trim(), sheet: null, blocks: [] })
      continue
    }
    if (line.startsWith(SHEET_PREFIX)) {
      groups.push({
        name: groups[groups.length - 1]?.name ?? '',
        sheet: line.slice(SHEET_PREFIX.length).trim(),
        blocks: [],
      })
      continue
    }

    let current = groups[groups.length - 1]
    if (!current) {
      current = { name: '', sheet: null, blocks: [] }
      groups.push(current)
    }

    const blocks = current.blocks
    const last = blocks[blocks.length - 1]
    if (line.includes(CELL_SEP)) {
      const cells = line.split(CELL_SEP)
      if (last?.kind === 'table') last.rows.push(cells)
      else blocks.push({ kind: 'table', rows: [cells] })
    } else if (last?.kind === 'text') {
      last.lines.push(line)
    } else {
      blocks.push({ kind: 'text', lines: [line] })
    }
  }

  return groups
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function buildHighlighter(query: string): RegExp | null {
  const terms = [...TRACKED_TERMS]
  const trimmed = query.trim()
  if (trimmed) terms.unshift(trimmed)
  if (!terms.length) return null
  return new RegExp(`(${terms.map(escapeRegExp).join('|')})`, 'gi')
}

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

function matches(line: string, query: string): boolean {
  return !query || line.toLowerCase().includes(query.toLowerCase())
}

function filterGroups(groups: FileGroup[], query: string): FileGroup[] {
  if (!query.trim()) return groups
  const out: FileGroup[] = []
  for (const group of groups) {
    const blocks: Block[] = []
    for (const block of group.blocks) {
      if (block.kind === 'text') {
        const lines = block.lines.filter((l) => matches(l, query))
        if (lines.length) blocks.push({ kind: 'text', lines })
      } else {
        const rows = block.rows.filter((r) => matches(r.join(' '), query))
        if (rows.length) blocks.push({ kind: 'table', rows })
      }
    }
    if (blocks.length) out.push({ ...group, blocks })
  }
  return out
}

function countMatches(groups: FileGroup[], query: string): number {
  if (!query.trim()) return 0
  let n = 0
  for (const group of groups) {
    for (const block of group.blocks) {
      n +=
        block.kind === 'text'
          ? block.lines.filter((l) => matches(l, query)).length
          : block.rows.filter((r) => matches(r.join(' '), query)).length
    }
  }
  return n
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
