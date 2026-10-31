/**
 * Issue #309 — renderer half: the response error panel (HTTP / GraphQL / SOAP)
 * says "request timeout" and where it is set, in EN and TR; a WebSocket (or
 * any connect) result keeps "connect timeout". The distinction is the
 * result's own `protocol`, read by the ONE renderer formatter
 * (`connectErrorText` / `describeConnectionError`).
 */
import { afterEach, describe, expect, it } from 'vitest'
import { connectErrorText, describeConnectionError } from '../../src/renderer/lib/connection-error'
import { setLocale } from '../../src/renderer/lib/i18n'
import type { ConnectionErrorInfo } from '../../src/shared/connection-error'

afterEach(() => setLocale('en'))

const INFO: ConnectionErrorInfo = {
  kind: 'timeout',
  target: '10.0.0.1:443',
  code: 'ETIMEDOUT',
  message: 'Connection timed out — 10.0.0.1:443',
  hint: 'whatever main wrote',
}

const result = (protocol?: string) => ({
  ...(protocol ? { protocol } : {}),
  error: 'raw',
  errorInfo: INFO,
})

describe('timeout hint: request vs connect (issue #309)', () => {
  it.each(['http', 'graphql', 'soap'])('EN %s → request timeout + where to set it', (p) => {
    setLocale('en')
    const text = connectErrorText(result(p), 'x')
    expect(text).toBe(
      'Connection timed out — 10.0.0.1:443. Check the host and port; if the server is slow, raise the request timeout in the request Settings tab, the project settings or app Settings',
    )
  })

  it.each(['http', 'graphql', 'soap'])('TR %s → istek zaman aşımı', (p) => {
    setLocale('tr')
    const text = connectErrorText(result(p), 'x')
    expect(text).toMatch(/istek zaman aşımını/)
    expect(text).toMatch(/Ayarlar sekmesinden/)
    expect(text).toMatch(/proje ayarlarından/)
    expect(text).not.toMatch(/bağlantı zaman aşımını/)
  })

  it.each(['websocket', 'socketio', 'sse', 'mcp', 'mqtt', undefined])(
    'EN %s → keeps connect timeout',
    (p) => {
      setLocale('en')
      const text = connectErrorText(result(p), 'x')
      expect(text).toMatch(/raise the connect timeout in Settings$/)
      expect(text).not.toMatch(/request timeout/)
    },
  )

  it('TR websocket → keeps bağlantı zaman aşımı', () => {
    setLocale('tr')
    const text = connectErrorText(result('websocket'), 'x')
    expect(text).toMatch(/bağlantı zaman aşımını/)
    expect(text).not.toMatch(/istek zaman aşımını/)
  })

  it('describeConnectionError takes the protocol too', () => {
    setLocale('en')
    expect(describeConnectionError(INFO, 'x', 'http')).toMatch(/request timeout/)
    expect(describeConnectionError(INFO, 'x')).toMatch(/connect timeout/)
  })

  it('other kinds are unaffected by the protocol', () => {
    setLocale('en')
    const refused: ConnectionErrorInfo = {
      kind: 'refused',
      target: '127.0.0.1:9',
      message: 'Connection refused — 127.0.0.1:9',
    }
    expect(connectErrorText({ protocol: 'http', errorInfo: refused }, 'x')).toBe(
      connectErrorText({ protocol: 'websocket', errorInfo: refused }, 'x'),
    )
  })
})
