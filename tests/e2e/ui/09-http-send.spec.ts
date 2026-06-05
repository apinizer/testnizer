import { expect } from '@playwright/test'
import { uiTest } from './_setup'
import { dismissOverlays, navigateSidebar, openHttpRequestTab } from '../helpers/ui/bootstrap'
import { localHttpBin } from '../helpers/test-servers'

uiTest.describe('HTTP send via UI', () => {
  uiTest.beforeEach(async ({ window }) => {
    await dismissOverlays(window)
    await navigateSidebar(window, 'apis')
    await openHttpRequestTab(window)
    await expect(window.getByTestId('send-btn')).toBeVisible({ timeout: 10_000 })
  })

  uiTest('sends GET request and shows response', async ({ window }) => {
    const urlInput = window.locator('input[placeholder*="URL"], input[placeholder*="url"]')
    await urlInput.fill(`${localHttpBin()}/get?e2e=1`)
    await window.getByTestId('send-btn').click()

    await expect(window.getByText(/200|OK/i).first()).toBeVisible({ timeout: 30_000 })
  })
})
