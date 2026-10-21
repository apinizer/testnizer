/**
 * PM review 1.6.0 #21 — the "Change the server type?" confirm used to read
 * "4 response(s) … (llm)": a "(s)" plural and the stored body type value.
 * The body now has a real singular / plural in English, Turkish needs none,
 * and body types are named by their labels ("AI reply", "SSE stream") — the
 * same labels the response editor's body-type select shows.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { setLocale, t } from '../../src/renderer/lib/i18n'
import {
  bodyTypeLabel,
  serverTypeConfirmBody,
} from '../../src/renderer/components/mock/mock-kind-ui'

afterEach(() => setLocale('en'))

describe('serverTypeConfirmBody', () => {
  it('EN: singular for one response, plural for several, labels instead of raw values', () => {
    setLocale('en')
    const one = serverTypeConfirmBody(t, { count: 1, kind: 'HTTP', types: ['sse'] })
    expect(one).toMatch(
      /^1 response uses a body type that HTTP servers do not offer \(SSE stream\)/,
    )
    expect(one).toMatch(/it keeps serving/)
    const many = serverTypeConfirmBody(t, { count: 4, kind: 'SSE', types: ['llm'] })
    expect(many).toMatch(/^4 responses use a body type that SSE servers do not offer \(AI reply\)/)
    for (const text of [one, many]) {
      expect(text).not.toContain('(s)')
      expect(text).not.toMatch(/\((llm|sse)\)/)
    }
  })

  it('TR: no noun plural after a number, Turkish labels', () => {
    setLocale('tr')
    const one = serverTypeConfirmBody(t, { count: 1, kind: 'HTTP', types: ['llm', 'sse'] })
    expect(one).toMatch(
      /^1 yanıt, HTTP sunucularının sunmadığı bir gövde tipi kullanıyor \(AI yanıtı, SSE akışı\)/,
    )
    expect(one).toContain('bu yanıt şimdiki gibi')
    const many = serverTypeConfirmBody(t, { count: 3, kind: 'AI', types: ['sse'] })
    expect(many).toMatch(/^3 yanıt, AI sunucularının/)
    expect(many).toContain('bu yanıtlar şimdiki gibi')
  })

  it('every body type has a label in both languages', () => {
    for (const locale of ['en', 'tr'] as const) {
      setLocale(locale)
      for (const b of ['json', 'xml', 'text', 'html', 'sse', 'llm'] as const) {
        const label = bodyTypeLabel(t, b)
        expect(label).not.toMatch(/^mock\./)
        expect(label).not.toBe(b)
      }
    }
  })
})
