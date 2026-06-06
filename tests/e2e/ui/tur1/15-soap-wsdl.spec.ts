/**
 * MST-106 — WSDL import → SOAP operation
 */
import { expect } from '@playwright/test'
import { uiTest } from './_setup'
import {
  dismissOverlays,
  ensureCanonicalProject,
  navigateSidebar,
  openNewDropdownItem,
} from '../../helpers/ui/bootstrap'
import { importFixtureViaIpc } from '../../helpers/ui/import-flow'
import { localHttpBin } from '../../helpers/test-servers'

const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`

uiTest.describe('Tur1 — SOAP WSDL [MST-106]', () => {
  uiTest.beforeEach(async ({ window }) => {
    await dismissOverlays(window)
    await ensureCanonicalProject(window)
    await navigateSidebar(window, 'apis')
  })

  uiTest('MST-106 WSDL import creates SOAP endpoints in tree', async ({ window }) => {
    const folder = `WSDL ${uid()}`
    await importFixtureViaIpc(window, 'wsdl', 'sample.wsdl', folder)
    await expect(window.getByTestId('tree-node').filter({ hasText: folder })).toBeVisible({ timeout: 20_000 })
    // sample.wsdl defines Calculator operations
    await expect
      .poll(async () => window.getByTestId('tree-node').filter({ hasText: /Add|Calculator|E2E/i }).count())
      .toBeGreaterThan(0)
  })

  uiTest('MST-106 manual SOAP envelope send returns 200', async ({ window }) => {
    const http = localHttpBin()
    await openNewDropdownItem(window, /SOAP/i)
    await window.getByRole('button', { name: /^Manual$/i }).click()
    await window.getByPlaceholder('https://example.com/services/Echo').fill(`${http}/post`)
    const envelope = `<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body><test>wsdl-e2e</test></soap:Body>
</soap:Envelope>`
    await window.locator('.monaco-editor').first().click()
    const mod = process.platform === 'darwin' ? 'Meta' : 'Control'
    await window.keyboard.press(`${mod}+KeyA`)
    await window.keyboard.insertText(envelope)
    await window.getByTestId('soap-send').click()
    await expect(window.getByText(/200|OK/i).first()).toBeVisible({ timeout: 30_000 })
  })
})
