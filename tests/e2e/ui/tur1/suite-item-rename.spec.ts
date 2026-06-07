/**
 * MST-312 P1  Suite item rename via context menu — the new name shows in the
 *             tree, the old name disappears, and the rename persists to the DB.
 *
 * Uses suite-flow helpers (createTestSuite, addSuiteItem) and the
 * dispatchEvent-based context-menu click (fixed-position menus can fall
 * outside the viewport on a worker-shared, long suite list).
 *
 * Persistence is verified through the preload bridge:
 *   testSuite.list(projectId)  → suite id
 *   testSuite.listEndpoints(suiteId) → items[].name
 */
import { expect, type Page } from '@playwright/test'
import { uiTest } from './_setup'
import { dismissOverlays, ensureCanonicalProject, navigateSidebar } from '../../helpers/ui/bootstrap'
import {
  createTestSuite,
  addSuiteItem,
  clickSuiteContextMenuItem,
  navigateToTestsPanel,
} from '../../helpers/ui/suite-flow'
import { getActiveProjectId, findSuiteIdByName, listSuiteItems } from '../../helpers/ui/assert-ipc'

const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`

/** The Tests-panel suite search (placeholder "Search...") — scoped to the left
 * panel so it never collides with the APIs tree-search or other inputs. */
function suiteSearch(page: Page) {
  return page.getByTestId('left-panel').locator('input[placeholder="Search..."]')
}

/** Filter the suite list to a single suite so its item rows are unambiguous. */
async function isolateSuite(page: Page, suiteName: string): Promise<void> {
  await navigateToTestsPanel(page)
  await suiteSearch(page).fill(suiteName)
  await expect(page.getByText(suiteName, { exact: true }).first()).toBeVisible({ timeout: 10_000 })
}

uiTest.describe('Tur1 — Suite item rename [MST-312]', () => {
  uiTest.beforeEach(async ({ window }) => {
    await dismissOverlays(window)
    await ensureCanonicalProject(window)
    await navigateSidebar(window, 'tests')
  })

  uiTest('MST-312 rename suite item updates tree and persists', async ({ window }) => {
    const suiteName = `RenameSuite ${uid()}`
    const newItemName = `Renamed Item ${uid()}`
    const defaultItemName = 'New Request' // testsPanel.newRequestDefaultName (EN)

    await createTestSuite(window, suiteName)
    // addSuiteItem creates a "New Request" item, auto-expands the suite and
    // opens its editor tab.
    await addSuiteItem(window, suiteName)

    // Isolate the suite so the only visible item row is the one we created.
    await isolateSuite(window, suiteName)

    const panel = window.getByTestId('left-panel')
    const itemRow = panel.getByText(defaultItemName, { exact: true }).first()
    await expect(itemRow).toBeVisible({ timeout: 10_000 })

    // Right-click the item row → fixed-position item context menu.
    await itemRow.click({ button: 'right' })
    await clickSuiteContextMenuItem(window, /Rename/i)

    // Inline rename input appears in place of the item label. NOTE: the input
    // renders without a `type` attribute, so `input[type="text"]` would never
    // match — target the dedicated testid instead.
    const renameInput = panel.getByTestId('suite-item-rename-input')
    await renameInput.waitFor({ state: 'visible', timeout: 5_000 })
    await renameInput.fill(newItemName)
    await renameInput.press('Enter')

    // Tree reflects the new name; the default name is gone from the panel.
    await expect(panel.getByText(newItemName, { exact: true }).first()).toBeVisible({
      timeout: 10_000,
    })
    await expect(panel.getByText(defaultItemName, { exact: true })).toHaveCount(0, {
      timeout: 10_000,
    })

    // Persisted in the DB via IPC.
    const projectId = await getActiveProjectId(window)
    const suiteId = await findSuiteIdByName(window, projectId, suiteName)
    const items = (await listSuiteItems(window, suiteId)) as Array<{ name: string }>
    expect(items.some((i) => i.name === newItemName)).toBe(true)
    expect(items.some((i) => i.name === defaultItemName)).toBe(false)
  })
})
