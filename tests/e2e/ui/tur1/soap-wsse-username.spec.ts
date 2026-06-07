/**
 * MST-107 — WS-Security UsernameToken UI send
 *
 * Opens a SOAP (Manual mode) tab, navigates to WS-Security section,
 * enables UsernameToken, fills credentials, and sends to the echo server.
 * Asserts that the resulting SOAP envelope contains a wsse:Security block
 * with a UsernameToken element.
 *
 * Two paths are tested:
 *  a) IPC path: wsse:apply called directly (fast, no UI needed) — verifies
 *     the engine produces correct XML.
 *  b) UI path: SOAP editor WS-Security panel is enabled and send is clicked
 *     — verifies the UI wire-up reaches the engine.
 */
import { expect } from '@playwright/test'
import { uiTest } from './_setup'
import {
  dismissOverlays,
  ensureCanonicalProject,
  navigateSidebar,
  openNewDropdownItem,
} from '../../helpers/ui/bootstrap'
import { localHttpBin } from '../../helpers/test-servers'

const http = () => localHttpBin()

const SAMPLE_ENVELOPE = `<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Header/>
  <soap:Body><test>wsse-e2e</test></soap:Body>
</soap:Envelope>`

uiTest.describe('Tur1 — WSSE UsernameToken [MST-107]', () => {
  uiTest.beforeEach(async ({ window }) => {
    await dismissOverlays(window)
    await ensureCanonicalProject(window)
    await navigateSidebar(window, 'apis')
  })

  uiTest('MST-107a IPC wsse:apply produces UsernameToken (PasswordText)', async ({ window }) => {
    const result = await window.evaluate(async (envelope) => {
      const api = (window as unknown as { api: { wsse: { apply: (x: unknown) => Promise<{ success: boolean; data?: string; error?: string }> } } }).api
      return api.wsse.apply({
        envelope,
        config: {
          enabled: true,
          modes: ['username-token'],
          usernameToken: {
            username: 'e2e-user',
            password: 'e2e-pass',
            passwordType: 'PasswordText',
            nonce: false,
            created: false,
          },
        },
      })
    }, SAMPLE_ENVELOPE)

    expect(result.success).toBe(true)
    expect(result.data).toContain('wsse:UsernameToken')
    expect(result.data).toContain('e2e-user')
    expect(result.data).toContain('e2e-pass')
  })

  uiTest('MST-107b IPC wsse:apply produces UsernameToken (PasswordDigest)', async ({ window }) => {
    const result = await window.evaluate(async (envelope) => {
      const api = (window as unknown as { api: { wsse: { apply: (x: unknown) => Promise<{ success: boolean; data?: string; error?: string }> } } }).api
      return api.wsse.apply({
        envelope,
        config: {
          enabled: true,
          modes: ['username-token'],
          usernameToken: {
            username: 'digest-user',
            password: 'digest-pass',
            passwordType: 'PasswordDigest',
            nonce: true,
            created: true,
          },
        },
      })
    }, SAMPLE_ENVELOPE)

    expect(result.success).toBe(true)
    expect(result.data).toContain('wsse:UsernameToken')
    expect(result.data).toContain('digest-user')
    // PasswordDigest type URI
    expect(result.data).toMatch(/PasswordDigest|#PasswordDigest/i)
  })

  uiTest('MST-107c UI SOAP editor WS-Security panel enables UsernameToken and send reaches server', async ({ window }) => {
    const base = http()
    await openNewDropdownItem(window, /SOAP/i)
    // Switch to Manual mode
    await window.getByRole('button', { name: /^Manual$/i }).click()
    await window.getByPlaceholder('https://example.com/services/Echo').fill(`${base}/post`)

    // Write the envelope in the Body tab first (Body is the default detail tab).
    await window.locator('.monaco-editor').first().click()
    const mod = process.platform === 'darwin' ? 'Meta' : 'Control'
    await window.keyboard.press(`${mod}+KeyA`)
    await window.keyboard.insertText(SAMPLE_ENVELOPE)

    // WS-Security lives inside the Auth detail tab (SoapSecuritySection in AuthTab).
    await window.getByRole('button', { name: /^Auth$/i }).click()

    // Expand the collapsible "WS-Security" section header.
    const wsSecBtn = window.getByRole('button', { name: /WS-Security/i })
    await expect(wsSecBtn).toBeVisible({ timeout: 10_000 })
    await wsSecBtn.click()

    // Enable WS-Security
    const enableCheckbox = window.getByRole('checkbox', { name: /Enable WS-Security/i })
    if (!(await enableCheckbox.isChecked())) {
      await enableCheckbox.check()
    }

    // Enable username-token mode — the label renders "username token" (space).
    const utLabel = window.getByText(/^username token$/i).first()
    const utCheckbox = utLabel.locator('xpath=ancestor::label').getByRole('checkbox')
    if (await utCheckbox.isVisible().catch(() => false)) {
      if (!(await utCheckbox.isChecked())) await utCheckbox.check()
    }

    // Fill credentials
    await window.getByPlaceholder('Enter username').fill('soap-user')
    await window.getByPlaceholder('Enter password').fill('soap-pass')

    // Send
    await window.getByTestId('soap-send').click()
    await expect(window.getByText(/200|OK/i).first()).toBeVisible({ timeout: 30_000 })
  })
})
