/**
 * MST-306 P0  Auth UI types (apiKey / digest / oauth2 / wsse) render their
 *             type-specific fields and survive a save → close → reopen round-trip.
 * MST-307 P1  Basic auth password eye toggle flips input type password↔text.
 *
 * basic / bearer / noAuth / ntlm are already covered by
 * tests/e2e/ui/14-request-auth-body.spec.ts — not repeated here.
 *
 * Hooks added to AuthTab.tsx (data-testid only, no behaviour change):
 *   auth-digest-user, auth-digest-pass, auth-oauth2-grant,
 *   auth-wsse-section, auth-password-toggle (on the Basic password toggle).
 */
import { expect } from '@playwright/test'
import { uiTest } from './_setup'
import {
  dismissOverlays,
  ensureCanonicalProject,
  navigateSidebar,
  openHttpRequestTab,
  openNewDropdownItem,
} from '../../helpers/ui/bootstrap'
import { saveRequestToTree, fillUrl } from '../../helpers/ui/request-flow'
import { expectAuthTypeActive } from '../../helpers/ui/assertions'
import { treeOpenNode } from '../../helpers/ui/tree'
import { localHttpBin } from '../../helpers/test-servers'

const http = () => localHttpBin()
const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`

uiTest.describe('Tur1 — Auth UI types [MST-306, MST-307]', () => {
  uiTest.beforeEach(async ({ window }) => {
    await dismissOverlays(window)
    await ensureCanonicalProject(window)
    await navigateSidebar(window, 'apis')
  })

  /**
   * MST-306 — UI-selectable auth types render their own fields and persist.
   *   1. HTTP tab → cycle apiKey / digest / oauth2, asserting one type-specific
   *      field for each renders after the pill is activated.
   *   2. Fill the apiKey fields, save to the tree, close the tab, reopen from
   *      the tree → auth type + the field value are preserved.
   *   3. wsse is SOAP-only — a separate SOAP tab proves the pill + section show.
   */
  uiTest('MST-306 apiKey/digest/oauth2 render fields and apiKey survives save/reopen', async ({ window }) => {
    const name = `AuthTypes ${uid()}`
    const apiKeyName = `X-Api-${uid()}`
    const apiKeyValue = `val-${uid()}`

    await openHttpRequestTab(window)
    await fillUrl(window, `${http()}/get`)
    await window.getByTestId('req-tab-auth').click()

    // apiKey — Key/Value inputs render.
    await window.getByTestId('auth-type-apiKey').click()
    await expectAuthTypeActive(window.getByTestId('auth-type-apiKey'))
    await expect(window.getByTestId('auth-apikey-key')).toBeVisible()
    await expect(window.getByTestId('auth-apikey-value')).toBeVisible()

    // digest — username/password inputs render.
    await window.getByTestId('auth-type-digest').click()
    await expectAuthTypeActive(window.getByTestId('auth-type-digest'))
    await expect(window.getByTestId('auth-digest-user')).toBeVisible()
    await expect(window.getByTestId('auth-digest-pass')).toBeVisible()

    // oauth2 — grant-type select renders.
    await window.getByTestId('auth-type-oauth2').click()
    await expectAuthTypeActive(window.getByTestId('auth-type-oauth2'))
    await expect(window.getByTestId('auth-oauth2-grant')).toBeVisible()

    // Back to apiKey, fill both fields, save to the tree.
    await window.getByTestId('auth-type-apiKey').click()
    await window.getByTestId('auth-apikey-key').fill(apiKeyName)
    await window.getByTestId('auth-apikey-value').fill(apiKeyValue)
    await saveRequestToTree(window, name)

    // Close the active tab, reopen from the tree.
    const activeTab = window.locator('[data-testid="endpoint-tab"][data-active="true"]')
    await activeTab.hover()
    await activeTab.getByTestId('tab-close').click()
    await expect(window.getByTestId('endpoint-tab').filter({ hasText: name })).toHaveCount(0, {
      timeout: 8_000,
    })

    await treeOpenNode(window, name)
    await window.getByTestId('req-tab-auth').click()
    await expectAuthTypeActive(window.getByTestId('auth-type-apiKey'))
    await expect(window.getByTestId('auth-apikey-key')).toHaveValue(apiKeyName, { timeout: 8_000 })
    await expect(window.getByTestId('auth-apikey-value')).toHaveValue(apiKeyValue)
  })

  /**
   * MST-306 (wsse arm) — WS-Security is SOAP-only; the pill is hidden on HTTP
   * tabs and visible/selectable on a SOAP tab, where it renders its section.
   */
  uiTest('MST-306 wsse auth type is SOAP-only and renders its section', async ({ window }) => {
    // HTTP tab: wsse pill must NOT be present (soapOnly filter).
    await openHttpRequestTab(window)
    await window.getByTestId('req-tab-auth').click()
    await expect(window.getByTestId('auth-type-wsse')).toHaveCount(0)

    // SOAP tab: open, switch to its Auth detail tab, pick WS-Security.
    await openNewDropdownItem(window, /^SOAP$/i)
    const soapEditor = window.locator('[data-testid="endpoint-tab"][data-active="true"]')
    await expect(soapEditor).toBeVisible({ timeout: 15_000 })
    await window.getByRole('button', { name: 'Auth', exact: true }).click()
    await window.getByTestId('auth-type-wsse').click()
    await expectAuthTypeActive(window.getByTestId('auth-type-wsse'))
    await expect(window.getByTestId('auth-wsse-section')).toBeVisible({ timeout: 8_000 })
    await expect(window.getByText(/Enable WS-Security/i)).toBeVisible()
  })

  /**
   * MST-307 — Basic auth password eye toggle.
   * Field starts masked (type=password); the toggle flips it to text and back.
   */
  uiTest('MST-307 basic auth password eye toggle flips input type', async ({ window }) => {
    await openHttpRequestTab(window)
    await window.getByTestId('req-tab-auth').click()
    await window.getByTestId('auth-type-basic').click()

    const pass = window.getByTestId('auth-basic-pass')
    const toggle = window.getByTestId('auth-password-toggle')
    await pass.fill('s3cr3t')

    await expect(pass).toHaveAttribute('type', 'password')
    await toggle.click()
    await expect(pass).toHaveAttribute('type', 'text')
    await toggle.click()
    await expect(pass).toHaveAttribute('type', 'password')
    // Value is preserved across toggles.
    await expect(pass).toHaveValue('s3cr3t')
  })
})
