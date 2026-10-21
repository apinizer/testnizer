/**
 * Issue #240 — the login screen's branding copy was hard-coded English and
 * partly false: "stored locally in an encrypted database" (the database is not
 * encrypted; the app password is a login gate) and "Nothing is ever sent
 * externally" (requests and AI Chat go to the servers the user picks; the update
 * check goes to GitHub). The copy now lives in i18n EN + TR and says what is
 * true, matching docs/legal/privacy-policy.md.
 *
 * The feature keys are read through a variable (`t(feat.label)`), which the
 * key-coverage test cannot see, so each key is asserted here explicitly.
 */
import * as React from 'react'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import LoginScreen from '../../src/renderer/components/auth/LoginScreen'
import { SECURITY_FEATURES } from '../../src/renderer/components/auth/login-copy'
import { useAuthStore } from '../../src/renderer/stores/auth.store'
import { useUIStore } from '../../src/renderer/stores/ui.store'
import { setLocale, t } from '../../src/renderer/lib/i18n'
;(globalThis as unknown as { React: typeof React }).React = React

const COPY_KEYS = [
  'login.tagline',
  'login.privacyNote',
  'login.or',
  'login.welcomeTitle',
  'login.welcomeDesc',
  'login.setPasswordOption',
  'login.setPasswordOptionDesc',
  'login.continueAnonymous',
  'login.continueAnonymousDesc',
  'login.setLaterHint',
  'login.ruleLength',
  'login.ruleLetter',
  'login.ruleNumber',
  'login.confirmPlaceholder',
  'profile.newPasswordPlaceholder',
  ...SECURITY_FEATURES.flatMap((f) => [f.label, f.desc]),
]

/** Claims the product cannot make (privacy policy §1, §3, §5). */
const FALSE_CLAIMS = [
  /encrypt/i,
  /never leaves/i,
  /ever sent externally/i,
  /zero data/i,
  /şifrelenmiş/i,
  /hiçbir zaman.*dışarı/i,
]

/** Components read the locale from the UI store; `t()` from the module. */
function switchLocale(locale: 'en' | 'tr'): void {
  setLocale(locale)
  useUIStore.setState({ locale })
}

afterEach(() => {
  cleanup()
  switchLocale('en')
})

describe('login copy keys', () => {
  it('lists four branding features', () => {
    expect(SECURITY_FEATURES).toHaveLength(4)
  })

  for (const locale of ['en', 'tr'] as const) {
    it(`resolves every key in ${locale.toUpperCase()}`, () => {
      setLocale(locale)
      const missing = COPY_KEYS.filter((k) => t(k) === k || !t(k).trim())
      expect(missing).toEqual([])
    })

    it(`makes no false privacy claim in ${locale.toUpperCase()}`, () => {
      setLocale(locale)
      for (const k of COPY_KEYS) {
        for (const re of FALSE_CLAIMS) expect(t(k), `${k}: ${t(k)}`).not.toMatch(re)
      }
    })
  }

  it('TR differs from EN for the sentences (really translated)', () => {
    const en = COPY_KEYS.map((k) => {
      setLocale('en')
      return t(k)
    })
    setLocale('tr')
    const same = COPY_KEYS.filter((k, i) => t(k) === en[i] && en[i].length > 3)
    expect(same).toEqual([])
  })
})

describe('LoginScreen renders the localized copy', () => {
  beforeEach(() => {
    ;(window as unknown as { api?: unknown }).api = {
      auth: { hasPassword: async () => ({ success: true, data: { hasPassword: false } }) },
    }
    useAuthStore.setState({ hasPasswordSet: false, isAuthenticated: false, error: null })
  })

  it('EN: privacy note says what is true; features come from i18n', async () => {
    switchLocale('en')
    render(<LoginScreen />)
    expect(screen.getByTestId('login-privacy-note').textContent).toBe(t('login.privacyNote'))
    const features = screen.getAllByTestId('login-feature').map((n) => n.textContent)
    expect(features[3]).toContain('Nothing is sent to us')
    expect(document.body.textContent).not.toMatch(/encrypted database/i)
    // e2e matches these by text — EN wording kept.
    expect(await screen.findByText('Continue Anonymous')).toBeTruthy()
  })

  it('with no password set (e.g. after a disable) the launch gate shows no password field', async () => {
    render(<LoginScreen />)
    expect(await screen.findByTestId('login-continue-anonymous')).toBeTruthy()
    expect(document.querySelector('input[type="password"]')).toBeNull()
  })

  it('TR: the branding panel and welcome step are Turkish', async () => {
    switchLocale('tr')
    render(<LoginScreen />)
    expect(screen.getByTestId('login-privacy-note').textContent).toBe(
      'Projeleriniz, koleksiyonlarınız ve geçmişiniz bu bilgisayarda kalır. Testnizer bize hiçbir şey göndermez.',
    )
    expect(screen.getByText('Bize hiçbir şey gönderilmez')).toBeTruthy()
    expect(await screen.findByText('Şifresiz Devam Et')).toBeTruthy()
  })
})
