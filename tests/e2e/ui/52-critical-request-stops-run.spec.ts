/**
 * Issue #304 — a Critical request stops the whole run when it fails, whatever
 * "Stop on error" says.
 *
 *   1. Settings tab → "Critical request" switch; it persists through Ctrl+S
 *      (in-place update), close and reopen.
 *   2. Run with "Stop on error" OFF: the failing critical request is followed
 *      by nothing — the second request does not run, the results carry the
 *      Critical badge and the "Stopped: critical request …" line.
 *   3. Control: with the flag removed the same run executes both requests.
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
import { clickRequestTab, fillUrl, saveRequestToFolder } from '../helpers/ui/request-flow'
import { createFolder, getActiveProjectId, listSavedRequestsByProject } from '../helpers/ui/assert-ipc'
import { pressModShortcut } from '../helpers/ui/keyboard'
import { treeClearSearch, treeOpenNode } from '../helpers/ui/tree'
import {
  openCollectionRunner,
  selectOnlyRunnerEndpoints,
  startRunnerTabRun,
  waitRunnerTabComplete,
} from '../helpers/ui/runner-flow'
import { localHttpBin } from '../helpers/test-servers'

const SHOTS = '/private/tmp/claude-501/-Users-mhy-IdeaProjects-testnizer/080c60f4-ae3a-433a-9eda-a394ab175de1/scratchpad/shots'
const uid = (): string => String(Date.now()).slice(-8)

const activeTab = (page: Page) => page.locator('[data-testid="endpoint-tab"][data-active="true"]')

async function setCritical(page: Page, on: boolean): Promise<void> {
  await clickRequestTab(page, 'settings')
  const sw = page.getByTestId('settings-critical')
  await expect(sw).toBeAttached({ timeout: 8_000 })
  // sr-only checkbox behind a styled switch — click the switch (its label).
  if ((await sw.isChecked()) !== on) await sw.locator('xpath=ancestor::label[1]').click()
  await expect(sw).toBeChecked({ checked: on })
}

/** Run the selected rows with "Stop on error" explicitly OFF. */
async function runWithoutStopOnError(page: Page, stamp: string): Promise<void> {
  await openCollectionRunner(page)
  await selectOnlyRunnerEndpoints(page, stamp)
  const stopOnError = page.getByTestId('workbench').getByLabel(/Stop run if an error occurs/i)
  await stopOnError.setChecked(false)
  await expect(stopOnError).not.toBeChecked()
  await startRunnerTabRun(page)
  await waitRunnerTabComplete(page)
}

async function deleteFolderAndRequests(
  page: Page,
  projectId: string,
  folderId: string,
  names: string[],
): Promise<void> {
  const rows = (await listSavedRequestsByProject(page, projectId)) as Array<{ id: string; name: string }>
  await page.evaluate(
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
    { ids: rows.filter((r) => names.includes(r.name)).map((r) => r.id), fid: folderId },
  )
}

uiTest.describe('Issue #304 — critical request stops the run', () => {
  uiTest.beforeEach(async ({ window }) => {
    await dismissOverlays(window)
    await ensureCanonicalProject(window)
    await navigateSidebar(window, 'apis')
  })

  uiTest('failing critical request halts the run even with Stop on error off', async ({ window }) => {
    const stamp = uid()
    const folderName = `Crit304 ${stamp}`
    const first = `Crit first ${stamp}`
    const second = `Crit second ${stamp}`
    const projectId = await getActiveProjectId(window)
    const folderId = await createFolder(window, projectId, folderName)

    try {
      // Request 1 — fails (404), saved plain first so the flag goes through the in-place Ctrl+S path.
      await openHttpRequestTab(window)
      await fillUrl(window, `${localHttpBin()}/status/404?crit=${stamp}`)
      await saveRequestToFolder(window, first, folderName)
      await expect(activeTab(window)).toHaveAttribute('data-dirty', 'false', { timeout: 8_000 })

      await setCritical(window, true)
      await expect(activeTab(window)).toHaveAttribute('data-dirty', 'true')
      await window.screenshot({ path: `${SHOTS}/304-1-settings-critical-toggle.png` })
      await pressModShortcut(window, 's')
      await expect(activeTab(window)).toHaveAttribute('data-dirty', 'false', { timeout: 8_000 })

      // Persists: close every tab, reopen from the tree.
      await closeAllTabs(window)
      await navigateSidebar(window, 'apis')
      await treeOpenNode(window, first)
      await clickRequestTab(window, 'settings')
      await expect(window.getByTestId('settings-critical')).toBeChecked({ timeout: 10_000 })
      await treeClearSearch(window)

      // Request 2 — would pass, normal.
      await openHttpRequestTab(window)
      await fillUrl(window, `${localHttpBin()}/get?second=${stamp}`)
      await saveRequestToFolder(window, second, folderName)
      await closeAllTabs(window)

      // Run with Stop on error OFF.
      await runWithoutStopOnError(window, stamp)
      const wb = window.getByTestId('workbench')
      const list = wb.getByTestId('runner-results-list')

      // Results: Critical badge on the failing request + the stop line naming it.
      await expect(list.getByTestId('critical-badge')).toHaveCount(1)
      const stopLine = wb.getByTestId('runner-stop-critical')
      await expect(stopLine).toBeVisible()
      await expect(stopLine).toContainText(`critical request "${first}" failed`)
      // The second request never ran: listed as NOT RUN, no 200 for it.
      await expect(list).toContainText(first)
      await expect(list).toContainText(second)
      await expect(list).toContainText('NOT RUN')
      await window.screenshot({ path: `${SHOTS}/304-2-run-stopped-critical.png` })

      // Control — drop the flag: the same run executes both requests, no stop line.
      await closeAllTabs(window)
      await navigateSidebar(window, 'apis')
      await treeOpenNode(window, first)
      await setCritical(window, false)
      await pressModShortcut(window, 's')
      await expect(activeTab(window)).toHaveAttribute('data-dirty', 'false', { timeout: 8_000 })
      await treeClearSearch(window)
      await closeAllTabs(window)

      await runWithoutStopOnError(window, stamp)
      await expect(wb.getByTestId('runner-stop-critical')).toHaveCount(0)
      await expect(wb.getByTestId('critical-badge')).toHaveCount(0)
      await expect(wb.getByTestId('runner-results-list')).toContainText(second)
      await expect(wb.getByTestId('runner-results-list')).not.toContainText('NOT RUN')
      await window.screenshot({ path: `${SHOTS}/304-3-control-both-ran.png` })
    } finally {
      await treeClearSearch(window).catch(() => {})
      await closeAllTabs(window).catch(() => {})
      await deleteFolderAndRequests(window, projectId, folderId, [first, second]).catch(() => {})
    }
  })
})
