/**
 * 1.6.0 screen review, second round — G-07 remainder (issue #258, issue #261).
 *
 * The Turkish HTTP mock editor's help texts still mixed English prose:
 * "Body draft-07 schema'ya uymalı", "Failure Config", "Rate Limit Config",
 * "Retry-After header'ı set edilir", "CORS Credentials", "(query string)",
 * "(path param)", "upstream". JSON field names and examples (`enabled`,
 * `"header"`, `Retry-After`) stay as they are — they are what the user types.
 */
import { describe, it, expect, afterEach } from 'vitest'
import { setLocale, t } from '../../src/renderer/lib/i18n'

afterEach(() => setLocale('en'))

/** Prose fragments that must not appear in the TR mock help texts. */
const LOANS: Array<[string, RegExp]> = [
  ['mock.endpointSchemaValidationHint', /\bBody\b|schema'ya|detay/],
  ['mock.endpointSchemaValidation', /Doğrulama\b/],
  ['mock.failureConfig', /Failure|Config/],
  ['mock.rateLimitConfig', /Rate Limit|Config/],
  ['mock.rateLimitHint', /header'ı|set edilir/],
  ['mock.corsAllowCredentials', /Credentials/],
  ['mock.bodyHint', /query string|path param/],
  ['mock.proxyEnabled', /upstream/],
  ['mock.proxyHint', /upstream/],
  ['mock.selectLog', /\blog\b/],
]

describe('TR mock editor help texts (G-07 remainder)', () => {
  it.each(LOANS)('%s has no English prose fragment', (key, re) => {
    setLocale('tr')
    const value = t(key)
    expect(value).not.toBe(key)
    expect(value).not.toMatch(re)
  })

  it('the schema-validation hint says the same as EN: body must match draft-07, else 400 + errors', () => {
    setLocale('tr')
    expect(t('mock.endpointSchemaValidationHint')).toBe(
      '{"enabled":true,"schema":{...}}. Gövde draft-07 şemasına uymalı, aksi takdirde 400 + hata ayrıntısı döner.',
    )
  })

  it('JSON field names stay literal in TR (they are typed by the user)', () => {
    setLocale('tr')
    expect(t('mock.rateLimitHint')).toMatch(/requestsPerWindow, windowMs/)
    expect(t('mock.rateLimitHint')).toMatch(/Retry-After/)
    expect(t('mock.bodyHint')).toMatch(/\{\{request\.query\.x\}\}/)
  })
})
