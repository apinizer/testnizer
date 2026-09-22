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
import { pressModShortcut } from '../../helpers/ui/keyboard'
import { treeClearSearch, treeSearch } from '../../helpers/ui/tree'
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
    const name = `badge-${Date.now()}`
    await saveRequestToTree(window, name)
    await expect(activeTab(window)).toContainText('POST')
  })

  uiTest('Cmd/Ctrl+S on a saved request updates the TREE method badge', async ({ window }) => {
    // User report: change GET→POST on a collection request, press Ctrl+S, the
    // URL bar shows POST but the APIs tree still shows GET. The Save button
    // next to Send refreshed the tree; the shortcut did not.
    await dismissOverlays(window)
    await ensureCanonicalProject(window)
    await closeAllTabs(window)
    await navigateSidebar(window, 'apis')

    const name = `ctrls-${Date.now()}`
    await openHttpRequestTab(window)
    await fillUrl(window, `${localHttpBin()}/get`)
    await saveRequestToTree(window, name)
    try {
      await treeSearch(window, name)
      const node = window.getByTestId('tree-node').filter({ hasText: name }).first()
      await expect(node).toContainText('GET')

      await setHttpMethod(window, 'PUT')
      await expect(activeTab(window)).toHaveAttribute('data-dirty', 'true')
      await pressModShortcut(window, 's')
      await expect(activeTab(window)).toHaveAttribute('data-dirty', 'false', { timeout: 10_000 })
      await expect(window.getByTestId('endpoint-save-modal')).toHaveCount(0)
      await expect(node).toContainText('PUT', { timeout: 10_000 })
      await expect(activeTab(window)).toContainText('PUT')
    } finally {
      await treeClearSearch(window)
    }
  })
})
