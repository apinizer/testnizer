/**
 * #30 — the mock body templating hint must document {{request.query.x}} for
 * query params (and distinguish it from path params), in both locales.
 */
import { describe, it, expect, afterAll } from 'vitest'
import { t, setLocale, getLocale } from '../../src/renderer/lib/i18n'

const original = getLocale()
afterAll(() => setLocale(original))

describe('mock.bodyHint lists query syntax (#30)', () => {
  for (const locale of ['en', 'tr'] as const) {
    it(`mentions {{request.query.x}} and path params in ${locale}`, () => {
      setLocale(locale)
      const hint = t('mock.bodyHint')
      expect(hint).toContain('{{request.query.x}}')
      expect(hint).toContain('{{request.params.x}}')
    })
  }
})
