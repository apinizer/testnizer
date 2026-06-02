/**
 * #34 — auto-updater error messaging. macOS code-signature failures (unsigned
 * / ad-hoc builds can't self-update) become an actionable message; everything
 * else passes through unchanged.
 */
import { describe, it, expect } from 'vitest'
import { formatUpdaterError } from '../../src/main/lib/updater-error'

describe('formatUpdaterError (#34)', () => {
  it('rephrases the macOS code-signature error', () => {
    const out = formatUpdaterError(
      'darwin',
      'Could not get code signature for running application',
    )
    expect(out).toMatch(/not available for this macOS build/i)
    expect(out).toMatch(/manually/i)
  })

  it('matches the "signature is not valid for use in process" variant', () => {
    const out = formatUpdaterError('darwin', 'Code signature ... is not valid for use in process')
    expect(out).toMatch(/manually/i)
  })

  it('passes through unrelated errors on macOS verbatim', () => {
    const msg = 'net::ERR_INTERNET_DISCONNECTED'
    expect(formatUpdaterError('darwin', msg)).toBe(msg)
  })

  it('does not rephrase code-signature wording on non-macOS platforms', () => {
    const msg = 'Could not get code signature'
    expect(formatUpdaterError('win32', msg)).toBe(msg)
    expect(formatUpdaterError('linux', msg)).toBe(msg)
  })
})
