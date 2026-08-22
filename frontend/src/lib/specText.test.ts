import { describe, expect, it } from 'vitest'
import { CELL_SEP, FILE_PREFIX, SHEET_PREFIX, countMatches, filterGroups, parseSpec } from './specText'

const FILE = FILE_PREFIX
const SHEET = SHEET_PREFIX
const TAB = CELL_SEP

describe('parseSpec', () => {
  it('groups tab-separated lines into one table', () => {
    const groups = parseSpec(
      [
        `${FILE}ტექნიკური დავალება.xlsx`,
        `N${TAB}დასახელება${TAB}რაოდენობა`,
        `1${TAB}კომუტატორი${TAB}20`,
      ].join('\n'),
    )

    expect(groups).toHaveLength(1)
    expect(groups[0]!.name).toBe('ტექნიკური დავალება.xlsx')
    expect(groups[0]!.blocks).toEqual([
      {
        kind: 'table',
        rows: [
          ['N', 'დასახელება', 'რაოდენობა'],
          ['1', 'კომუტატორი', '20'],
        ],
      },
    ])
  })

  it('keeps plain lines and tables as separate blocks', () => {
    const groups = parseSpec(
      [`${FILE}spec.pdf`, 'ზოგადი მოთხოვნები', `1${TAB}კომუტატორი`, 'დანართი'].join('\n'),
    )

    expect(groups[0]!.blocks.map((b) => b.kind)).toEqual(['text', 'table', 'text'])
  })

  it('starts a new group per sheet and carries the file name over', () => {
    const groups = parseSpec(
      [`${FILE}wb.xlsx`, `${SHEET}კომუტატორები`, '24 პორტი', `${SHEET}როუტერები`, 'SD-WAN'].join(
        '\n',
      ),
    )

    expect(groups.map((g) => [g.name, g.sheet])).toEqual([
      ['wb.xlsx', null],
      ['wb.xlsx', 'კომუტატორები'],
      ['wb.xlsx', 'როუტერები'],
    ])
  })

  it('renders pre-structure text as a single block', () => {
    const groups = parseSpec('ტექნიკური დავალება ერთ ხაზად ყველაფერი')

    expect(groups).toHaveLength(1)
    expect(groups[0]!.blocks).toEqual([
      { kind: 'text', lines: ['ტექნიკური დავალება ერთ ხაზად ყველაფერი'] },
    ])
  })

  it('ignores blank lines', () => {
    expect(parseSpec('')).toEqual([])
    expect(parseSpec('\n   \n')).toEqual([])
  })
})

describe('filterGroups', () => {
  const groups = parseSpec(
    [
      `${FILE}spec.xlsx`,
      'ზოგადი მოთხოვნები',
      `1${TAB}კომუტატორი${TAB}20 პორტი`,
      `2${TAB}მარშრუტიზატორი${TAB}4 პორტი`,
    ].join('\n'),
  )

  it('keeps only matching rows and drops emptied groups', () => {
    const filtered = filterGroups(groups, 'კომუტატორი')
    const table = filtered[0]!.blocks[0]!

    expect(filtered[0]!.blocks).toHaveLength(1)
    expect(table.kind === 'table' && table.rows).toEqual([['1', 'კომუტატორი', '20 პორტი']])
    expect(filterGroups(groups, 'არარსებული')).toEqual([])
  })

  it('matches across cells of the same row and is case insensitive', () => {
    expect(countMatches(groups, 'პორტი')).toBe(2)
    expect(countMatches(groups, 'ᲙᲝᲛᲣᲢᲐᲢᲝᲠᲘ'.toLowerCase())).toBe(1)
    expect(countMatches(groups, '')).toBe(0)
  })

  it('returns everything when the query is blank', () => {
    expect(filterGroups(groups, '   ')).toBe(groups)
  })
})
