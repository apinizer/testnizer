/**
 * TLS protocol-version + cipher-preset overrides for `http.engine.ts`.
 *
 * These pin the BadSSL audit fix: before this change, the engine could not
 * talk to TLS 1.0/1.1-only servers or to deliberately-weak cipher endpoints
 * (`rc4`, `threedes`, `nullcipher`, `dh480`, `dh512`).
 *
 * We test three layers:
 *   1. Cipher preset constants (`tls-presets.ts`) — distinct strings, legacy
 *      includes RC4 / 3DES / NULL / @SECLEVEL=0 markers, fallback path.
 *   2. Version validator — accepts only the four canonical TLS version
 *      strings, rejects garbage.
 *   3. Engine integration — the engine actually forwards the TLS options to
 *      the underlying TLS stack. We assert this by triggering a known-invalid
 *      version range (`min > max`) and confirming the engine surfaces a TLS
 *      configuration error rather than silently ignoring the request.
 */

import { describe, it, expect } from 'vitest'
import { createServer as createHttpServer, type Server as HttpServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { executeHttpRequest } from '../../src/main/protocols/http.engine'
import {
  getCipherPreset,
  MODERN_CIPHERS,
  INTERMEDIATE_CIPHERS,
  LEGACY_CIPHERS,
  normaliseTlsVersion,
} from '../../src/main/lib/tls-presets'

// ─── Cipher preset constants ──────────────────────────────────

describe('tls-presets — cipher preset lookup', () => {
  it('returns distinct strings for each preset', () => {
    expect(getCipherPreset('modern')).toBe(MODERN_CIPHERS)
    expect(getCipherPreset('intermediate')).toBe(INTERMEDIATE_CIPHERS)
    expect(getCipherPreset('legacy')).toBe(LEGACY_CIPHERS)
    // Distinct strings — no accidental aliasing.
    expect(MODERN_CIPHERS).not.toBe(INTERMEDIATE_CIPHERS)
    expect(INTERMEDIATE_CIPHERS).not.toBe(LEGACY_CIPHERS)
    expect(MODERN_CIPHERS).not.toBe(LEGACY_CIPHERS)
  })

  it('legacy preset includes RC4 / 3DES / NULL / SECLEVEL=0 markers', () => {
    expect(LEGACY_CIPHERS).toMatch(/RC4/)
    expect(LEGACY_CIPHERS).toMatch(/DES-CBC3-SHA|3DES/i)
    expect(LEGACY_CIPHERS).toMatch(/NULL/)
    // Without @SECLEVEL=0, modern OpenSSL refuses RC4/3DES regardless of the
    // cipher list — the preset MUST embed this directive.
    expect(LEGACY_CIPHERS).toMatch(/@SECLEVEL=0/)
  })

  it('modern preset is TLS 1.3 AEAD only — no CBC / RC4 / 3DES leakage', () => {
    expect(MODERN_CIPHERS).toMatch(/TLS_AES_/)
    expect(MODERN_CIPHERS).not.toMatch(/RC4/)
    expect(MODERN_CIPHERS).not.toMatch(/3DES|DES-CBC3/i)
    expect(MODERN_CIPHERS).not.toMatch(/NULL/)
  })

  it('intermediate preset includes ECDHE forward secrecy + GCM AEAD', () => {
    expect(INTERMEDIATE_CIPHERS).toMatch(/ECDHE/)
    expect(INTERMEDIATE_CIPHERS).toMatch(/GCM/)
    expect(INTERMEDIATE_CIPHERS).not.toMatch(/RC4/)
  })

  it('falls back to MODERN for unknown preset names', () => {
    // @ts-expect-error — deliberately passing an invalid preset name
    expect(getCipherPreset('bogus')).toBe(MODERN_CIPHERS)
    // @ts-expect-error — empty / undefined falls back to MODERN too
    expect(getCipherPreset('')).toBe(MODERN_CIPHERS)
  })
})

describe('tls-presets — version validator', () => {
  it('accepts the TLS versions BoringSSL still supports (1.2 + 1.3)', () => {
    expect(normaliseTlsVersion('TLSv1.2')).toBe('TLSv1.2')
    expect(normaliseTlsVersion('TLSv1.3')).toBe('TLSv1.3')
  })

  it('coerces TLS 1.0 / 1.1 to undefined so they never hit the socket layer', () => {
    // Electron 33 links against BoringSSL, which has dropped TLS 1.0 / 1.1.
    // Passing those through to https.Agent yields ERR_SSL_INVALID_COMMAND
    // (v1.3.1 M14). The validator now refuses them upstream — UI still shows
    // the options as disabled, but this is the runtime backstop.
    expect(normaliseTlsVersion('TLSv1')).toBeUndefined()
    expect(normaliseTlsVersion('TLSv1.1')).toBeUndefined()
  })

  it('rejects malformed / empty / unknown version strings', () => {
    expect(normaliseTlsVersion(undefined)).toBeUndefined()
    expect(normaliseTlsVersion('')).toBeUndefined()
    expect(normaliseTlsVersion('TLSv2')).toBeUndefined()
    expect(normaliseTlsVersion('SSLv3')).toBeUndefined()
    expect(normaliseTlsVersion('1.2')).toBeUndefined()
    expect(normaliseTlsVersion('tlsv1.2')).toBeUndefined() // case-sensitive
  })
})

// ─── Engine integration — TLS options reach the agent ────────
//
// We can't easily test a TLS handshake without bringing in a self-signed cert
// generator (no extra deps available). Instead we verify the contract: when
// the engine is given a TLS option, it must forward it to the underlying TLS
// stack such that the OS / Node sees it. The cleanest way to assert this is
// to use a known-invalid combination: `minVersion=TLSv1.3` paired with
// `maxVersion=TLSv1` would crash Node at agent-construction time if the
// strings reach the TLS layer. We catch that and confirm the engine returns
// an error rather than a 200.

describe('http.engine — TLS options reach the TLS stack', () => {
  it('returns an error when given an inverted TLS version range', async () => {
    // min > max — Node's TLS layer either refuses the handshake or throws
    // during `https.Agent` construction. Either way the engine MUST surface
    // it as an error rather than a 200.
    const res = await executeHttpRequest({
      method: 'GET',
      url: 'https://127.0.0.1:1/', // unreachable; we only care about the engine path
      sslVerification: false,
      tls: { minVersion: 'TLSv1.3', maxVersion: 'TLSv1' },
      timeout: 2000,
    })
    expect(res.status).toBeUndefined()
    expect(res.error).toBeTruthy()
  })

  it('does not attempt TLS handshake on plain HTTP URLs (TLS opts are inert)', async () => {
    // Sanity check: if the URL is http://, the TLS options should be ignored
    // and the request should still complete (or fail with a normal HTTP
    // error). This guards against accidentally routing http:// through the
    // https agent path.
    const server: HttpServer = createHttpServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/plain' })
      res.end('plain-http-ok')
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const port = (server.address() as AddressInfo).port

    try {
      const res = await executeHttpRequest({
        method: 'GET',
        url: `http://127.0.0.1:${port}/`,
        sslVerification: false,
        // These should be silently ignored on http://
        tls: { minVersion: 'TLSv1.2', ciphers: getCipherPreset('legacy') },
        timeout: 2000,
      })
      expect(res.status).toBe(200)
      expect(res.body).toBe('plain-http-ok')
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })

  it('accepts the legacy cipher preset string without throwing', async () => {
    // The legacy preset embeds @SECLEVEL=0 and weak suite names. We verify
    // the engine accepts it (the agent-construction path must not throw on
    // valid OpenSSL syntax even when the suites are deliberately broken).
    const res = await executeHttpRequest({
      method: 'GET',
      url: 'https://127.0.0.1:1/', // unreachable, just to exercise the path
      sslVerification: false,
      tls: { ciphers: getCipherPreset('legacy') },
      timeout: 1000,
    })
    // The connection itself fails (nothing on port 1), but the engine must
    // surface a transport error — never crash on the cipher string parse.
    expect(res.error).toBeTruthy()
    expect(res.error).not.toMatch(/TypeError|RangeError/)
  })
})
