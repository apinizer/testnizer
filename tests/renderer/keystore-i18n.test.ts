/**
 * Keystore Studio i18n parity — every tools.keystore.* key must resolve (not
 * fall through to the raw key) in BOTH en and tr. There is no automated parity
 * check in i18n.ts itself, so this is the only guard.
 */
import { describe, it, expect, afterAll } from 'vitest'
import { t, setLocale, getLocale } from '../../src/renderer/lib/i18n'

const original = getLocale()
afterAll(() => setLocale(original))

const KEYS = [
  'title',
  'emptyState',
  'open',
  'createNew',
  'library',
  'libraryEmpty',
  'untitled',
  'close',
  'type',
  'aliasCount',
  'dirty',
  'password',
  'passwordHint',
  'optional',
  'cancel',
  'confirmOpen',
  'create',
  'createTitle',
  'openTitle',
  'saveToLibrary',
  'saveTitle',
  'name',
  'rememberPassword',
  'rememberHint',
  'save',
  'delete',
  'noAliases',
  'colAlias',
  'colType',
  'colAlgorithm',
  'colSubject',
  'colExpiry',
  'detail',
  'badgeKeypair',
  'badgeTrusted',
  'badgeCert',
  'badgeSecret',
  'expired',
  'daysAgoSuffix',
  'inPrefix',
  'daysSuffix',
  'noExpiry',
  'detailTitle',
  'chain',
  'leaf',
  'subject',
  'issuer',
  'serial',
  'version',
  'sigAlg',
  'publicKeyAlg',
  'keySize',
  'validFrom',
  'validTo',
  'sha1',
  'sha256',
  'san',
  'pem',
  'copy',
  'copied',
  'selfSigned',
  'bits',
  'error.open',
  'error.generic',
  'error.sessionNotFound',
].map((k) => `tools.keystore.${k}`)

describe('tools.keystore.* i18n', () => {
  for (const locale of ['en', 'tr'] as const) {
    it(`resolves every key in ${locale}`, () => {
      setLocale(locale)
      const missing = KEYS.filter((k) => t(k) === k)
      expect(missing).toEqual([])
    })
  }

  it('catalog label key resolves', () => {
    setLocale('en')
    expect(t('tools.keystore.title')).toBe('Keystore Studio')
  })
})
