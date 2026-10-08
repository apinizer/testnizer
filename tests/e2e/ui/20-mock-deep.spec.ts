import { expect } from '@playwright/test'
import { uiTest } from './_setup'
import { dismissOverlays, navigateSidebar } from '../helpers/ui/bootstrap'

uiTest.describe('Mock servers (deep)', () => {
  uiTest.beforeEach(async ({ window }) => {
    await dismissOverlays(window)
    await navigateSidebar(window, 'mocks')
  })

  uiTest('create mock server', async ({ window }) => {
    // Unified "New mock server" dialog (issue #140): header "+" → HTTP · Blank.
    await window.getByRole('button', { name: 'New mock server' }).click()
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
    const row = window.getByText(/Mock|Server/i).first()
    if (await row.isVisible()) {
      await row.click()
      for (const tab of [/Endpoints/i, /Settings/i, /Logs/i]) {
        const btn = window.getByRole('button', { name: tab }).first()
        if (await btn.isVisible()) await btn.click()
      }
    }
  })
})
