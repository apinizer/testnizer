import { expect } from '@playwright/test'
import { uiTest } from './_setup'
import { dismissOverlays, navigateSidebar } from '../helpers/ui/bootstrap'
import { TOOL_NAMES } from '../helpers/ui/inventory'

uiTest.describe('Tools functional (deep)', () => {
  for (const toolName of TOOL_NAMES) {
    uiTest(`${toolName} opens workbench editor`, async ({ window }) => {
      await dismissOverlays(window)
      await navigateSidebar(window, 'tools')
      await window.getByText(toolName, { exact: false }).click()
      await expect(window.getByTestId('workbench')).toBeVisible()
      await expect(window.locator('button').first()).toBeVisible()
    })
  }

  uiTest('JWT decode shows payload', async ({ window }) => {
    await dismissOverlays(window)
    await navigateSidebar(window, 'tools')
    await window.getByText('JWT Debugger', { exact: false }).click()
    const token = 'eyJhbGciOiJub25lIn0.eyJzdWIiOiJlMmUifQ.'
    const monaco = window.locator('.monaco-editor').first()
    await monaco.click()
    const mod = process.platform === 'darwin' ? 'Meta' : 'Control'
    await window.keyboard.press(`${mod}+KeyA`)
    await window.keyboard.insertText(token)
    await expect(window.getByText(/e2e|sub/i).first()).toBeVisible({ timeout: 8_000 })
  })

  uiTest('Hash calculator shows digests', async ({ window }) => {
    await dismissOverlays(window)
    await navigateSidebar(window, 'tools')
    await window.getByText('Hash Calculator', { exact: false }).click()
    const monaco = window.locator('.monaco-editor').first()
    await monaco.click()
    await window.keyboard.insertText('hello')
    await expect(window.getByText(/SHA-256|MD5/i).first()).toBeVisible({ timeout: 8_000 })
  })

  uiTest('UUID generator produces UUIDs', async ({ window }) => {
    await dismissOverlays(window)
    await navigateSidebar(window, 'tools')
    await window.getByText('UUID Generator', { exact: false }).click()
    await window.getByRole('button', { name: /Generate/i }).click()
    await expect(window.getByText(/[0-9a-f]{8}-[0-9a-f]{4}/i).first()).toBeVisible({ timeout: 5_000 })
  })

  uiTest('HTTP Status Codes search filters', async ({ window }) => {
    await dismissOverlays(window)
    await navigateSidebar(window, 'tools')
    await window.getByText('HTTP Status Codes', { exact: false }).click()
    await window.locator('input[type="text"]').first().fill('404')
    await expect(window.getByText(/404|Not Found/i).first()).toBeVisible()
  })
})
