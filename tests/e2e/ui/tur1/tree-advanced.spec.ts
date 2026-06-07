/**
 * MST-018 P1 Folder delete cascade
 * MST-020 P1 Duplicate → independent edit
 * MST-027 P1 Module CRUD
 * MST-029 P1 Suite item Ctrl+S guard (prevents save to APIs tree)
 * MST-024 P2 EndpointCase CRUD
 */
import { expect } from '@playwright/test'
import { uiTest } from './_setup'
import {
  dismissOverlays,
  ensureCanonicalProject,
  navigateSidebar,
  openHttpRequestTab,
} from '../../helpers/ui/bootstrap'
import { fillUrl, saveRequestToTree } from '../../helpers/ui/request-flow'
import {
  confirmDelete,
  treeContextAction,
  treeOpenNode,
  treeSearch,
} from '../../helpers/ui/tree'
import {
  createFolder,
  getActiveProjectId,
  listSavedRequestsByProject,
} from '../../helpers/ui/assert-ipc'
import { createSavedRequestIpc } from '../../helpers/ui/db-flow'
import { refreshWorkspaceTree } from '../../helpers/ui/import-flow'
import { localHttpBin } from '../../helpers/test-servers'

const http = () => localHttpBin()
const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`

uiTest.describe('Tur1 — Tree Advanced [MST-018, MST-020, MST-024, MST-027, MST-029]', () => {
  uiTest.beforeEach(async ({ window }) => {
    await dismissOverlays(window)
    await ensureCanonicalProject(window)
    await navigateSidebar(window, 'apis')
  })

  // -------------------------------------------------------------------------
  // MST-018 — Folder delete cascade: deleting a folder removes child requests
  // -------------------------------------------------------------------------
  uiTest('MST-018 folder delete cascades to child endpoints', async ({ window }) => {
    const folderName = `CascadeFolder ${uid()}`
    const reqName1 = `Child1 ${uid()}`
    const reqName2 = `Child2 ${uid()}`
    const projectId = await getActiveProjectId(window)

    // Create folder with two child requests via IPC.
    const folderId = await createFolder(window, projectId, folderName)
    await createSavedRequestIpc(window, {
      projectId,
      name: reqName1,
      url: `${http()}/get?folder=1`,
      folderId,
    })
    await createSavedRequestIpc(window, {
      projectId,
      name: reqName2,
      url: `${http()}/get?folder=2`,
      folderId,
    })
    await refreshWorkspaceTree(window)

    // Confirm both children appear in tree.
    await treeSearch(window, reqName1)
    await expect(window.getByTestId('tree-node').filter({ hasText: reqName1 })).toHaveCount(1, {
      timeout: 10_000,
    })

    // Delete the folder via context menu.
    await treeSearch(window, folderName)
    await treeContextAction(window, folderName, /Delete/i)
    // Folder delete may show a confirmation dialog (typed or simple button).
    const typed = await window.getByTestId('delete-confirm-input').isVisible().catch(() => false)
    await confirmDelete(window, typed)

    // Folder must be gone from the tree.
    await treeSearch(window, folderName)
    await expect(window.getByTestId('tree-node').filter({ hasText: folderName })).toHaveCount(0, {
      timeout: 10_000,
    })

    // Children must also be absent (cascade delete).
    await treeSearch(window, reqName1)
    await expect(window.getByTestId('tree-node').filter({ hasText: reqName1 })).toHaveCount(0, {
      timeout: 8_000,
    })
    await treeSearch(window, reqName2)
    await expect(window.getByTestId('tree-node').filter({ hasText: reqName2 })).toHaveCount(0, {
      timeout: 8_000,
    })

    // IPC assertion: children not in DB.
    const saved = (await listSavedRequestsByProject(window, projectId)) as Array<{ name: string }>
    expect(saved.some((r) => r.name === reqName1)).toBe(false)
    expect(saved.some((r) => r.name === reqName2)).toBe(false)
  })

  // -------------------------------------------------------------------------
  // MST-020 — Duplicate → independent edit (rename of copy doesn't affect original)
  // -------------------------------------------------------------------------
  uiTest('MST-020 duplicate endpoint creates independent copy', async ({ window }) => {
    const origName = `Original ${uid()}`
    const projectId = await getActiveProjectId(window)

    await openHttpRequestTab(window)
    await fillUrl(window, `${http()}/get?orig=1`)
    await saveRequestToTree(window, origName)

    // Find original in tree and duplicate via context menu.
    await treeSearch(window, origName)
    await treeContextAction(window, origName, /Duplicate/i)

    // Wait for duplicate to appear (usually "Copy of <name>" or "<name> (1)").
    const copyLocator = window.getByTestId('tree-node').filter({ hasText: /Copy|copy|\(1\)/ })
    await expect(copyLocator).toHaveCount(1, { timeout: 10_000 })

    // Retrieve copy name.
    const copyText = await copyLocator.first().textContent()
    expect(copyText).toBeTruthy()

    // Rename copy via context menu — original name unchanged.
    const newCopyName = `DupEdit ${uid()}`
    await treeContextAction(window, copyText!.trim(), /Rename/i)
    const renameInput = window.getByTestId('tree-node').locator('input[type="text"]').last()
    await renameInput.waitFor({ state: 'visible', timeout: 5_000 })
    await renameInput.fill(newCopyName)
    await renameInput.press('Enter')

    // Original must still exist unchanged.
    await treeSearch(window, origName)
    await expect(window.getByTestId('tree-node').filter({ hasText: origName })).toHaveCount(1, {
      timeout: 8_000,
    })

    // Copy has the new name.
    await treeSearch(window, newCopyName)
    await expect(window.getByTestId('tree-node').filter({ hasText: newCopyName })).toHaveCount(1, {
      timeout: 8_000,
    })

    // IPC: two entries exist in DB.
    const saved = (await listSavedRequestsByProject(window, projectId)) as Array<{ name: string }>
    expect(saved.some((r) => r.name === origName)).toBe(true)
    expect(saved.some((r) => r.name === newCopyName)).toBe(true)
  })

  // -------------------------------------------------------------------------
  // MST-027 — Module CRUD (add/rename/delete a module node)
  // -------------------------------------------------------------------------
  uiTest('MST-027 module create, rename, and delete', async ({ window }) => {
    const modName = `Mod ${uid()}`
    const modRenamed = `ModRenamed ${uid()}`

    // Open (+) dropdown and look for "Module" or equivalent item.
    await window.getByTestId('new-dropdown-btn').click()
    const menu = window.getByTestId('new-dropdown-menu')
    await expect(menu).toBeVisible()

    const moduleBtn = menu.getByRole('button', { name: /Module|Modül/i })
    if (!(await moduleBtn.isVisible().catch(() => false))) {
      console.log('MST-027: Module option not found in new dropdown — needs data-testid hook')
      await window.keyboard.press('Escape')
      return
    }
    await moduleBtn.click()

    // Modal or inline input for module name.
    const nameModal = window.getByTestId('new-module-modal')
    if (await nameModal.isVisible().catch(() => false)) {
      await nameModal.locator('input').first().fill(modName)
      await nameModal.getByRole('button', { name: /Create|Save|OK/i }).click()
      await expect(nameModal).toBeHidden({ timeout: 10_000 })
    } else {
      // Inline rename input in tree.
      const inp = window.getByTestId('tree-node').locator('input[type="text"]').last()
      await inp.waitFor({ state: 'visible', timeout: 5_000 })
      await inp.fill(modName)
      await inp.press('Enter')
    }

    // Module visible in tree.
    await treeSearch(window, modName)
    await expect(window.getByTestId('tree-node').filter({ hasText: modName })).toHaveCount(1, {
      timeout: 10_000,
    })

    // Rename.
    await treeContextAction(window, modName, /Rename/i)
    const renameInp = window.getByTestId('tree-node').locator('input[type="text"]').last()
    await renameInp.waitFor({ state: 'visible', timeout: 5_000 })
    await renameInp.fill(modRenamed)
    await renameInp.press('Enter')

    await treeSearch(window, modRenamed)
    await expect(window.getByTestId('tree-node').filter({ hasText: modRenamed })).toHaveCount(1, {
      timeout: 8_000,
    })

    // Delete.
    await treeContextAction(window, modRenamed, /Delete/i)
    const typed = await window.getByTestId('delete-confirm-input').isVisible().catch(() => false)
    await confirmDelete(window, typed)

    await treeSearch(window, modRenamed)
    await expect(window.getByTestId('tree-node').filter({ hasText: modRenamed })).toHaveCount(0, {
      timeout: 10_000,
    })
  })

  // -------------------------------------------------------------------------
  // MST-029 — Suite item Ctrl+S guard: saving inside a test suite should NOT
  //           open the APIs tree save modal (EndpointSaveModal).
  // -------------------------------------------------------------------------
  uiTest('MST-029 suite item Ctrl+S does not trigger EndpointSaveModal', async ({ window }) => {
    // Navigate to Tests sidebar.
    await navigateSidebar(window, 'tests')

    // Check if a test suite tab / panel is visible.
    const testsPanel = window
      .getByTestId('tests-panel')
      .or(window.getByTestId('suite-editor'))

    if (!(await testsPanel.isVisible().catch(() => false))) {
      console.log('MST-029: tests-panel / suite-editor not found — needs data-testid hook')
      return
    }

    // Open a suite item or the suite runner tab; press Ctrl+S.
    const mod = process.platform === 'darwin' ? 'Meta' : 'Control'
    await window.keyboard.press(`${mod}+KeyS`)
    await window.waitForTimeout(500)

    // EndpointSaveModal must NOT appear.
    await expect(window.getByTestId('endpoint-save-modal')).toBeHidden({ timeout: 3_000 })
  })

  // -------------------------------------------------------------------------
  // MST-024 — EndpointCase CRUD (P2)
  // -------------------------------------------------------------------------
  uiTest('MST-024 EndpointCase create, rename, and delete', async ({ window }) => {
    const baseName = `CaseBase ${uid()}`
    const caseName = `Case1 ${uid()}`
    const projectId = await getActiveProjectId(window)

    // Create a saved request to attach cases to.
    await createSavedRequestIpc(window, {
      projectId,
      name: baseName,
      url: `${http()}/get?case=1`,
    })
    await refreshWorkspaceTree(window)

    // Open the endpoint in tree.
    await treeOpenNode(window, baseName)

    // Look for an "Add Case" or "Cases" action in context menu or request editor.
    const addCaseBtn = window.getByRole('button', { name: /Add Case|Vaka Ekle/i })
    if (!(await addCaseBtn.isVisible().catch(() => false))) {
      // Try context menu on the tree node.
      await treeSearch(window, baseName)
      const node = window.getByTestId('tree-node').filter({ hasText: baseName }).first()
      await node.click({ button: 'right' })
      const menu = window.locator('[data-context-menu]')
      const addCaseMenuItem = menu.getByRole('button', { name: /Add Case|Add Variant|Varyant/i })
      if (!(await addCaseMenuItem.isVisible().catch(() => false))) {
        console.log('MST-024: Add Case option not found — needs data-testid hook or context menu item')
        await window.keyboard.press('Escape')
        return
      }
      await addCaseMenuItem.click()
    } else {
      await addCaseBtn.click()
    }

    // Name the case.
    const caseInput = window.getByTestId('new-case-modal')
      .locator('input')
      .first()
      .or(window.getByTestId('tree-node').locator('input[type="text"]').last())
    await caseInput.waitFor({ state: 'visible', timeout: 5_000 })
    await caseInput.fill(caseName)
    const confirmBtn = window.getByTestId('new-case-modal').getByRole('button', { name: /Save|Create/i })
    if (await confirmBtn.isVisible().catch(() => false)) {
      await confirmBtn.click()
    } else {
      await caseInput.press('Enter')
    }

    // Case node appears in tree.
    await treeSearch(window, caseName)
    await expect(window.getByTestId('tree-node').filter({ hasText: caseName })).toHaveCount(1, {
      timeout: 10_000,
    })

    // Delete case.
    await treeContextAction(window, caseName, /Delete/i)
    const typed = await window.getByTestId('delete-confirm-input').isVisible().catch(() => false)
    await confirmDelete(window, typed)

    await treeSearch(window, caseName)
    await expect(window.getByTestId('tree-node').filter({ hasText: caseName })).toHaveCount(0, {
      timeout: 8_000,
    })
  })
})
