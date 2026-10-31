/**
 * Issue #253 — the renderer half of the contract: the classified
 * `ConnectionErrorInfo` (`kind`, `target`, `httpStatus`, `detail`, `hint`) is
 * turned into text in the ACTIVE locale (EN / TR) by ONE helper.
 *
 * ─── CONTRACT ────────────────────────────────────────────────────────────────
 * `src/renderer/lib/connection-error.ts`
 *   describeConnectionError(info: ConnectionErrorInfo | null | undefined,
 *                           fallback?: string): string
 *     - no info  → `fallback` (the raw English `error` string of an old build /
 *                  a non-connection failure), or '' when none given;
 *     - info     → `<what>[ (HTTP <status>)][ — <target>][: <detail>][. <hint>]`,
 *                  `what` and `hint` from i18n (plain text, no placeholders);
 *                  ` (HTTP N)` is added whenever `info.httpStatus` is set.
 *                  Same composition order as the main process'
 *                  `formatConnectionError` / `ConnectionErrorInfo.message`, so
 *                  the EN text is IDENTICAL to the English string main puts in
 *                  `error` (no drift).
 * i18n keys (EN + TR, TR translated, not copied):
 *     connError.<kind>.what     for every kind in CONNECTION_ERROR_KINDS
 *     connError.<kind>.hint     for every kind except `unknown` and `aborted`
 *
 * Fail-before: no such keys / helper; WebSocket showed "Connection refused —
 * ECONNREFUSED connect ECONNREFUSED 127.0.0.1:1", Socket.IO "websocket error",
 * MCP "fetch failed", all English-only.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { CONNECTION_ERROR_KINDS, type ConnectionErrorInfo } from '../../src/shared/connection-error'
import { classifyTransportError, formatConnectionError } from '../../src/main/lib/error-classifier'
import { describeConnectionError } from '../../src/renderer/lib/connection-error'
import { setLocale, valuesInAllLocales } from '../../src/renderer/lib/i18n'

afterEach(() => setLocale('en'))

const NO_HINT = new Set(['unknown', 'aborted'])

const e = (message: string, props: Record<string, unknown> = {}): Error =>
  Object.assign(new Error(message), props)

/** Real classifier output (what main sends), one per interesting shape. */
const SAMPLES: Array<[string, ConnectionErrorInfo]> = [
  [
    'refused',
    classifyTransportError(e('connect ECONNREFUSED 127.0.0.1:3100', { code: 'ECONNREFUSED' }), {
      protocol: 'websocket',
      url: 'ws://127.0.0.1:3100',
    }) as ConnectionErrorInfo,
  ],
  [
    'dns',
    classifyTransportError(e('getaddrinfo ENOTFOUND x.invalid', { code: 'ENOTFOUND' }), {
      url: 'wss://x.invalid/ws',
    }) as ConnectionErrorInfo,
  ],
  [
    'timeout',
    classifyTransportError(e('connect ETIMEDOUT 10.0.0.1:80', { code: 'ETIMEDOUT' }), {
      url: 'http://10.0.0.1/',
    }) as ConnectionErrorInfo,
  ],
  [
    'bad-port',
    classifyTransportError(
      Object.assign(new TypeError('fetch failed'), { cause: new Error('bad port') }),
      { protocol: 'sse', url: 'http://127.0.0.1:1/' },
    ) as ConnectionErrorInfo,
  ],
  [
    'tls-untrusted',
    classifyTransportError(e('x', { code: 'DEPTH_ZERO_SELF_SIGNED_CERT' }), {
      url: 'https://s.test/',
    }) as ConnectionErrorInfo,
  ],
  [
    'unauthorized',
    classifyTransportError(e('Unexpected server response: 401'), {
      protocol: 'websocket',
      url: 'ws://h.test:9000/ws',
    }) as ConnectionErrorInfo,
  ],
  [
    'not-found',
    classifyTransportError(e('Unexpected server response: 404'), {
      protocol: 'websocket',
      url: 'ws://h.test:9000/ws',
    }) as ConnectionErrorInfo,
  ],
  [
    'http-status',
    classifyTransportError(e('Unexpected server response: 502'), {
      protocol: 'websocket',
      url: 'ws://h.test:9000/ws',
    }) as ConnectionErrorInfo,
  ],
  [
    'rejected',
    classifyTransportError(e('invalid token', { data: {} }), {
      protocol: 'socketio',
      url: 'http://sio.test:3300',
    }) as ConnectionErrorInfo,
  ],
  [
    'closed',
    classifyTransportError(e('Connection closed before the broker accepted it'), {
      protocol: 'mqtt',
      url: 'mqtt://b.test',
    }) as ConnectionErrorInfo,
  ],
  [
    'spawn-failed',
    classifyTransportError(e('spawn nope-cmd ENOENT', { code: 'ENOENT' }), {
      protocol: 'mcp',
      transport: 'stdio',
    }) as ConnectionErrorInfo,
  ],
]

describe('i18n keys', () => {
  it('every kind has an EN and a TR "what"; every kind but unknown/aborted has a hint', () => {
    for (const kind of CONNECTION_ERROR_KINDS) {
      const keys = [`connError.${kind}.what`, ...(NO_HINT.has(kind) ? [] : [`connError.${kind}.hint`])]
      for (const key of keys) {
        const [en, tr] = valuesInAllLocales(key)
        expect(en, key).toBeTruthy()
        expect(tr, key).toBeTruthy()
        // Translated, not copied (a few hints may legitimately match; none do today).
        expect(tr, key).not.toBe(en)
        // Plain text: the status / target / detail are appended by the helper.
        expect(en, key).not.toMatch(/\{[a-zA-Z]+\}/)
        expect(tr, key).not.toMatch(/\{[a-zA-Z]+\}/)
      }
    }
  })

  it('the samples cover real classifier output of the kinds above', () => {
    expect(SAMPLES.map(([k, i]) => [k, i.kind])).toEqual(SAMPLES.map(([k]) => [k, k]))
  })
})

describe('describeConnectionError', () => {
  it('EN equals the English string main sends — one format, no drift', () => {
    setLocale('en')
    for (const [kind, info] of SAMPLES) {
      expect(describeConnectionError(info), kind).toBe(formatConnectionError(info))
    }
  })

  it('TR: translated what + hint, the SAME host:port, status and server detail', () => {
    setLocale('tr')
    const refused = describeConnectionError(SAMPLES[0][1])
    const [, trWhat] = valuesInAllLocales('connError.refused.what')
    expect(refused).toContain(trWhat)
    expect(refused).toContain('127.0.0.1:3100')
    expect(refused).not.toMatch(/Connection refused/)

    const unauthorized = describeConnectionError(SAMPLES[5][1])
    expect(unauthorized).toContain('401')
    expect(unauthorized).toContain('h.test:9000')

    const rejected = describeConnectionError(SAMPLES[8][1])
    expect(rejected).toContain('invalid token')
    expect(rejected).toContain('sio.test:3300')
  })

  it('no target → no dangling separator / "undefined"', () => {
    for (const locale of ['en', 'tr'] as const) {
      setLocale(locale)
      const text = describeConnectionError(SAMPLES[10][1]) // stdio spawn-failed
      expect(text).toContain('nope-cmd')
      expect(text).not.toMatch(/undefined|null|\{target\}|\{status\}|— \.|—$/)
    }
  })

  it('no placeholder is ever left in the text', () => {
    for (const locale of ['en', 'tr'] as const) {
      setLocale(locale)
      for (const [kind, info] of SAMPLES) {
        expect(describeConnectionError(info), `${locale}/${kind}`).not.toMatch(/\{[a-z]+\}/)
      }
    }
  })

  it('without info the fallback (the raw error string) is returned unchanged', () => {
    expect(describeConnectionError(undefined, 'Something raw')).toBe('Something raw')
    expect(describeConnectionError(null, 'Something raw')).toBe('Something raw')
    expect(describeConnectionError(undefined)).toBe('')
  })
})
