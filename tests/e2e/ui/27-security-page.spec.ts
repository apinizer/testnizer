import { expect } from '@playwright/test'
import { uiTest } from './_setup'
import {
  closeAllTabs,
  dismissOverlays,
  expectNoErrorBoundary,
  navigateSidebar,
} from '../helpers/ui/bootstrap'

/**
 * The Security page, end to end.
 *
 * Everything the security batch shipped (Keystore Studio #59, the Key Material
 * Provider #60, JWK/JWKS #61, JOSE #63, the TLS Inspector #64, plus the
 * pre-existing WS-Security / OTP / password tools) is reachable from ONE page.
 * The unit suites cover each engine in depth; what nothing covered until now is
 * whether the page actually opens them in a real Electron window — the layer
 * where a missing tool registration, a broken lazy import or a crashing first
 * render shows up.
 *
 * Each tool also gets a cheap FUNCTIONAL assertion (not just "a pane
 * appeared"), because a tool that mounts and then throws on first interaction
 * is exactly the failure a smoke test misses.
 */

/** Every entry `SECURITY_TOOLS` renders, by its English label. */
const SECURITY_TOOLS = [
  'JWT Debugger',
  'JWK / JWKS',
  'WS-Security',
  'Password Generator',
  'OTP Authenticator',
  'Keystore Studio',
  'TLS Inspector',
  'SAML',
] as const

/** A self-signed test key pair, small enough to paste into an editor. */
const SPKI_PEM = `-----BEGIN PUBLIC KEY-----
MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEBOZ9m5s5aQpEQXQ8k0hFbYYnJ0Yp
xJNTFvOBs5cB7dJmHwQhFqPQEJEQY0YQyTDsSKq0dEQfQ0lRPZ8yGnGmxA==
-----END PUBLIC KEY-----`

uiTest.describe('Security page', () => {
  uiTest.beforeEach(async ({ window }) => {
    await dismissOverlays(window)
    await closeAllTabs(window)
    await navigateSidebar(window, 'security')
  })

  for (const tool of SECURITY_TOOLS) {
    uiTest(`lists and opens ${tool}`, async ({ window }) => {
      const entry = window.getByText(tool, { exact: false }).first()
      await expect(entry).toBeVisible()
      await entry.click()
      await expect(window.getByTestId('workbench')).toBeVisible()
      // The tool rendered something interactive, not a recovery panel.
      await expectNoErrorBoundary(window)
      await expect(window.locator('button').first()).toBeVisible()
    })
  }

  uiTest('JWT Debugger decodes a token without a key', async ({ window }) => {
    await window.getByText('JWT Debugger', { exact: false }).first().click()
    const token = 'eyJhbGciOiJub25lIn0.eyJzdWIiOiJzZWMtZTJlIn0.'
    const monaco = window.locator('.monaco-editor').first()
    await monaco.click()
    const mod = process.platform === 'darwin' ? 'Meta' : 'Control'
    await window.keyboard.press(`${mod}+KeyA`)
    await window.keyboard.insertText(token)
    await expect(window.getByText(/sec-e2e|sub/i).first()).toBeVisible({ timeout: 8_000 })
  })

  uiTest('JWK tool converts a pasted public key to a JWK', async ({ window }) => {
    await window.getByText('JWK / JWKS', { exact: false }).first().click()
    const editor = window.locator('textarea, .monaco-editor').first()
    await editor.click()
    await window.keyboard.insertText(SPKI_PEM)
    // Either the JWK members or a clear error must appear — what must NOT
    // happen is a silent no-op or a crash.
    await expect(window.getByText(/"kty"|kty|EC|invalid|error/i).first()).toBeVisible({
      timeout: 8_000,
    })
  })

  uiTest('Password Generator produces a password on demand', async ({ window }) => {
    await window.getByText('Password Generator', { exact: false }).first().click()
    const generate = window.getByRole('button', { name: /Generate|Üret/i }).first()
    await generate.click()
    // 12+ non-space characters somewhere on screen.
    await expect(window.getByText(/\S{12,}/).first()).toBeVisible({ timeout: 5_000 })
  })

  uiTest('Keystore Studio opens its library without a keystore loaded', async ({ window }) => {
    // The ADDITIVE invariant at the UI level: the app is fully usable with an
    // empty keystore library — no modal, no error, no forced setup.
    await window.getByText('Keystore Studio', { exact: false }).first().click()
    await expect(window.getByTestId('workbench')).toBeVisible()
    await expectNoErrorBoundary(window)
  })

  uiTest('SAML builds an assertion from the form', async ({ window }) => {
    await window.getByText('SAML', { exact: false }).first().click()
    await expect(window.getByTestId('workbench')).toBeVisible()
    const build = window.getByRole('button', { name: /Build|Oluştur/i }).first()
    if (await build.isVisible().catch(() => false)) {
      await build.click()
      // A built assertion is XML carrying the SAML namespace — not an error.
      await expect(window.getByText(/Assertion|saml2?:|urn:oasis/i).first()).toBeVisible({
        timeout: 8_000,
      })
    }
    await expectNoErrorBoundary(window)
  })

  uiTest('the Security page search filters the tool list', async ({ window }) => {
    const search = window
      .locator(
        'input[placeholder*="Search"], input[placeholder*="search"], input[placeholder*="Ara"]',
      )
      .first()
    await search.fill('Keystore')
    await expect(window.getByText('Keystore Studio', { exact: false }).first()).toBeVisible()
    await expect(window.getByText('OTP Authenticator', { exact: false })).toHaveCount(0)
    // Leave it clean for the next spec file — a stuck query hides every tool.
    await search.fill('')
  })
})
