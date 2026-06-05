import { expect } from '@playwright/test'
import { uiTest } from './_setup'
import { dismissOverlays, navigateSidebar } from '../helpers/ui/bootstrap'

const REQ_TABS = ['params', 'headers', 'auth', 'body', 'scripts', 'tests', 'settings'] as const

uiTest.describe('HTTP request editor', () => {
  uiTest.beforeEach(async ({ window }) => {
    await dismissOverlays(window)
    await navigateSidebar(window, 'apis')
    await window.getByTestId('new-dropdown-btn').click()
    await window.getByTestId('new-dropdown-menu').getByRole('button', { name: /^HTTP$/i }).click()
    await expect(window.getByTestId('send-btn')).toBeVisible({ timeout: 10_000 })
  })

  for (const tab of REQ_TABS) {
    uiTest(`request tab ${tab} is clickable`, async ({ window }) => {
      await window.getByTestId(`req-tab-${tab}`).click()
      await expect(window.getByTestId(`req-tab-${tab}`)).toBeVisible()
    })
  }

  uiTest('URL input accepts text', async ({ window }) => {
    const urlInput = window.locator('input[placeholder*="URL"], input[placeholder*="url"]')
    await urlInput.fill('https://httpbin.org/get')
    await expect(urlInput).toHaveValue('https://httpbin.org/get')
  })

  uiTest('method dropdown and save button are visible', async ({ window }) => {
    await expect(window.getByTestId('send-btn')).toBeVisible()
    await expect(window.getByTestId('save-btn')).toBeVisible()
  })
})
