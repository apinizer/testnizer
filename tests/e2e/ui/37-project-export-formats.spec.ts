/**
 * Issue #208 (unblocks QA on #197) — export a whole project as Postman v2.1
 * from the UI, walked end to end in the real app:
 *
 *   create an HTTP request in a folder → Ctrl+S → APIs tree project root →
 *   Export → Postman v2.1 → native save dialog (stubbed in main to a temp
 *   path) → the request is in the file under its folder → re-import the
 *   exported folder → the request shows up again in the tree.
 *
 * Before the fix every project-level Export wrote Testnizer JSON only; the
 * Postman handler was reachable from IPC but from no button, so this could not
 * be checked by a tester at all.
 *
 * The `ui` project shares ONE Electron instance and the canonical project:
 *  - the re-import uses ONLY this test's folder from the exported file (the
 *    file holds the whole project — importing all of it would duplicate every
 *    other spec's requests and break their label-count assertions);
 *  - both folders are deleted in afterAll, the dialog stub is restored in
 *    `finally`, the tree filter is cleared.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { expect, type Page } from '@playwright/test'
import { uiTest } from './_setup'
import {
  closeAllTabs,
  dismissOverlays,
  ensureCanonicalProject,
  navigateSidebar,
} from '../helpers/ui/bootstrap'
import { fillUrl } from '../helpers/ui/request-flow'
import { saveInPlace } from '../helpers/ui/save-flow'
import { createFolder, getActiveProjectId } from '../helpers/ui/assert-ipc'
import { refreshWorkspaceTree } from '../helpers/ui/import-flow'
import { treeAddHttpRequest, treeClearSearch, treeSearch } from '../helpers/ui/tree'
import { clickContextSubmenuItem } from '../helpers/ui/context-menu'
import { localHttpBin } from '../helpers/test-servers'

const uid = (): string => `${Date.now()}`.slice(-7) + Math.random().toString(36).slice(2, 5)

/** Folders created here — removed in afterAll (their requests go with them). */
const createdFolderIds: string[] = []

const activeTab = (page: Page) => page.locator('[data-testid="endpoint-tab"][data-active="true"]')

/** A tree row whose LABEL is exactly `label` (the row text also holds the method badge). */
const treeRow = (page: Page, label: string) =>
  page.getByTestId('tree-node').filter({ has: page.getByText(label, { exact: true }) })

interface PostmanItem {
  name: string
  item?: PostmanItem[]
  request?: { method?: string; url?: string | { raw?: string } }
}
interface PostmanCollection {
  info?: { name?: string; schema?: string }
  item?: PostmanItem[]
}

const rawUrl = (r: PostmanItem['request']): string =>
  typeof r?.url === 'string' ? r.url : (r?.url?.raw ?? '')

uiTest.describe('project export formats (issue #208)', () => {
  uiTest.beforeEach(async ({ window }) => {
    await dismissOverlays(window)
    await ensureCanonicalProject(window)
    await navigateSidebar(window, 'apis')
  })

  uiTest.afterEach(async ({ window }) => {
    await closeAllTabs(window)
  })

  uiTest.afterAll(async ({ window }) => {
    await window.evaluate(async (ids) => {
      const api = (
        window as unknown as { api?: { folder?: { delete?: (id: string) => Promise<unknown> } } }
      ).api
      for (const id of ids) {
        try {
          if (typeof api?.folder?.delete === 'function') await api.folder.delete(id)
        } catch {
          /* already gone */
        }
      }
    }, createdFolderIds)
    await refreshWorkspaceTree(window).catch(() => {})
    await treeClearSearch(window).catch(() => {})
  })

  uiTest(
    'Ctrl+S request → tree root Export → Postman v2.1 → file has it under its folder → re-import',
    async ({ app, window }) => {
      const id = uid()
      const folderName = `EXP208 ${id}`
      const requestName = `exp208x${id}`
      const origin = new URL(localHttpBin()).origin
      const projectId = await getActiveProjectId(window)
      createdFolderIds.push(await createFolder(window, projectId, folderName))
      await refreshWorkspaceTree(window)

      // ── 1. An HTTP request in the folder, saved with Ctrl+S ──
      await treeSearch(window, folderName)
      await expect(treeRow(window, folderName)).toBeVisible({ timeout: 10_000 })
      await treeAddHttpRequest(window, folderName)
      await expect(activeTab(window)).toHaveAttribute('data-tab-name', 'New Endpoint', {
        timeout: 10_000,
      })
      await fillUrl(window, `${origin}/api/${requestName}`)
      await saveInPlace(window)
      // Issue #201: the placeholder name is replaced by the last path segment.
      await expect(activeTab(window)).toHaveAttribute('data-tab-name', requestName, {
        timeout: 10_000,
      })
      await expect(treeRow(window, requestName)).toHaveCount(1, { timeout: 10_000 })
      await treeClearSearch(window)

      // ── 2. Export the project as Postman v2.1 from the tree root ──
      const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'testnizer-208-'))
      const outFile = path.join(outDir, 'project.postman_collection.json')
      await app.evaluate(({ dialog }, fp) => {
        const d = dialog as unknown as { showSaveDialog: unknown; __e208_orig?: unknown }
        d.__e208_orig = d.showSaveDialog
        d.showSaveDialog = async () => ({ canceled: false, filePath: fp })
      }, outFile)

      let collection: PostmanCollection
      try {
        // The project root is always the first row.
        await window.getByTestId('tree-node').first().click({ button: 'right' })
        await clickContextSubmenuItem(window, /^Export$/, 'Postman v2.1')
        await expect.poll(() => fs.existsSync(outFile), { timeout: 10_000 }).toBe(true)
        // Title names only the file; the full path is the one-line description.
        await expect(window.getByText(`Exported ${path.basename(outFile)}`).first()).toBeVisible({
          timeout: 5_000,
        })
        collection = JSON.parse(fs.readFileSync(outFile, 'utf-8')) as PostmanCollection
      } finally {
        await app.evaluate(({ dialog }) => {
          const d = dialog as unknown as { showSaveDialog: unknown; __e208_orig?: unknown }
          if (d.__e208_orig) {
            d.showSaveDialog = d.__e208_orig
            delete d.__e208_orig
          }
        })
        fs.rmSync(outDir, { recursive: true, force: true })
      }

      // ── 3. The saved request is in the file, under its folder ──
      expect(collection.info?.schema).toMatch(/v2\.1\.0/)
      const folderItem = (collection.item ?? []).find((i) => i.name === folderName)
      expect(folderItem, `folder "${folderName}" missing from the export`).toBeDefined()
      const reqItem = (folderItem?.item ?? []).find((i) => i.name === requestName)
      expect(reqItem, `request "${requestName}" missing under its folder`).toBeDefined()
      expect(reqItem?.request?.method).toBe('GET')
      expect(rawUrl(reqItem?.request)).toContain(`/api/${requestName}`)

      // ── 4. Re-import (this test's folder only) → the request is back ──
      const reimportFolderName = `EXP208 reimport ${id}`
      const reimportFolderId = await createFolder(window, projectId, reimportFolderName)
      createdFolderIds.push(reimportFolderId)
      const content = JSON.stringify({ info: collection.info, item: [folderItem] })
      const res = await window.evaluate(
        async ({ pid, fid, text }) => {
          const w = window as unknown as {
            api: {
              importExport: {
                importPostman: (p: {
                  projectId: string
                  content: string
                  folderId?: string | null
                }) => Promise<{
                  success: boolean
                  data?: { success?: boolean; error?: string }
                  error?: string
                }>
              }
            }
          }
          return w.api.importExport.importPostman({ projectId: pid, content: text, folderId: fid })
        },
        { pid: projectId, fid: reimportFolderId, text: content },
      )
      expect(res.success, res.error).toBe(true)
      expect(res.data?.success, res.data?.error).not.toBe(false)

      await refreshWorkspaceTree(window)
      // Original + the re-imported copy — both named after the request.
      await treeSearch(window, requestName)
      await expect(treeRow(window, requestName)).toHaveCount(2, { timeout: 10_000 })
      await treeClearSearch(window)
    },
  )
})
