/**
 * Issue #122 — the tab strip's method badge follows the method dropdown
 * before Save, stays per tab across switches, and survives Save.
 */
import { expect } from '@playwright/test'
import { uiTest } from './_setup'
import {
  closeAllTabs,
  dismissOverlays,
  ensureCanonicalProject,
  navigateSidebar,
  openHttpRequestTab,
} from '../../helpers/ui/bootstrap'
import { fillUrl, saveRequestToTree, setHttpMethod } from '../../helpers/ui/request-flow'
import { localHttpBin } from '../../helpers/test-servers'

const activeTab = (page: import('@playwright/test').Page) =>
  page.locator('[data-testid="endpoint-tab"][data-active="true"]')

uiTest.describe('Tur1 — tab method badge [issue #122]', () => {
  uiTest('badge updates immediately, per tab, and after Save', async ({ window }) => {
    await dismissOverlays(window)
    await ensureCanonicalProject(window)
    await closeAllTabs(window)
    // The New (+) dropdown lives in the APIs panel; a suite spec before us may
    // have left the sidebar on Tests (shared Electron, no global reset).
    await navigateSidebar(window, 'apis')

    await openHttpRequestTab(window)
    await fillUrl(window, `${localHttpBin()}/post`)
    await expect(activeTab(window)).toContainText('GET')
    await setHttpMethod(window, 'POST')
    await expect(activeTab(window)).toContainText('POST')
    await expect(activeTab(window)).toHaveAttribute('data-dirty', 'true')

    // Second tab stays GET; switching back keeps POST on the first.
    await navigateSidebar(window, 'apis')
    await openHttpRequestTab(window)
    await expect(activeTab(window)).toContainText('GET')
    const tabs = window.getByTestId('endpoint-tab')
    await tabs.first().click()
    await expect(activeTab(window)).toContainText('POST')
    await tabs.nth(1).click()
    await expect(activeTab(window)).toContainText('GET')

    // Save keeps the live method on the badge.
    await tabs.first().click()
    await saveRequestToTree(window, `badge-${Date.now()}`)
    await expect(activeTab(window)).toContainText('POST')
  })
})
