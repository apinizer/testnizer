/**
 * Issue #287 (decision 1): "Follow redirects" gets the same tri-state model and
 * shared chain as SSL verification — and the encoders every writer uses.
 *
 *  - `resolveFollowRedirects(request, project, app)`: request → project → app →
 *    true, same shape as `resolveSslVerification`.
 *  - `requestFollowRedirects(readRequestSettings(row))`: a stored `false` is an
 *    explicit off, a `true` counts only with `followRedirectsExplicit: true`; a
 *    bare `true` is the legacy every-save default → inherit. (`readRequestSettings`
 *    itself keeps the stored `followRedirects` — exporters write it as stored —
 *    see ssl-verification-resolver.test.ts "the other keys are untouched".)
 *  - `encodeSslVerification` / `encodeFollowRedirects`: `null` writes nothing,
 *    `false` the value, `true` the value + marker; the reader's output spread
 *    into a row is lossless (importers rely on that).
 *  - Importers mark an explicit `true`: Postman `strictSSL` / `followRedirects`.
 *  - `resolveTlsPayload` moved to `tls-presets.ts` so Run resolves the project
 *    TLS preset exactly like Send's `request:send` handler.
 */
import { describe, expect, it } from 'vitest'
import {
  encodeFollowRedirects,
  encodeSslVerification,
  readRequestSettings,
  requestFollowRedirects,
  requestSslVerification,
  resolveFollowRedirects,
} from '../../../src/shared/request-settings'
import { ppbToRequestSettings } from '../../../src/main/import/postman/settings'
import { getCipherPreset, resolveTlsPayload } from '../../../src/main/lib/tls-presets'

describe('resolveFollowRedirects: request → project → app → true', () => {
  const cases: Array<
    [boolean | null | undefined, boolean | null | undefined, boolean | null | undefined, boolean]
  > = [
    [undefined, undefined, undefined, true],
    [null, null, null, true],
    [null, undefined, false, false],
    [null, false, true, false],
    [null, true, false, true],
    [true, false, false, true],
    [false, true, true, false],
  ]
  for (const [req, project, app, expected] of cases) {
    it(`(${String(req)}, ${String(project)}, ${String(app)}) -> ${expected}`, () => {
      expect(resolveFollowRedirects(req, project, app)).toBe(expected)
    })
  }
})

describe('requestFollowRedirects — the legacy bare true is inherit', () => {
  it('absent -> undefined', () => {
    expect(requestFollowRedirects(readRequestSettings({}))).toBeUndefined()
  })
  it('stored false -> explicit off', () => {
    expect(requestFollowRedirects(readRequestSettings({ followRedirects: false }))).toBe(false)
  })
  it('LEGACY bare true -> inherit (the reader still reports the stored true)', () => {
    const s = readRequestSettings({ followRedirects: true, maxRedirects: 5 })
    expect(s.followRedirects).toBe(true)
    expect(requestFollowRedirects(s)).toBeUndefined()
  })
  it('marked true -> explicit on', () => {
    expect(
      requestFollowRedirects(
        readRequestSettings({ followRedirects: true, followRedirectsExplicit: true }),
      ),
    ).toBe(true)
  })
  it('a marker on a false value is ignored', () => {
    const s = readRequestSettings({ followRedirects: false, followRedirectsExplicit: true })
    expect(s.followRedirectsExplicit).toBeUndefined()
    expect(requestFollowRedirects(s)).toBe(false)
  })
})

describe('encoders — one persisted shape for every writer', () => {
  it('null / undefined write nothing', () => {
    expect(encodeSslVerification(null)).toEqual({})
    expect(encodeSslVerification(undefined)).toEqual({})
    expect(encodeFollowRedirects(null)).toEqual({})
  })
  it('false writes the value alone', () => {
    expect(encodeSslVerification(false)).toEqual({ sslVerification: false })
    expect(encodeFollowRedirects(false)).toEqual({ followRedirects: false })
  })
  it('true writes the value + its marker', () => {
    expect(encodeSslVerification(true)).toEqual({
      sslVerification: true,
      sslVerificationExplicit: true,
    })
    expect(encodeFollowRedirects(true)).toEqual({
      followRedirects: true,
      followRedirectsExplicit: true,
    })
  })
  it('encode → read → spread → read is lossless', () => {
    for (const v of [true, false, null] as const) {
      const row = { ...encodeSslVerification(v), ...encodeFollowRedirects(v) }
      const once = readRequestSettings(row)
      const twice = readRequestSettings({ ...once })
      expect(requestSslVerification(twice)).toBe(v ?? undefined)
      expect(requestFollowRedirects(twice)).toBe(v ?? undefined)
    }
  })
})

describe('Postman import marks explicit choices (protocolProfileBehavior)', () => {
  it('strictSSL true / followRedirects true are explicit overrides', () => {
    const s = ppbToRequestSettings({ strictSSL: true, followRedirects: true })
    expect(s).toMatchObject({
      sslVerification: true,
      sslVerificationExplicit: true,
      followRedirects: true,
      followRedirectsExplicit: true,
    })
    const reread = readRequestSettings({ ...s })
    expect(requestSslVerification(reread)).toBe(true)
    expect(requestFollowRedirects(reread)).toBe(true)
  })
  it('false values stay plain false', () => {
    expect(ppbToRequestSettings({ strictSSL: false, followRedirects: false })).toEqual({
      sslVerification: false,
      followRedirects: false,
    })
  })
})

describe('resolveTlsPayload (shared by Send and Run)', () => {
  it('nothing / modern only -> undefined', () => {
    expect(resolveTlsPayload(undefined)).toBeUndefined()
    expect(resolveTlsPayload({ cipherPreset: 'modern' })).toBeUndefined()
  })
  it('versions + presets resolve to engine options', () => {
    expect(resolveTlsPayload({ minVersion: 'TLSv1.2', cipherPreset: 'intermediate' })).toEqual({
      minVersion: 'TLSv1.2',
      maxVersion: undefined,
      ciphers: getCipherPreset('intermediate'),
    })
    expect(
      resolveTlsPayload({ cipherPreset: 'custom', ciphersCustom: ' AES128-SHA ' })?.ciphers,
    ).toBe('AES128-SHA')
    expect(resolveTlsPayload({ minVersion: 'bogus' })).toBeUndefined()
  })
})
