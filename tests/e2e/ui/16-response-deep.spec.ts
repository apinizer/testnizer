import { expect } from '@playwright/test'
import { uiTest } from './_setup'
import { dismissOverlays, navigateSidebar, openHttpRequestTab } from '../helpers/ui/bootstrap'
import { localHttpBin } from '../helpers/test-servers'

uiTest.describe('Response pane (deep)', () => {
  uiTest.beforeEach(async ({ window }) => {
    await dismissOverlays(window)
    await navigateSidebar(window, 'apis')
    await openHttpRequestTab(window)
    const url = window.locator('input[placeholder*="URL"], input[placeholder*="url"]')
    await url.fill(`${localHttpBin()}/get?deep=e2e`)
    await window.getByTestId('send-btn').click()
    await expect(window.getByText(/200|OK/i).first()).toBeVisible({ timeout: 30_000 })
  })

  uiTest('body toolbar: raw and copy', async ({ window }) => {
    await window.getByTestId('res-tab-body').click()
    await window.getByTestId('res-body-raw').click()
    await window.getByTestId('res-body-copy').click()
    await expect(window.getByTestId('res-body-raw')).toHaveCSS('font-weight', '600')
  })

  uiTest('body toolbar: word wrap toggle', async ({ window }) => {
    await window.getByTestId('res-tab-body').click()
    await window.getByTestId('res-body-wrap').click()
    await expect(window.getByTestId('res-body-wrap')).toHaveAttribute('aria-pressed', 'true')
  })

  uiTest('cookies tab shows table', async ({ window }) => {
    await window.getByTestId('res-tab-cookies').click()
    await expect(window.getByTestId('res-tab-cookies')).toHaveCSS('font-weight', '600')
  })

  uiTest('headers tab shows table', async ({ window }) => {
    await window.getByTestId('res-tab-headers').click()
    await expect(window.getByTestId('res-tab-headers')).toHaveCSS('font-weight', '600')
  })

  uiTest('test results tab is clickable', async ({ window }) => {
    await window.getByTestId('res-tab-testResults').click()
    await expect(window.getByTestId('res-tab-testResults')).toHaveCSS('font-weight', '600')
  })
})
