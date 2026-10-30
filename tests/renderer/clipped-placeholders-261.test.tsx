/**
 * Issue #261 — placeholders clipped at 1024px / 16px in Turkish:
 * "Bearer token (isteğe bağlı)" (Socket.IO token) and "En az 8 karakter,
 * harf + rakam" (the report read "Min 8 characters, letter + r…": the TR
 * value, clipped — it is not English leaking through).
 *
 * CONTRACT: an input whose placeholder can be clipped carries a `title`
 * attribute equal to the full placeholder text (hover shows the rest), in
 * EVERY language. No length threshold: the placeholders stay as they are.
 *   - Socket.IO token:   `socketio-bearer-token`
 *   - Set password form: `password-set-new`
 *   - Change password:   `password-change-new`
 *   - LoginScreen: the two `profile.newPasswordPlaceholder` inputs
 *     (static check — the screen is too heavy to mount here).
 */
import * as React from 'react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import SocketIOEditor from '../../src/renderer/components/protocols/SocketIOEditor'
import SetPasswordForm from '../../src/renderer/components/auth/SetPasswordForm'
import { ChangePasswordForm } from '../../src/renderer/components/auth/AppPasswordForms'
import { t } from '../../src/renderer/lib/i18n'
import { useLocale } from './helpers/default-locale-shim'

afterEach(() => {
  cleanup()
  useLocale('en')
})

function mount(which: 'sio' | 'set' | 'change'): HTMLInputElement {
  if (which === 'sio') {
    render(<SocketIOEditor />)
    return screen.getByTestId('socketio-bearer-token') as HTMLInputElement
  }
  if (which === 'set') {
    render(<SetPasswordForm onCancel={() => {}} onDone={() => {}} />)
    return screen.getByTestId('password-set-new') as HTMLInputElement
  }
  render(<ChangePasswordForm />)
  return screen.getByTestId('password-change-new') as HTMLInputElement
}

const KEY = {
  sio: 'socketio.tokenPlaceholder',
  set: 'profile.newPasswordPlaceholder',
  change: 'profile.newPasswordPlaceholder',
} as const

describe.each(['sio', 'set', 'change'] as const)('%s', (which) => {
  it.each(['en', 'tr'] as const)('%s: title carries the full placeholder', (locale) => {
    useLocale(locale)
    const input = mount(which)
    const full = t(KEY[which])
    expect(input.getAttribute('placeholder')).toBe(full)
    expect(input.getAttribute('title')).toBe(full)
  })
})

describe('Turkish texts', () => {
  it('are the Turkish ones (not English)', () => {
    useLocale('tr')
    expect(mount('sio').getAttribute('title')).toBe('Bearer token (isteğe bağlı)')
    cleanup()
    expect(mount('set').getAttribute('title')).toBe('En az 8 karakter, harf + rakam')
    expect(document.body.textContent).not.toContain('Min 8 characters')
  })
})

describe('LoginScreen password inputs', () => {
  it('every newPasswordPlaceholder input has the matching title', () => {
    const src = readFileSync(
      resolve(__dirname, '../../src/renderer/components/auth/LoginScreen.tsx'),
      'utf8',
    )
    const uses = [...src.matchAll(/placeholder=\{t\('profile\.newPasswordPlaceholder'\)\}/g)]
    expect(uses.length).toBeGreaterThanOrEqual(2)
    for (const m of uses) {
      // The element's attributes: from the opening `<input` before the match.
      const start = src.lastIndexOf('<input', m.index)
      const end = src.indexOf('/>', m.index!)
      expect(src.slice(start, end)).toContain("title={t('profile.newPasswordPlaceholder')}")
    }
  })
})
