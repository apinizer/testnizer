import { expect } from '@playwright/test'
import { uiTest } from './_setup'
import { dismissOverlays, navigateSidebar } from '../helpers/ui/bootstrap'

uiTest.describe('Mock servers (deep)', () => {
  uiTest.beforeEach(async ({ window }) => {
    await dismissOverlays(window)
    await navigateSidebar(window, 'mocks')
  })

  uiTest('create mock server', async ({ window }) => {
    await window.getByRole('button', { name: /New|\+/i }).first().click()
    const nameInput = window.locator('input').filter({ hasNot: window.locator('[data-testid="tree-search"]') }).first()
    await nameInput.fill('E2E Mock')
    await window.getByRole('button', { name: /Create/i }).click()
    await expect(window.getByText('E2E Mock').first()).toBeVisible({ timeout: 10_000 })
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
