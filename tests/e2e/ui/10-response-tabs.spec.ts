import { expect } from '@playwright/test'
import { uiTest } from './_setup'
import { dismissOverlays, navigateSidebar, openHttpRequestTab } from '../helpers/ui/bootstrap'
import { RESPONSE_TABS } from '../helpers/ui/inventory'
import { localHttpBin } from '../helpers/test-servers'

uiTest.describe('Response pane tabs', () => {
  uiTest.beforeEach(async ({ window }) => {
    await dismissOverlays(window)
    await navigateSidebar(window, 'apis')
    await openHttpRequestTab(window)
    const urlInput = window.locator('input[placeholder*="URL"], input[placeholder*="url"]')
    await urlInput.fill(`${localHttpBin()}/get?tabs=e2e`)
    await window.getByTestId('send-btn').click()
    await expect(window.getByText(/200|OK/i).first()).toBeVisible({ timeout: 30_000 })
  })

  for (const tab of RESPONSE_TABS) {
    uiTest(`response tab ${tab} is clickable`, async ({ window }) => {
      const tabBtn = window.getByTestId(`res-tab-${tab}`)
      await expect(tabBtn).toBeVisible()
      await tabBtn.click()
      await expect(tabBtn).toHaveCSS('font-weight', '600')
    })
  }
})
