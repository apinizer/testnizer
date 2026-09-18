/**
 * Issue #124 — SOAP Manual mode: endpoint URL, operation name/namespace, body,
 * SOAPAction and version must survive Save → close → reopen from the tree.
 *
 * Drives the real editor: New → SOAP → Manual, fill every field, Generate
 * Envelope, Save to tree, close all tabs, reopen from the APIs tree and assert
 * the Manual form shows the saved values (not blanks / sample defaults) and
 * the Body tab holds the generated envelope.
 */
import { expect } from '@playwright/test'
import { uiTest } from './_setup'
import { closeAllTabs, dismissOverlays, openNewDropdownItem } from '../../helpers/ui/bootstrap'
import { pressModShortcut } from '../../helpers/ui/keyboard'
import { treeClearSearch, treeOpenNode } from '../../helpers/ui/tree'

const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`

async function readSoapBodyMonaco(page: import('@playwright/test').Page): Promise<string> {
  return page
    .locator('.monaco-editor .view-lines')
    .first()
    .innerText()
    .catch(() => '')
}

uiTest.describe('Tur1 — SOAP manual save/reopen [issue #124]', () => {
  uiTest('manual fields are restored after Save → close → reopen', async ({ window }) => {
    await dismissOverlays(window)
    await closeAllTabs(window)

    const name = `soap-manual-${uid()}`
    const url = 'https://svc.example.test/EchoService'
    const action = 'urn:EchoString'
    const opName = 'EchoString'
    const opNs = 'http://svc.example.test/echo'

    await openNewDropdownItem(window, /SOAP/i)
    await window.getByRole('button', { name: /^Manual$/i }).click()

    await window.getByTestId('soap-manual-url').fill(url)
    const versionSelect = window.locator('select').filter({ hasText: /SOAP 1\.1/i }).first()
    await versionSelect.selectOption('soap12')
    await window.getByPlaceholder(/urn:Echo/i).fill(action)
    await window.getByPlaceholder(/^Echo$/).fill(opName)
    await window.getByPlaceholder('http://example.com/echo').fill(opNs)
    await window.getByRole('button', { name: /Generate Envelope/i }).click()
    await expect
      .poll(() => readSoapBodyMonaco(window), { timeout: 15_000 })
      .toMatch(/tns:EchoString/)

    // The SOAP editor has no URL-bar Save button; Ctrl/Cmd+S on a fresh tab
    // routes to the Save As modal (same helper the HTTP path uses).
    await window.locator('.monaco-editor').first().click().catch(() => {})
    await pressModShortcut(window, 's')
    const modal = window.getByTestId('endpoint-save-modal')
    await expect(modal).toBeVisible({ timeout: 8_000 })
    await modal.locator('input').first().fill(name)
    await modal.getByRole('button', { name: /Save|Update/i }).click()
    await expect(modal).toBeHidden({ timeout: 20_000 })

    // Reopen from the tree in a fresh tab.
    await closeAllTabs(window)
    await treeOpenNode(window, name)
    try {
      // Lands on the Manual form (mode is persisted), not WSDL Import.
      await expect(window.getByTestId('soap-manual-url')).toBeVisible({ timeout: 10_000 })
      await expect(window.getByTestId('soap-manual-url')).toHaveValue(url)
      await expect(window.getByPlaceholder(/urn:Echo/i)).toHaveValue(action)
      await expect(window.getByPlaceholder(/^Echo$/)).toHaveValue(opName)
      await expect(window.getByPlaceholder('http://example.com/echo')).toHaveValue(opNs)
      await expect(window.locator('select').filter({ hasText: /SOAP 1\.1/i }).first()).toHaveValue(
        'soap12',
      )
      await expect
        .poll(() => readSoapBodyMonaco(window), { timeout: 15_000 })
        .toMatch(/tns:EchoString/)
    } finally {
      await treeClearSearch(window)
    }
  })
})
