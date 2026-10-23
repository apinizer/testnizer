/**
 * Issue #276 — any single Postman file through the existing Import UI, with
 * no "which version?" question: a collection v1 (converted), a collection
 * v2.0 and a globals export (→ the "Globals" environment, no folder). Imports
 * that skipped or degraded something show the result step with the list.
 *
 * Fixtures: Postman's own transformer sample (Apache-2.0,
 * tests/fixtures/postman/transformer/README.md) — the same "Postman Echo"
 * collection as v1 and as v2.0 (23 requests, 11 examples).
 *
 * The file is picked through the REAL `import:openFile` IPC: the main
 * process's `dialog.showOpenDialog` is patched to return the fixture path
 * (the renderer-side `window.api` stub other specs use cannot replace a
 * contextBridge function in the production build).
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { expect, type ElectronApplication, type Page } from '@playwright/test'
import { uiTest } from './_setup'
import { dismissOverlays, ensureCanonicalProject, navigateSidebar } from '../helpers/ui/bootstrap'
import {
  finishImportWizard,
  openImportDropdown,
  refreshWorkspaceTree,
} from '../helpers/ui/import-flow'
import {
  getActiveProjectId,
  listEndpointsByProject,
  listEnvironmentsByProject,
  listEnvVariables,
} from '../helpers/ui/assert-ipc'
import { treeClearSearch, treeSearch } from '../helpers/ui/tree'

const TRANSFORMER = path.resolve(__dirname, '../../fixtures/postman/transformer')
const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`

/** Make the next open-file dialog return `filePath`; returns the restore function. */
async function pickFileWithDialog(
  app: ElectronApplication,
  filePath: string,
): Promise<() => Promise<void>> {
  await app.evaluate(({ dialog }, p) => {
    const d = dialog as unknown as Record<string, unknown>
    if (!d.__orig276) d.__orig276 = d.showOpenDialog
    d.showOpenDialog = async () => ({ canceled: false, filePaths: [p] })
  }, filePath)
  return async () => {
    await app.evaluate(({ dialog }) => {
      const d = dialog as unknown as Record<string, unknown>
      if (d.__orig276) {
        d.showOpenDialog = d.__orig276
        delete d.__orig276
      }
    })
  }
}

async function endpointNames(page: Page, projectId: string): Promise<string[]> {
  return ((await listEndpointsByProject(page, projectId)) as Array<{ name: string }>).map(
    (e) => e.name,
  )
}

/** Pick the file under the Postman card and import it into a new folder. */
async function importCollectionThroughUi(page: Page, folderName: string): Promise<void> {
  await openImportDropdown(page, /Postman/i)
  const modal = page.getByTestId('import-modal')
  await modal.getByRole('button', { name: /Click to select a/i }).click()
  await expect(modal.getByText(/Ready to import/i)).toBeVisible({ timeout: 15_000 })
  // No version question and no type-mismatch error for v1 / v2.0.
  await expect(modal.getByText(/mismatch/i)).toHaveCount(0)
  await modal.getByPlaceholder('Folder name').fill(folderName)
  await modal.getByRole('button', { name: /^Import$/i }).click()
}

uiTest.describe('Issue #276 — Postman v1 / v2.0 / globals through the Import UI', () => {
  uiTest.beforeEach(async ({ window }) => {
    await dismissOverlays(window)
    await ensureCanonicalProject(window)
    await navigateSidebar(window, 'apis')
  })

  uiTest(
    'a collection v1 is converted, listed in the tree, and the report is shown',
    async ({ app, window }) => {
      const projectId = await getActiveProjectId(window)
      const before = (await endpointNames(window, projectId)).length
      const restore = await pickFileWithDialog(app, path.join(TRANSFORMER, 'postman-echo.v1.json'))
      try {
        const folder = `PM v1 ${uid()}`
        await importCollectionThroughUi(window, folder)

        // The v1 conversion is reported → the result step, list behind a toggle.
        await expect(window.getByTestId('import-result')).toBeVisible({ timeout: 60_000 })
        await expect(window.getByTestId('import-result-summary')).toContainText('23')
        await window.getByTestId('import-warnings-toggle').click()
        await expect(window.getByTestId('import-warnings-list')).toContainText(
          /Converted from Postman collection v1/,
        )
        await window.getByTestId('import-result-done').click()
        await expect(window.getByTestId('import-modal')).toBeHidden({ timeout: 10_000 })

        const names = await endpointNames(window, projectId)
        expect(names.length - before).toBe(23)
        expect(names).toContain('Set Cookies')

        await refreshWorkspaceTree(window)
        await treeSearch(window, folder)
        await expect(
          window.getByTestId('tree-node').filter({ hasText: folder }).first(),
        ).toBeVisible({ timeout: 15_000 })
        await treeClearSearch(window)
      } finally {
        await restore()
      }
    },
  )

  uiTest('a collection v2.0 (no version question) lands in the tree', async ({ app, window }) => {
    const projectId = await getActiveProjectId(window)
    const before = (await endpointNames(window, projectId)).length
    const restore = await pickFileWithDialog(app, path.join(TRANSFORMER, 'postman-echo.v2.json'))
    try {
      const folder = `PM v2.0 ${uid()}`
      await importCollectionThroughUi(window, folder)
      await finishImportWizard(window)

      const names = await endpointNames(window, projectId)
      expect(names.length - before).toBe(23)

      await refreshWorkspaceTree(window)
      await treeSearch(window, folder)
      await expect(window.getByTestId('tree-node').filter({ hasText: folder }).first()).toBeVisible(
        { timeout: 15_000 },
      )
      await treeClearSearch(window)
    } finally {
      await restore()
    }
  })

  uiTest('a globals export becomes the "Globals" environment, no folder', async ({ app, window }) => {
    const projectId = await getActiveProjectId(window)
    const key = `g_${uid().replace(/\W/g, '_')}`
    const file = path.join(os.tmpdir(), `testnizer-276-${uid()}.postman_globals.json`)
    fs.writeFileSync(
      file,
      JSON.stringify({
        id: 'e2e-globals',
        name: 'My Workspace Globals',
        _postman_variable_scope: 'globals',
        values: [{ key, value: 'from-globals', enabled: true, type: 'default' }],
      }),
    )
    const restore = await pickFileWithDialog(app, file)
    try {
      await openImportDropdown(window, /Postman/i)
      const modal = window.getByTestId('import-modal')
      await modal.getByRole('button', { name: /Click to select a/i }).click()
      await expect(modal.getByTestId('import-env-note')).toBeVisible({ timeout: 15_000 })
      await expect(modal.getByPlaceholder('Folder name')).toBeHidden()
      await modal.getByRole('button', { name: /^Import$/i }).click()
      await finishImportWizard(window)

      const envs = (await listEnvironmentsByProject(window, projectId)) as Array<{
        id: string
        name: string
      }>
      const g = envs.find((e) => e.name === 'Globals')
      expect(g, 'Globals environment created').toBeTruthy()
      const vars = await listEnvVariables(window, g!.id)
      expect(vars.find((v) => v.key === key)?.value).toBe('from-globals')
    } finally {
      await restore()
      fs.rmSync(file, { force: true })
    }
  })
})
