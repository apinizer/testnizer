import { expect } from '@playwright/test'
import { uiTest } from './_setup'
import { dismissOverlays, navigateSidebar } from '../helpers/ui/bootstrap'
import { pressModShortcut } from '../helpers/ui/keyboard'

uiTest.describe('Header & navigation (deep)', () => {
  uiTest.beforeEach(async ({ window }) => {
    await dismissOverlays(window)
  })

  uiTest('header home navigates to project hub', async ({ window }) => {
    await window.getByTestId('header-home').click()
    await expect(window.getByTestId('project-home')).toBeVisible({ timeout: 10_000 })
    await window.getByTestId('project-card').filter({ hasText: /E2E Test Project/i }).first().click()
    await expect(window.getByTestId('nav-apis')).toBeVisible({ timeout: 15_000 })
  })

  uiTest('branch dropdown opens', async ({ window }) => {
    await window.getByTestId('branch-pill').click()
    await expect(window.getByTestId('branch-new')).toBeVisible()
    await window.keyboard.press('Escape')
  })

  uiTest('workbench tab close via context', async ({ window }) => {
    await navigateSidebar(window, 'apis')
    await pressModShortcut(window, 't')
    const tabs = window.locator('[data-testid="endpoint-tab"]')
    const before = await tabs.count()
    expect(before).toBeGreaterThan(0)
    await tabs.first().click({ button: 'right' })
    await window.locator('[data-context-menu]').getByRole('button', { name: /Close Tab/i }).click()
  })

  uiTest('environment selector in workbench', async ({ window }) => {
    await navigateSidebar(window, 'apis')
    const envBtn = window.getByRole('button', { name: /environment|No environment/i }).first()
    if (await envBtn.isVisible()) {
      await envBtn.click()
      await expect(window.getByText(/Manage Environments/i)).toBeVisible()
      await window.keyboard.press('Escape')
    }
  })
})
