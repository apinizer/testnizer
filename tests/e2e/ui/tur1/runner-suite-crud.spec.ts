/**
 * MST-178 P1  Suite CRUD + item move/delete
 */
import { expect } from '@playwright/test'
import { uiTest } from './_setup'
import {
  dismissOverlays,
  ensureCanonicalProject,
  navigateSidebar,
} from '../../helpers/ui/bootstrap'
import {
  fillUrl,
  addVisualAssertion,
} from '../../helpers/ui/request-flow'
import {
  createTestSuite,
  addSuiteItem,
  saveActiveSuiteItem,
  runSuiteAndAssert,
  openSuiteContextMenu,
  clickSuiteContextMenuItem,
} from '../../helpers/ui/suite-flow'
import {
  getActiveProjectId,
  listTestSuitesByProject,
  listSuiteItems,
  findSuiteIdByName,
} from '../../helpers/ui/assert-ipc'
import { localHttpBin } from '../../helpers/test-servers'

const http = () => localHttpBin()
const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`

uiTest.describe('Tur1 — Suite CRUD [MST-178]', () => {
  uiTest.beforeEach(async ({ window }) => {
    await dismissOverlays(window)
    await ensureCanonicalProject(window)
    await navigateSidebar(window, 'tests')
  })

  /**
   * MST-178a — Suite create and item add
   * Create a suite, add two items, confirm they appear in the DB.
   */
  uiTest('MST-178a suite create and items persist in DB', async ({ window }) => {
    const tag = uid()
    const suiteName = `CRUD178-${tag}`
    const projectId = await getActiveProjectId(window)

    await createTestSuite(window, suiteName)
    await addSuiteItem(window, suiteName)
    await fillUrl(window, `${http()}/get?crud=178a-1`)
    await saveActiveSuiteItem(window)

    await addSuiteItem(window, suiteName)
    await fillUrl(window, `${http()}/get?crud=178a-2`)
    await saveActiveSuiteItem(window)

    const suiteId = await findSuiteIdByName(window, projectId, suiteName)
    expect(suiteId).toBeTruthy()
    const items = await listSuiteItems(window, suiteId)
    expect(items.length).toBeGreaterThanOrEqual(2)
  })

  /**
   * MST-178b — Suite delete removes it from DB
   * Create a suite then delete it via context menu; it must disappear from DB.
   */
  uiTest('MST-178b suite delete removes from DB', async ({ window }) => {
    const tag = uid()
    const suiteName = `Del178-${tag}`
    const projectId = await getActiveProjectId(window)

    await createTestSuite(window, suiteName)
    await addSuiteItem(window, suiteName)
    await fillUrl(window, `${http()}/get?del=178b`)
    await saveActiveSuiteItem(window)

    const suitesBefore = (await listTestSuitesByProject(window, projectId)) as Array<{ name: string }>
    expect(suitesBefore.some((s) => s.name === suiteName)).toBe(true)

    // Delete via context menu.
    await navigateSidebar(window, 'tests')
    await openSuiteContextMenu(window, suiteName)
    await clickSuiteContextMenuItem(window, /Delete/i)
    // Confirm dialog if present.
    const confirmBtn = window.getByTestId('delete-confirm-btn')
    if (await confirmBtn.isVisible({ timeout: 3_000 }).catch(() => false)) {
      const confirmInput = window.getByTestId('delete-confirm-input')
      if (await confirmInput.isVisible().catch(() => false)) await confirmInput.fill('delete')
      await confirmBtn.click()
    }
    await window.waitForTimeout(1_000)

    const suitesAfter = (await listTestSuitesByProject(window, projectId)) as Array<{ name: string }>
    expect(suitesAfter.some((s) => s.name === suiteName)).toBe(false)
  })

  /**
   * MST-178c — Suite item delete removes it from DB
   * Add two items to a suite, delete one, confirm only one remains.
   */
  uiTest('MST-178c suite item delete removes from DB', async ({ window }) => {
    const tag = uid()
    const suiteName = `ItemDel178-${tag}`
    const projectId = await getActiveProjectId(window)

    await createTestSuite(window, suiteName)
    await addSuiteItem(window, suiteName)
    await fillUrl(window, `${http()}/get?item=1`)
    await saveActiveSuiteItem(window)

    await addSuiteItem(window, suiteName)
    await fillUrl(window, `${http()}/get?item=2`)
    await saveActiveSuiteItem(window)

    const suiteId = await findSuiteIdByName(window, projectId, suiteName)
    const itemsBefore = await listSuiteItems(window, suiteId)
    expect(itemsBefore.length).toBeGreaterThanOrEqual(2)

    // Delete the first item via IPC (no UI testid for per-item delete in suite).
    // Per-item delete is exposed as api.testSuiteItem.delete(id) in the preload.
    const firstItemId = (itemsBefore as Array<{ id: string }>)[0].id
    const delResult = await window.evaluate(async (id) => {
      const w = window as unknown as Window & {
        api?: {
          testSuiteItem?: {
            delete: (id: string) => Promise<{ success: boolean; error?: string }>
          }
        }
      }
      return w.api?.testSuiteItem?.delete(id)
    }, firstItemId)
    expect(delResult?.success).toBe(true)
    const itemsAfter = await listSuiteItems(window, suiteId)
    expect(itemsAfter.length).toBe(itemsBefore.length - 1)
  })

  /**
   * MST-178d — Suite run after adding items succeeds
   */
  uiTest('MST-178d suite run completes with all passes', async ({ window }) => {
    const suiteName = `Run178d-${uid()}`
    await createTestSuite(window, suiteName)
    await addSuiteItem(window, suiteName)
    await fillUrl(window, `${http()}/get?run=178d`)
    await addVisualAssertion(window, /Status code equals/i, { expected: 200 })
    await saveActiveSuiteItem(window)

    await runSuiteAndAssert(window, suiteName, { minPassed: 1, maxFailed: 0 })
  })
})
