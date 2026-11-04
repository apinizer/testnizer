/**
 * The wording of a GraphQL subscription's outcome. Main writes it in English from
 * `GQL_WS_TEXT_EN` for Console and History; the renderer writes it in the active
 * locale from the i18n keys. Same keys, same English, Turkish translated.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { GQL_WS_TEXT_EN } from '../../src/shared/graphql-ws'
import { setLocale, t } from '../../src/renderer/lib/i18n'
import {
  subscriptionEndText,
  subscriptionFailureText,
} from '../../src/renderer/lib/graphql-subscription-text'

afterEach(() => setLocale('en'))

const refused = {
  error: 'x',
  errorInfo: { kind: 'closed', target: 'a.test:80', message: 'Connection closed' },
}

describe('GraphQL subscription text', () => {
  it('EN i18n equals the table main writes from', () => {
    setLocale('en')
    for (const [key, value] of Object.entries(GQL_WS_TEXT_EN)) expect(t(key), key).toBe(value)
  })

  it('TR has its own text for every key', () => {
    setLocale('tr')
    for (const [key, value] of Object.entries(GQL_WS_TEXT_EN)) {
      expect(t(key), key).not.toBe(key)
      expect(t(key), key).not.toBe(value)
    }
  })

  it('a named close code keeps its meaning in the failure, in the active locale', () => {
    const res = { ...refused, failure: { reason: 'closed' as const, closeCode: 4403 } }
    setLocale('en')
    expect(subscriptionFailureText(res, 'f')).toContain('4403: Forbidden')
    expect(subscriptionFailureText(res, 'f')).toContain('a.test:80')
    setLocale('tr')
    expect(subscriptionFailureText(res, 'f')).toContain('4403: Erişim engellendi')
    expect(subscriptionFailureText(res, 'f')).toContain('sunucu günlüklerini')
  })

  it('no ack names the seconds waited', () => {
    const res = { ...refused, failure: { reason: 'noAck' as const, ackTimeoutSeconds: 10 } }
    setLocale('en')
    expect(subscriptionFailureText(res, 'f')).toContain('no connection_ack within 10 s')
  })

  it('a failure without a named reason is the ordinary connection error', () => {
    setLocale('en')
    const res = { error: 'x', errorInfo: { kind: 'refused', target: 'a:1', message: 'm' } }
    expect(subscriptionFailureText(res, 'f')).toContain('Connection refused')
    expect(subscriptionFailureText({ error: 'plain' }, 'f')).toBe('plain')
    expect(subscriptionFailureText(null, 'fallback')).toBe('fallback')
  })

  it('says why a subscription ended', () => {
    setLocale('en')
    expect(subscriptionEndText({ kind: 'completed' })).toMatch(/completed/)
    expect(subscriptionEndText({ kind: 'closed', code: 4401 })).toContain('4401: Unauthorized')
    expect(subscriptionEndText({ kind: 'closed', code: 1011, reason: 'boom' })).toContain(
      '1011: boom',
    )
    setLocale('tr')
    expect(subscriptionEndText({ kind: 'unsubscribed' })).toBe('Abonelik bitirildi.')
  })
})
