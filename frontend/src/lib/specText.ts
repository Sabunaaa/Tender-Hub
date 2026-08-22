import { DEVICE_KEYWORD_ALIASES } from './tenderFilters'

/** Must stay in sync with backend/tender_scraper/specs.py */
export const FILE_PREFIX = '\u0001'
export const SHEET_PREFIX = '\u0002'
export const CELL_SEP = '\t'

const TRACKED_TERMS = Object.values(DEVICE_KEYWORD_ALIASES).flat()

export type Block =
  | { kind: 'text'; lines: string[] }
  | { kind: 'table'; rows: string[][] }

export interface FileGroup {
  name: string
  sheet: string | null
  blocks: Block[]
}

/**
 * The extractor emits one line per spreadsheet row / document paragraph, with
 * tab-separated cells. Older rows predate that format and arrive as one long
 * line, which still renders fine as a single text block.
 */
export function parseSpec(text: string): FileGroup[] {
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

/** Matches the search term plus every tracked device keyword. */
export function buildHighlighter(query: string): RegExp | null {
  const terms = [...TRACKED_TERMS]
  const trimmed = query.trim()
  if (trimmed) terms.unshift(trimmed)
  if (!terms.length) return null
  return new RegExp(`(${terms.map(escapeRegExp).join('|')})`, 'gi')
}

function matches(line: string, query: string): boolean {
  return !query || line.toLowerCase().includes(query.toLowerCase())
}

export function filterGroups(groups: FileGroup[], query: string): FileGroup[] {
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

export function countMatches(groups: FileGroup[], query: string): number {
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
