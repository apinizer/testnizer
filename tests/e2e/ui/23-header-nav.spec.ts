import { expect } from '@playwright/test'
import { uiTest } from './_setup'
import { dismissOverlays, navigateSidebar, openHttpRequestTab } from '../helpers/ui/bootstrap'
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

  uiTest('workbench tab close via shortcut', async ({ window }) => {
    await navigateSidebar(window, 'apis')
    await openHttpRequestTab(window)
    const tabs = window.locator('[data-testid="endpoint-tab"]')
    const before = await tabs.count()
    expect(before).toBeGreaterThan(0)
    await tabs.first().click()
    await pressModShortcut(window, 'w')
    await expect(tabs).toHaveCount(before - 1, { timeout: 8_000 })
  })

  uiTest('environment selector in workbench', async ({ window }) => {
    await navigateSidebar(window, 'apis')
    await openHttpRequestTab(window)
    await window.getByTitle('Environment').first().click()
    await expect(window.getByText(/Manage Environments/i)).toBeVisible()
    await window.keyboard.press('Escape')
  })
})
