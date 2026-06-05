import { expect } from '@playwright/test'
import { uiTest } from './_setup'
import { dismissOverlays } from '../helpers/ui/bootstrap'
import { PROJECT_DETAIL_TABS } from '../helpers/ui/inventory'

uiTest.describe('Project detail tabs', () => {
  uiTest.beforeEach(async ({ window }) => {
    await dismissOverlays(window)
    await window.getByTestId('nav-settings').click()
    await expect(window.getByTestId('project-detail-modal')).toBeVisible({ timeout: 8_000 })
  })

  for (const tabId of PROJECT_DETAIL_TABS) {
    uiTest(`project detail tab ${tabId} is clickable`, async ({ window }) => {
      const tabBtn = window.getByTestId(`project-detail-tab-${tabId}`)
      await expect(tabBtn).toBeVisible()
      await tabBtn.click()
      await expect(tabBtn).toHaveCSS('font-weight', '600')
    })
  }

  uiTest('closes with Escape', async ({ window }) => {
    await window.keyboard.press('Escape')
    await expect(window.getByTestId('project-detail-modal')).toBeHidden({ timeout: 5_000 })
  })
})
