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

/**
 * Issue #221 review (PR #225), item 6 — the AI mock's OpenAI stream reports
 * usage on the finish chunk ALWAYS and, with `include_usage`, again on
 * OpenAI's `choices: []` chunk. The LLM hint says so (a client that sums
 * usage across chunks would double count), in both locales.
 */
describe('mockLlm.bodyHint explains where streamed usage is sent', () => {
  for (const locale of ['en', 'tr'] as const) {
    it(`mentions the finish chunk, include_usage and choices: [] in ${locale}`, () => {
      setLocale(locale)
      const hint = t('mockLlm.bodyHint')
      expect(hint).toContain('stream_options.include_usage')
      expect(hint).toContain('choices: []')
      expect(hint).toMatch(locale === 'en' ? /finish chunk/ : /bitiş parçası/)
      expect(hint).toMatch(locale === 'en' ? /twice/ : /iki kez/)
    })
  }
})
