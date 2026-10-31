/**
 * Issue #302 — the folder icon on a TEST SUITE run result reveals the item in
 * the Tests sidebar (it used to be withheld on suite runs).
 *
 * A suite with a folder holding one item is run; from the APIs sidebar the
 * result row's `runner-reveal-<itemId>` switches to Tests, expands the suite
 * and the folder and marks the item row active.
 *
 * Cleanup: tabs force-closed, the suite (and its folder/item) deleted via IPC.
 */
import { expect, type Page } from '@playwright/test'
import { uiTest } from './_setup'
import {
  closeAllTabs,
  dismissOverlays,
  ensureCanonicalProject,
  navigateSidebar,
} from '../helpers/ui/bootstrap'
import { getActiveProjectId } from '../helpers/ui/assert-ipc'
import { runSuiteFromContextMenu } from '../helpers/ui/suite-flow'
import { waitRunnerConfigReady, startRunnerTabRun, waitRunnerTabComplete } from '../helpers/ui/runner-flow'
import { localHttpBin } from '../helpers/test-servers'

// Screenshots land in the test output dir; TESTNIZER_SHOTS_DIR redirects them for manual review.
const shot = (name: string): string =>
  process.env.TESTNIZER_SHOTS_DIR
    ? `${process.env.TESTNIZER_SHOTS_DIR}/${name}`
    : uiTest.info().outputPath(name)
const uid = (): string => String(Date.now()).slice(-8)

type IpcResult<T> = { success: boolean; data?: T; error?: string }

async function addFolderWithItem(
  page: Page,
  suiteId: string,
  folderName: string,
  itemName: string,
  url: string,
): Promise<string> {
  return page.evaluate(
    async ({ sid, fn, inm, u }) => {
      const w = window as unknown as Window & {
        api: {
          testSuiteFolder: { create: (p: unknown) => Promise<IpcResult<{ id: string }>> }
          testSuiteItem: { create: (p: unknown) => Promise<IpcResult<{ id: string }>> }
        }
      }
      const f = await w.api.testSuiteFolder.create({ suite_id: sid, name: fn })
      if (!f.success || !f.data?.id) throw new Error(f.error ?? 'create suite folder failed')
      const it = await w.api.testSuiteItem.create({
        suite_id: sid,
        folder_id: f.data.id,
        name: inm,
        method: 'GET',
        url: u,
        protocol: 'http',
        assertions: JSON.stringify([]),
        request_schema: JSON.stringify({
          method: 'GET',
          url: u,
          headers: [],
          params: [],
          body: null,
          auth: { type: 'none' },
        }),
      })
      if (!it.success || !it.data?.id) throw new Error(it.error ?? 'create suite item failed')
      return it.data.id
    },
    { sid: suiteId, fn: folderName, inm: itemName, u: url },
  )
}

uiTest.describe('Issue #302 — suite run result reveals the item in Tests', () => {
  uiTest.beforeEach(async ({ window }) => {
    await dismissOverlays(window)
    await ensureCanonicalProject(window)
  })

  uiTest('reveal icon on a suite run switches to Tests and selects the item', async ({ window }) => {
    const stamp = uid()
    const suiteName = `Reveal302 ${stamp}`
    const folderName = `Reveal folder ${stamp}`
    const itemName = `Reveal item ${stamp}`
    const projectId = await getActiveProjectId(window)
    let suiteId: string | null = null

    try {
      // Suite, folder and item are written through IPC BEFORE the Tests panel
      // is opened, so the panel loads them from scratch.
      suiteId = await window.evaluate(
        async ({ pid, n }) => {
          const w = window as unknown as Window & {
            api: { testSuite: { create: (p: unknown) => Promise<IpcResult<{ id: string }>> } }
          }
          const r = await w.api.testSuite.create({ project_id: pid, name: n, description: 'E2E #302' })
          if (!r.success || !r.data?.id) throw new Error(r.error ?? 'create suite failed')
          return r.data.id
        },
        { pid: projectId, n: suiteName },
      )
      const itemId = await addFolderWithItem(
        window,
        suiteId,
        folderName,
        itemName,
        `${localHttpBin()}/get?reveal=${stamp}`,
      )

      // Run the suite (remount the Tests panel so it reads the fresh data).
      await navigateSidebar(window, 'apis')
      await navigateSidebar(window, 'tests')
      await expect(window.getByText(suiteName, { exact: true }).first()).toBeVisible({ timeout: 10_000 })
      await runSuiteFromContextMenu(window, suiteName)
      await waitRunnerConfigReady(window)
      await startRunnerTabRun(window)
      await waitRunnerTabComplete(window, 60_000)

      // Leave the Tests sidebar, so the reveal has to bring it back.
      await navigateSidebar(window, 'apis')
      await expect(window.getByTestId('suite-item-row')).toHaveCount(0)

      const reveal = window.getByTestId(`runner-reveal-${itemId}`)
      await expect(reveal).toBeVisible({ timeout: 10_000 })
      await window.screenshot({ path: shot('302-1-suite-run-result-reveal-icon.png') })
      await reveal.click()

      const row = window.locator(`[data-testid="suite-item-row"][data-item-id="${itemId}"]`)
      await expect(row).toBeVisible({ timeout: 10_000 })
      await expect(row).toHaveAttribute('data-active', 'true')
      await expect(row).toContainText(itemName)
      // The nav highlight follows the page (150 ms colour transition).
      await window.waitForTimeout(400)
      const navColor = (id: string) =>
        window.getByTestId(`nav-${id}`).evaluate((el) => getComputedStyle(el).backgroundColor)
      expect(await navColor('tests')).not.toBe(await navColor('apis'))
      expect(await navColor('apis')).toBe('rgba(0, 0, 0, 0)')
      await window.screenshot({ path: shot('302-2-revealed-in-tests-sidebar.png') })
    } finally {
      await closeAllTabs(window).catch(() => {})
      if (suiteId) {
        await window
          .evaluate(async (id) => {
            const w = window as unknown as Window & {
              api: { testSuite: { delete: (id: string) => Promise<unknown> } }
            }
            await w.api.testSuite.delete(id)
          }, suiteId)
          .catch(() => {})
      }
    }
  })
})
