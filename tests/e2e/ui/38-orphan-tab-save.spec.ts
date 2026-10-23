/**
 * Issue #269 (P0 data loss) — the tester's steps:
 *   1. save an HTTP request into a folder,
 *   2. edit it (the tab is now dirty),
 *   3. delete it (or its folder) from the sidebar,
 *   4. Ctrl+S / the UrlBar Save button.
 * Before the fix: "Request saved", tab clean, nothing written (the row was
 * gone). Now the dirty tab stays open, unbound, and the Save dialog opens with
 * a persistent notice inside it (`save-modal-orphan-notice`: "The saved
 * request was deleted…"); saving from there writes a new row carrying the
 * edit. A CLEAN tab has nothing to lose: deleting its request closes it.
 */
import { expect, type Page } from '@playwright/test'
import { uiTest } from './_setup'
import {
  dismissOverlays,
  ensureCanonicalProject,
  navigateSidebar,
  openHttpRequestTab,
} from '../helpers/ui/bootstrap'
import { fillUrl, saveRequestToFolder } from '../helpers/ui/request-flow'
import { treeContextAction, treeClearSearch, treeSearch } from '../helpers/ui/tree'
import { pressModShortcut } from '../helpers/ui/keyboard'
import {
  createFolder,
  getActiveProjectId,
  listSavedRequestsByProject,
} from '../helpers/ui/assert-ipc'
import { localHttpBin } from '../helpers/test-servers'

const http = () => localHttpBin()
const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
const ORPHAN_NOTICE = /saved request was deleted/i

const activeTab = (page: Page) => page.locator('[data-testid="endpoint-tab"][data-active="true"]')

/** Delete a tree node via its context menu; folders ask for "delete" to be typed. */
async function treeDelete(page: Page, label: string): Promise<void> {
  await treeSearch(page, label)
  await treeContextAction(page, label, /^Delete/i)
  const typed = page.getByTestId('delete-confirm-input')
  if (await typed.isVisible().catch(() => false)) await typed.fill('delete')
  await page.getByTestId('delete-confirm-btn').click()
  await treeClearSearch(page)
}

async function savedRows(page: Page, projectId: string) {
  return (await listSavedRequestsByProject(page, projectId)) as Array<{
    id: string
    name: string
    url: string
  }>
}

uiTest.describe('Issue #269 — saving a request whose row was deleted', () => {
  uiTest.beforeEach(async ({ window }) => {
    await dismissOverlays(window)
    await ensureCanonicalProject(window)
    await navigateSidebar(window, 'apis')
  })

  uiTest(
    'folder deleted → Ctrl+S opens Save As with the notice, tab stays dirty, nothing reported saved',
    async ({ window }) => {
      const folderName = `Orphan folder ${uid()}`
      const reqName = `Orphan req ${uid()}`
      const projectId = await getActiveProjectId(window)
      await createFolder(window, projectId, folderName)

      // 1. Save into the folder.
      await openHttpRequestTab(window)
      await fillUrl(window, `${http()}/get?v=1`)
      await saveRequestToFolder(window, reqName, folderName)
      await expect(activeTab(window)).toHaveAttribute('data-dirty', 'false', { timeout: 8_000 })

      // 2. Edit — unsaved changes.
      const edited = `${http()}/get?v=edited-${uid()}`
      await fillUrl(window, edited)
      await expect(activeTab(window)).toHaveAttribute('data-dirty', 'true')

      // 3. Delete the folder from the sidebar; the dirty tab stays open.
      await treeDelete(window, folderName)
      await expect(activeTab(window)).toBeVisible()
      await expect(activeTab(window)).toHaveAttribute('data-dirty', 'true')
      await expect
        .poll(async () => (await savedRows(window, projectId)).some((r) => r.name === reqName))
        .toBe(false)

      // 4. Ctrl+S → Save dialog + notice; never "Request saved", never clean.
      await pressModShortcut(window, 's')
      const modal = window.getByTestId('endpoint-save-modal')
      await expect(modal).toBeVisible({ timeout: 8_000 })
      const notice = modal.getByTestId('save-modal-orphan-notice')
      await expect(notice).toBeVisible({ timeout: 8_000 })
      await expect(notice).toHaveText(ORPHAN_NOTICE)
      await expect(activeTab(window)).toHaveAttribute('data-dirty', 'true')

      // Saving from the dialog writes a NEW row carrying the edit.
      const newName = `Recovered ${uid()}`
      await modal.locator('input').first().fill(newName)
      await modal.getByRole('button', { name: /Save/i }).click()
      await expect(modal).toBeHidden({ timeout: 20_000 })
      await expect(activeTab(window)).toHaveAttribute('data-dirty', 'false', { timeout: 10_000 })
      const recovered = (await savedRows(window, projectId)).find((r) => r.name === newName)
      expect(recovered?.url).toBe(edited)
    },
  )

  uiTest(
    'request deleted → UrlBar Save opens Save As with the notice (no red ✗)',
    async ({ window }) => {
      const folderName = `Orphan folder ${uid()}`
      const reqName = `Orphan req ${uid()}`
      const projectId = await getActiveProjectId(window)
      await createFolder(window, projectId, folderName)

      await openHttpRequestTab(window)
      await fillUrl(window, `${http()}/get?v=1`)
      await saveRequestToFolder(window, reqName, folderName)

      await fillUrl(window, `${http()}/get?v=2`)
      await expect(activeTab(window)).toHaveAttribute('data-dirty', 'true')
      await treeDelete(window, reqName)

      await window.getByTestId('save-btn').click()
      const modal = window.getByTestId('endpoint-save-modal')
      await expect(modal).toBeVisible({ timeout: 8_000 })
      await expect(modal.getByTestId('save-modal-orphan-notice')).toBeVisible({ timeout: 8_000 })
      await expect(window.getByTestId('save-btn')).not.toHaveText(/✗/)
      await expect(activeTab(window)).toHaveAttribute('data-dirty', 'true')
      await window.keyboard.press('Escape')
    },
  )

  uiTest('a clean tab closes when its request is deleted', async ({ window }) => {
    const folderName = `Orphan folder ${uid()}`
    const reqName = `Clean req ${uid()}`
    const projectId = await getActiveProjectId(window)
    await createFolder(window, projectId, folderName)

    await openHttpRequestTab(window)
    await fillUrl(window, `${http()}/get?v=clean`)
    await saveRequestToFolder(window, reqName, folderName)
    await expect(activeTab(window)).toHaveAttribute('data-dirty', 'false', { timeout: 8_000 })
    const savedTab = window.locator(`[data-testid="endpoint-tab"][data-tab-name="${reqName}"]`)
    await expect(savedTab).toHaveCount(1, { timeout: 8_000 })

    await treeDelete(window, reqName)

    // Closed without an unsaved-changes prompt — there were no changes.
    await expect(savedTab).toHaveCount(0, { timeout: 8_000 })
  })
})
