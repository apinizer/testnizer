import { describe, it, expect } from 'vitest'
import {
  detectUnit,
  epochToDate,
  formatUtc,
  fromParts,
  relative,
  localTzLabel,
} from '../../../src/renderer/lib/tools/epoch'

describe('detectUnit', () => {
  it('classifies seconds for ~10-digit values', () => {
    expect(detectUnit(1735689600)).toBe('seconds')
    expect(detectUnit(0)).toBe('seconds')
  })

  it('classifies milliseconds for ~13-digit values', () => {
    expect(detectUnit(1735689600000)).toBe('milliseconds')
  })

  it('classifies microseconds for ~16-digit values', () => {
    expect(detectUnit(1735689600000000)).toBe('microseconds')
  })

  it('classifies nanoseconds for ~19-digit values', () => {
    expect(detectUnit(1.7356896e18)).toBe('nanoseconds')
  })
})

describe('epochToDate', () => {
  it('decodes seconds to the correct UTC date', () => {
    // 2025-01-01T00:00:00Z
    const r = epochToDate(1735689600, 'seconds')
    expect(r.date.toISOString()).toBe('2025-01-01T00:00:00.000Z')
    expect(r.unit).toBe('seconds')
  })

  it('decodes milliseconds to the correct UTC date', () => {
    const r = epochToDate(1735689600123, 'milliseconds')
    expect(r.date.toISOString()).toBe('2025-01-01T00:00:00.123Z')
  })

  it('decodes microseconds (truncates to ms)', () => {
    const r = epochToDate(1_735_689_600_123_000, 'microseconds')
    expect(r.date.toISOString()).toBe('2025-01-01T00:00:00.123Z')
  })

  it('decodes nanoseconds (truncates to ms)', () => {
    // 1735689600 * 1e9 + 123 * 1e6 = 1.735689600123e18 (within float64 ms precision after /1e6)
    const r = epochToDate(1.735689600123e18, 'nanoseconds')
    expect(r.date.toISOString()).toBe('2025-01-01T00:00:00.123Z')
  })

  it('auto-detects unit by magnitude', () => {
    const r1 = epochToDate(1735689600) // seconds
    expect(r1.unit).toBe('seconds')
    const r2 = epochToDate(1735689600000) // ms
    expect(r2.unit).toBe('milliseconds')
  })
})

describe('formatUtc', () => {
  it('produces a stable UTC string for a known date', () => {
    const d = new Date('2025-01-01T12:34:56.000Z')
    const s = formatUtc(d)
    expect(s).toContain('2025')
    expect(s).toContain('12:34:56')
  })

  it('returns empty string for invalid Date', () => {
    expect(formatUtc(new Date('not-a-date'))).toBe('')
  })
})

describe('fromParts', () => {
  it('builds a UTC date from GMT parts', () => {
    const d = fromParts({ y: 2025, mo: 1, d: 1, h: 0, mi: 0, s: 0 }, 'gmt')
    expect(d.toISOString()).toBe('2025-01-01T00:00:00.000Z')
  })

  it('builds a local-zone Date from local parts (round-trip via getters)', () => {
    const d = fromParts({ y: 2025, mo: 6, d: 15, h: 10, mi: 30, s: 0 }, 'local')
    expect(d.getFullYear()).toBe(2025)
    expect(d.getMonth()).toBe(5) // 0-indexed
    expect(d.getDate()).toBe(15)
    expect(d.getHours()).toBe(10)
    expect(d.getMinutes()).toBe(30)
  })
})

describe('relative', () => {
  it('reports past dates with "ago"', () => {
    const now = new Date('2025-01-01T00:00:00Z')
    const past = new Date('2024-12-31T23:59:00Z') // 60s ago
    const s = relative(past, now)
    expect(s).toMatch(/ago/)
  })

  it('reports future dates with "in"', () => {
    const now = new Date('2025-01-01T00:00:00Z')
    const future = new Date('2025-01-01T00:01:00Z') // in 60s
    const s = relative(future, now)
    expect(s).toMatch(/^in /)
  })

  it('uses years for very large distances', () => {
    const now = new Date('2025-01-01T00:00:00Z')
    const past = new Date('2020-01-01T00:00:00Z')
    expect(relative(past, now)).toMatch(/year/)
  })
})

describe('localTzLabel', () => {
  it('returns a "GMT±HH:MM" string', () => {
    expect(localTzLabel()).toMatch(/^GMT[+-]\d{2}:\d{2}$/)
  })
})
