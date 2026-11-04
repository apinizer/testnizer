/**
 * Issue #313 — closing a saved GraphQL tab took the renderer down: "Cannot read
 * properties of undefined (reading 'query')" in Generate Code, with the modal
 * never opened. A saved GraphQL request is saved through the real Ctrl+S path,
 * then closed with Cmd+W with an HTTP tab next to it, and as the last tab.
 */
import { expect } from '@playwright/test'
import { uiTest } from './_setup'
import {
  closeAllTabs,
  dismissOverlays,
  ensureCanonicalProject,
  expectNoErrorBoundary,
  navigateSidebar,
  openHttpRequestTab,
  openNewDropdownItem,
} from '../helpers/ui/bootstrap'
import { createFolder, getActiveProjectId, listSavedRequestsByProject } from '../helpers/ui/assert-ipc'
import { pressModShortcut } from '../helpers/ui/keyboard'
import { treeClearSearch, treeOpenNode } from '../helpers/ui/tree'

uiTest.describe('Issue #313 — Generate Code and a saved GraphQL tab', () => {
  uiTest.beforeEach(async ({ window }) => {
    await dismissOverlays(window)
    await ensureCanonicalProject(window)
    await navigateSidebar(window, 'apis')
  })

  uiTest('closing it never reaches the error screen', async ({ window }) => {
    const stamp = String(Date.now()).slice(-8)
    const folderName = `Gql313 ${stamp}`
    const name = `Gql saved ${stamp}`
    const projectId = await getActiveProjectId(window)
    const folderId = await createFolder(window, projectId, folderName)
    const tabs = window.getByTestId('endpoint-tab')

    try {
      await openNewDropdownItem(window, /GraphQL/i)
      await pressModShortcut(window, 's')
      const modal = window.getByTestId('endpoint-save-modal')
      await expect(modal).toBeVisible({ timeout: 8_000 })
      await modal.locator('input').first().fill(name)
      await modal
        .locator(`[data-testid="save-folder-row"][data-folder-name="${folderName}"]`)
        .click()
      await modal.getByRole('button', { name: /Save|Update/i }).click()
      await expect(modal).toBeHidden({ timeout: 20_000 })

      // The spec is only worth anything against the shape that crashed.
      const saved = (await listSavedRequestsByProject(window, projectId)) as Array<{
        name: string
        body?: string
      }>
      const row = saved.find((r) => r.name === name)
      expect(JSON.parse(row?.body ?? '{}').type).toBe('graphql')

      // An HTTP tab next to it: Cmd+W flips the stores only in a later effect.
      await closeAllTabs(window)
      await navigateSidebar(window, 'apis')
      await openHttpRequestTab(window)
      await treeOpenNode(window, name)
      await expect(tabs.filter({ hasText: name })).toHaveAttribute('data-active', 'true', {
        timeout: 10_000,
      })
      await pressModShortcut(window, 'w')
      await expect(tabs).toHaveCount(1)
      await expectNoErrorBoundary(window)

      // The last tab: no active tab, so the stores never flip at all.
      await closeAllTabs(window)
      await navigateSidebar(window, 'apis')
      await treeOpenNode(window, name)
      await expect(tabs).toHaveCount(1, { timeout: 10_000 })
      await pressModShortcut(window, 'w')
      await expect(tabs).toHaveCount(0)
      await expectNoErrorBoundary(window)
    } finally {
      await treeClearSearch(window).catch(() => {})
      await closeAllTabs(window).catch(() => {})
      await window
        .evaluate(
          async (fid) => {
            const w = window as unknown as Window & {
              api: { folder: { delete: (id: string) => Promise<unknown> } }
            }
            await w.api.folder.delete(fid)
          },
          folderId,
        )
        .catch(() => {})
    }
  })
})
