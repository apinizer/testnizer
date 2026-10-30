/**
 * Issue #253 — the EN `connError.*` i18n block is a hand-written mirror of
 * `CONNECTION_ERROR_TEXT_EN` (the i18n key-coverage test counts literal keys,
 * so it cannot be spread in). Main writes the English `error` string from the
 * shared table and the renderer from i18n: a wording change in one place only
 * would make the EN text the user sees differ from the string in History /
 * Console. This pins the two together for EVERY kind.
 */
import { afterEach, describe, expect, it } from 'vitest'
import {
  CONNECTION_ERROR_KINDS,
  connectionErrorEnglishKeys,
} from '../../src/shared/connection-error'
import { setLocale, t } from '../../src/renderer/lib/i18n'

afterEach(() => setLocale('en'))

describe('connError EN i18n = shared English table', () => {
  it('every what / hint key matches CONNECTION_ERROR_TEXT_EN', () => {
    setLocale('en')
    const expected = connectionErrorEnglishKeys()
    expect(Object.keys(expected).length).toBeGreaterThanOrEqual(CONNECTION_ERROR_KINDS.length)
    for (const [key, value] of Object.entries(expected)) {
      expect(t(key), key).toBe(value)
    }
  })

  it('no EN hint key exists for a kind the shared table gives none', () => {
    setLocale('en')
    const expected = connectionErrorEnglishKeys()
    for (const kind of CONNECTION_ERROR_KINDS) {
      const key = `connError.${kind}.hint`
      if (!(key in expected)) expect(t(key), key).toBe(key)
    }
  })
})
