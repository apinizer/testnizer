import { expect } from '@playwright/test'
import { uiTest } from './_setup'
import { dismissOverlays, navigateSidebar } from '../helpers/ui/bootstrap'
import { createMockServer, randomMockPort } from '../helpers/ui/mock-flow'

uiTest.describe('Mock servers (deep)', () => {
  uiTest.beforeEach(async ({ window }) => {
    await dismissOverlays(window)
    await navigateSidebar(window, 'mocks')
  })

  uiTest('create mock server', async ({ window }) => {
    // Unified "New mock server" dialog (issue #140): header "+" → HTTP · Blank.
    // By testid: with no server yet the Mocks page centre has a second
    // "New mock server" button (empty state, issue #226).
    await window.getByTestId('mock-new').click()
    // The header "+" opens a type menu (HTTP / MCP / SSE / AI) first.
    await window.getByTestId('mock-new-option-http').click()
    await expect(window.getByTestId('mock-new-dialog')).toBeVisible({ timeout: 10_000 })
    await expect(window.getByTestId('mock-new-type-http')).toHaveAttribute('aria-checked', 'true')
    await window.getByTestId('mock-new-name').fill('E2E Mock')
    await window.getByTestId('mock-new-create').click()
    await expect(window.getByTestId('mock-new-dialog')).toBeHidden({ timeout: 10_000 })
    await expect(window.getByText('E2E Mock').first()).toBeVisible({ timeout: 10_000 })
  })

  uiTest('group "+" preselects the type; a preset fills the name', async ({ window }) => {
    await window.getByTestId('mock-group-add-mcp').click()
    await expect(window.getByTestId('mock-new-type-mcp')).toHaveAttribute('aria-checked', 'true')
    await expect(window.getByTestId('mock-new-preset-echo')).toHaveAttribute('aria-checked', 'true')
    await window.getByTestId('mock-new-type-http').click()
    await window.getByTestId('mock-new-preset-rest').click()
    await expect(window.getByTestId('mock-new-name')).toHaveValue(/^Users API/)
    await window.keyboard.press('Escape')
    await expect(window.getByTestId('mock-new-dialog')).toBeHidden({ timeout: 10_000 })
  })

  uiTest('mock server editor tabs', async ({ window }) => {
    // Own server (not whatever an earlier test left behind), so the editor is
    // guaranteed to be open and a missing tab strip fails the test.
    await createMockServer(window, `E2E Tabs Mock ${Date.now()}`, randomMockPort())
    for (const tab of ['endpoints', 'settings', 'logs']) {
      const btn = window.getByTestId(`mock-tab-${tab}`)
      await expect(btn).toBeVisible({ timeout: 10_000 })
      await btn.click()
      await expect(btn).toHaveAttribute('aria-selected', 'true')
    }
  })
})
