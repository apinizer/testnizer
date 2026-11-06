/**
 * Issue #314 — a double-click on an APIs tree request opens it pinned, with a
 * real double-click in the real tree (the row's IPC read races the gesture).
 *
 * Cleanup: tabs force-closed, saved requests and the folder deleted via IPC.
 */
import { expect, type Page } from '@playwright/test'
import { uiTest } from './_setup'
import {
  closeAllTabs,
  dismissOverlays,
  ensureCanonicalProject,
  navigateSidebar,
  openHttpRequestTab,
} from '../helpers/ui/bootstrap'
import { fillUrl, saveRequestToFolder } from '../helpers/ui/request-flow'
import { createFolder, getActiveProjectId, listSavedRequestsByProject } from '../helpers/ui/assert-ipc'
import { treeClearSearch, treeSearch } from '../helpers/ui/tree'
import { localHttpBin } from '../helpers/test-servers'

const uid = (): string => String(Date.now()).slice(-8)
const tabs = (page: Page) => page.getByTestId('endpoint-tab')
const row = (page: Page, label: string) =>
  page.getByTestId('tree-node').filter({ hasText: label }).first()
const tab = (page: Page, label: string) => tabs(page).filter({ hasText: label })

uiTest.describe('Issue #314 — double-click in the APIs tree pins the tab', () => {
  uiTest.beforeEach(async ({ window }) => {
    await dismissOverlays(window)
    await ensureCanonicalProject(window)
    await navigateSidebar(window, 'apis')
  })

  uiTest('double-click pins; single click stays a preview', async ({ window }) => {
    const stamp = uid()
    const folderName = `Pin314 ${stamp}`
    const first = `Pin first ${stamp}`
    const second = `Pin second ${stamp}`
    const projectId = await getActiveProjectId(window)
    const folderId = await createFolder(window, projectId, folderName)

    try {
      for (const name of [first, second]) {
        await openHttpRequestTab(window)
        await fillUrl(window, `${localHttpBin()}/get?pin=${stamp}`)
        await saveRequestToFolder(window, name, folderName)
      }
      await closeAllTabs(window)
      await navigateSidebar(window, 'apis')
      await treeSearch(window, stamp)
      await expect(row(window, first)).toBeVisible({ timeout: 10_000 })

      // Single click: preview, and the next click replaces it.
      await row(window, first).click()
      await expect(tab(window, first)).toHaveAttribute('data-preview', 'true')
      await row(window, second).click()
      await expect(tab(window, second)).toHaveAttribute('data-preview', 'true')
      await expect(tabs(window)).toHaveCount(1)

      // Double-click on the open preview: same tab, pinned.
      await row(window, second).dblclick()
      await expect(tab(window, second)).toHaveAttribute('data-preview', 'false')
      await expect(tabs(window)).toHaveCount(1)

      // Single click elsewhere: a new preview, the pinned tab stays.
      await row(window, first).click()
      await expect(tab(window, first)).toHaveAttribute('data-preview', 'true')
      await expect(tab(window, second)).toHaveAttribute('data-preview', 'false')
      await expect(tabs(window)).toHaveCount(2)

      // Double-click on a pinned row: focus, no duplicate.
      await row(window, second).dblclick()
      await expect(tab(window, second)).toHaveAttribute('data-active', 'true')
      await expect(tabs(window)).toHaveCount(2)
      await expect(tab(window, first)).toHaveAttribute('data-preview', 'true')

      // Double-click on a row that has no tab yet: opens pinned straight away.
      await closeAllTabs(window)
      await row(window, first).dblclick()
      await expect(tab(window, first)).toHaveAttribute('data-preview', 'false', { timeout: 10_000 })
      await expect(tabs(window)).toHaveCount(1)

      // Double-click on a folder: no tab.
      await closeAllTabs(window)
      await row(window, folderName).dblclick()
      await expect(tabs(window)).toHaveCount(0)
    } finally {
      await treeClearSearch(window).catch(() => {})
      await closeAllTabs(window).catch(() => {})
      const rows = (await listSavedRequestsByProject(window, projectId)) as Array<{
        id: string
        name: string
      }>
      await window
        .evaluate(
          async ({ ids, fid }) => {
            const w = window as unknown as Window & {
              api: {
                savedRequest: { delete: (id: string) => Promise<unknown> }
                folder: { delete: (id: string) => Promise<unknown> }
              }
            }
            for (const id of ids) await w.api.savedRequest.delete(id)
            await w.api.folder.delete(fid)
          },
          {
            ids: rows.filter((r) => r.name.endsWith(stamp)).map((r) => r.id),
            fid: folderId,
          },
        )
        .catch(() => {})
    }
  })
})
