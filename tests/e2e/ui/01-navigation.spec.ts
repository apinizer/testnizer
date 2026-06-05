import { expect } from '@playwright/test'
import { uiTest } from './_setup'
import { dismissOverlays, navigateSidebar } from '../helpers/ui/bootstrap'

uiTest.describe('Navigation', () => {
  uiTest.beforeEach(async ({ window }) => {
    await dismissOverlays(window)
    await navigateSidebar(window, 'apis')
    await window.getByTestId('new-dropdown-btn').click()
    await window.getByTestId('new-dropdown-menu').getByRole('button', { name: /^HTTP$/i }).click()
    await expect(window.getByTestId('send-btn')).toBeVisible({ timeout: 10_000 })
  })

  for (const page of ['apis', 'tests', 'mocks', 'history', 'tools'] as const) {
    uiTest(`sidebar navigates to ${page}`, async ({ window }) => {
      await navigateSidebar(window, page)
      await expect(window.getByTestId(`nav-${page}`)).toBeVisible()
      // Active nav item gets accent background
      const nav = window.getByTestId(`nav-${page}`)
      await expect(nav).toBeVisible()
    })
  }

  uiTest('settings opens project detail modal', async ({ window }) => {
    await window.getByTestId('nav-settings').click()
    await expect(window.getByTestId('project-detail-modal')).toBeVisible()
    await window.keyboard.press('Escape')
  })

  uiTest('footer environment opens modal', async ({ window }) => {
    await window.getByTestId('footer-env').click()
    await expect(window.getByTestId('environment-modal')).toBeVisible()
    await window.keyboard.press('Escape')
  })

  uiTest('footer enterprise opens modal', async ({ window }) => {
    await window.getByTestId('footer-enterprise').click()
    await expect(window.getByTestId('enterprise-modal')).toBeVisible()
    await window.keyboard.press('Escape')
  })

  uiTest('footer console toggles panel', async ({ window }) => {
    await window.getByTestId('footer-console').click()
    await expect(window.getByTestId('console-panel')).toBeVisible()
    await window.getByTestId('footer-console').click()
  })

  uiTest('project hub shortcut returns home', async ({ window }) => {
    const mod = process.platform === 'darwin' ? 'Meta' : 'Control'
    await window.keyboard.press(`${mod}+KeyP`)
    await expect(window.getByTestId('project-home')).toBeVisible()
    // Re-open test project
    await window.getByTestId('project-card').filter({ hasText: /E2E Test Project/i }).first().click()
    await expect(window.getByTestId('workbench')).toBeVisible()
  })
})
