/**
 * Issue #277 — export the project as Postman v3 from the UI, walked end to
 * end in the real app:
 *
 *   an HTTP request in a folder (Ctrl+S) → APIs tree project root → Export →
 *   "Postman v3 (folder)" → native folder dialog (stubbed in main to a temp
 *   dir) → the Native Git layout is written with the request under its folder;
 *   → Export → "Postman v3 (JSON)" → native save dialog (stubbed) → one v3
 *   JSON file with the request; Environments modal → Globals → "Export
 *   Globals" → a Postman globals file.
 *
 * Before #277 neither v3 entry existed and the globals pane had no export.
 * The `ui` project shares ONE Electron instance and the canonical project:
 * the export holds the whole project (every other spec's rows too) — the test
 * looks only for its own request; the folder is deleted in afterAll and every
 * dialog stub is restored in `finally`.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { expect, type ElectronApplication, type Page } from '@playwright/test'
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
import { openEnvModal, closeEnvModal } from '../helpers/ui/env'
import { localHttpBin } from '../helpers/test-servers'

const uid = (): string => `${Date.now()}`.slice(-7) + Math.random().toString(36).slice(2, 5)
const createdFolderIds: string[] = []
const activeTab = (page: Page) => page.locator('[data-testid="endpoint-tab"][data-active="true"]')
const treeRow = (page: Page, label: string) =>
  page.getByTestId('tree-node').filter({ has: page.getByText(label, { exact: true }) })

/** Project root (first tree row) → Export → the format's submenu entry, by test id. */
async function exportFormat(page: Page, format: string): Promise<void> {
  await page.getByTestId('tree-node').first().click({ button: 'right' })
  const menu = page.locator('[data-context-menu]')
  await menu.getByRole('button', { name: /^Export$/ }).hover()
  await menu.getByTestId(`tree-export-format-${format}`).click()
}

const written = (dir: string): string[] =>
  fs.readdirSync(dir).filter((n) => !n.startsWith('.testnizer-export-'))

function findFile(root: string, baseName: string): string | null {
  for (const e of fs.readdirSync(root, { withFileTypes: true })) {
    const p = path.join(root, e.name)
    if (e.isDirectory()) {
      const hit = findFile(p, baseName)
      if (hit) return hit
    } else if (e.name === baseName) return p
  }
  return null
}

async function stubDialog(
  app: ElectronApplication,
  kind: 'open' | 'save',
  target: string,
): Promise<() => Promise<void>> {
  await app.evaluate(
    ({ dialog }, { kind, target }) => {
      const d = dialog as unknown as Record<string, unknown>
      const key = kind === 'open' ? 'showOpenDialog' : 'showSaveDialog'
      d[`__e277_${key}`] = d[key]
      d[key] =
        kind === 'open'
          ? async () => ({ canceled: false, filePaths: [target] })
          : async () => ({ canceled: false, filePath: target })
    },
    { kind, target },
  )
  return async () => {
    await app.evaluate(({ dialog }, kind) => {
      const d = dialog as unknown as Record<string, unknown>
      const key = kind === 'open' ? 'showOpenDialog' : 'showSaveDialog'
      if (d[`__e277_${key}`]) {
        d[key] = d[`__e277_${key}`]
        delete d[`__e277_${key}`]
      }
    }, kind)
  }
}

uiTest.describe('Postman v3 export (issue #277)', () => {
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
          await api?.folder?.delete?.(id)
        } catch {
          /* already gone */
        }
      }
    }, createdFolderIds)
    await refreshWorkspaceTree(window).catch(() => {})
    await treeClearSearch(window).catch(() => {})
  })

  uiTest(
    'tree root Export → Postman v3 (folder) and (JSON) both carry the saved request',
    async ({ app, window }) => {
      const id = uid()
      const folderName = `EXP277 ${id}`
      const requestName = `exp277x${id}`
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
      await expect(activeTab(window)).toHaveAttribute('data-tab-name', requestName, {
        timeout: 10_000,
      })
      await treeClearSearch(window)

      // ── 2. Postman v3 (folder) ──
      const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'testnizer-277-'))
      try {
        let restore = await stubDialog(app, 'open', parent)
        try {
          await exportFormat(window, 'postman-v3-folder')
          // The writer stages in a hidden `.testnizer-export-*` dir, then renames.
          await expect.poll(() => written(parent).length, { timeout: 15_000 }).toBe(1)
        } finally {
          await restore()
        }
        const root = path.join(parent, written(parent)[0])
        await expect(window.getByText(`Exported ${path.basename(root)}`).first()).toBeVisible({
          timeout: 5_000,
        })
        expect(fs.existsSync(path.join(root, 'postman', 'collections'))).toBe(true)
        const reqFile = findFile(root, `${requestName}.request.yaml`)
        expect(reqFile, 'request file written').toBeTruthy()
        // Under its folder, in the v3 YAML shape.
        expect(path.basename(path.dirname(reqFile!))).toBe(folderName)
        const yaml = fs.readFileSync(reqFile!, 'utf-8')
        expect(yaml).toMatch(/^\$kind: http-request$/m)
        expect(yaml).toContain(`/api/${requestName}`)
        expect(yaml).not.toContain('enc:v1:')

        // ── 3. Postman v3 (JSON) ──
        const outFile = path.join(parent, 'project.postman_collection.v3.json')
        restore = await stubDialog(app, 'save', outFile)
        try {
          await exportFormat(window, 'postman-v3')
          await expect.poll(() => fs.existsSync(outFile), { timeout: 15_000 }).toBe(true)
        } finally {
          await restore()
        }
        const doc = JSON.parse(fs.readFileSync(outFile, 'utf-8')) as {
          $kind: string
          items: Array<{ $kind: string; name: string; url?: string; items?: unknown[] }>
        }
        expect(doc.$kind).toBe('collection')
        type Item = { $kind: string; name: string; url?: string; items?: Item[] }
        const find = (items: Item[] | undefined): Item | undefined => {
          for (const it of items ?? []) {
            if (it.name === requestName) return it
            const hit = find(it.items)
            if (hit) return hit
          }
          return undefined
        }
        const folder = (doc.items as Item[]).find((i) => i.name === folderName)
        expect(folder?.$kind).toBe('collection')
        const item = find(folder?.items)
        expect(item?.$kind).toBe('http-request')
        expect(item?.url).toContain(`/api/${requestName}`)
      } finally {
        fs.rmSync(parent, { recursive: true, force: true })
      }
    },
  )

  uiTest(
    'Environments modal → Globals → Export Globals writes a Postman globals file',
    async ({ app, window }) => {
      const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'testnizer-277g-'))
      const outFile = path.join(outDir, 'globals.testnizer_globals.json')
      const restore = await stubDialog(app, 'save', outFile)
      try {
        await openEnvModal(window)
        await window.getByTestId('env-globals-nav').click()
        const btn = window.getByTestId('env-export-globals')
        await expect(btn).toBeEnabled({ timeout: 5_000 })
        await btn.click()
        await expect.poll(() => fs.existsSync(outFile), { timeout: 10_000 }).toBe(true)
        const doc = JSON.parse(fs.readFileSync(outFile, 'utf-8')) as Record<string, unknown>
        expect(doc._postman_variable_scope).toBe('globals')
        expect(typeof doc._postman_exported_at).toBe('string')
        expect(Array.isArray(doc.values)).toBe(true)
        await closeEnvModal(window)
      } finally {
        await restore()
        fs.rmSync(outDir, { recursive: true, force: true })
      }
    },
  )
})
