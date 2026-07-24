/**
 * Certificate expiry classification — the 30-day amber boundary (design §9.4).
 *
 * Regression guard for the off-by-rounding bug: the threshold must compare the
 * RAW millisecond diff, so a cert ~29.6 days out is amber (warning), NOT rounded
 * up to 30 days → green. The rounded day count is display-only.
 */
import { describe, it, expect } from 'vitest'
import { certValidityStatus, AMBER_DAYS } from '../../src/renderer/components/tools/keystore/cert-validity'

const MS_PER_DAY = 24 * 60 * 60 * 1000
const NOW = Date.UTC(2026, 0, 1)

describe('certValidityStatus — 30-day boundary', () => {
  it('is valid (green) at exactly 30 days remaining', () => {
    const r = certValidityStatus(NOW + AMBER_DAYS * MS_PER_DAY, NOW)
    expect(r.status).toBe('valid')
    expect(r.days).toBe(30)
  })

  it('is warning (amber) just under 30 days', () => {
    const r = certValidityStatus(NOW + AMBER_DAYS * MS_PER_DAY - 1, NOW)
    expect(r.status).toBe('warning')
  })

  it('is warning (amber) at ~29.6 days — the rounding-bug regression', () => {
    // Old code rounded 29.6 → 30 and rendered GREEN; the raw diff is < 30d.
    const r = certValidityStatus(NOW + Math.round(29.6 * MS_PER_DAY), NOW)
    expect(r.status).toBe('warning')
    expect(r.days).toBe(30) // label rounds up, status does not
  })

  it('is valid (green) well beyond 30 days', () => {
    const r = certValidityStatus(NOW + 90 * MS_PER_DAY, NOW)
    expect(r.status).toBe('valid')
    expect(r.days).toBe(90)
  })

  it('is expired (red) once notAfter is in the past', () => {
    const r = certValidityStatus(NOW - 5 * MS_PER_DAY, NOW)
    expect(r.status).toBe('expired')
    expect(r.days).toBe(5)
  })
})
