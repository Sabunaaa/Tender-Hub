import { describe, expect, it } from 'vitest'
import { activeDatePreset, filtersFromParams } from './tenderFilters'

describe('filtersFromParams', () => {
  it('uses defaults for an empty query string', () => {
    const filters = filtersFromParams(new URLSearchParams())
    expect(filters.page).toBe(1)
    expect(filters.pageSize).toBe(20)
    expect(filters.sortBy).toBe('announcementDate')
    expect(filters.sortDir).toBe('desc')
  })

  it('rejects invalid page and sort values', () => {
    const filters = filtersFromParams(
      new URLSearchParams('page=abc&pageSize=-3&sortBy=nope&sortDir=sideways'),
    )
    expect(filters.page).toBe(1)
    expect(filters.pageSize).toBe(20)
    expect(filters.sortBy).toBe('announcementDate')
    expect(filters.sortDir).toBe('desc')
  })

  it('honours a custom default page size', () => {
    const filters = filtersFromParams(new URLSearchParams(), { pageSize: 50 })
    expect(filters.pageSize).toBe(50)
  })

  it('applies the closing-soon window from preset or the legacy alias', () => {
    const fromPreset = filtersFromParams(new URLSearchParams('preset=7d'))
    const fromLegacy = filtersFromParams(new URLSearchParams('deadlinePreset=7d'))
    expect(fromPreset.deadlineFrom).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(fromPreset.deadlineTo).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(fromLegacy.deadlineFrom).toBe(fromPreset.deadlineFrom)
    expect(fromLegacy.deadlineTo).toBe(fromPreset.deadlineTo)
  })
})

describe('activeDatePreset', () => {
  it('reads preset and the legacy deadlinePreset alias', () => {
    expect(activeDatePreset(new URLSearchParams('preset=7d'))).toBe('7d')
    expect(activeDatePreset(new URLSearchParams('deadlinePreset=7d'))).toBe('7d')
  })
})
