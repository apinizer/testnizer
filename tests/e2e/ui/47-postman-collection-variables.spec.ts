/**
 * Issue #281 — Postman collection variables are Testnizer project variables
 * ("Globals"): always active, below the environment.
 *
 *  1. A collection imported while ANOTHER environment is active: its
 *     variables resolve on Send at once (they used to land in an inactive
 *     "<collection> (imported)" environment and stayed unresolved).
 *  2. "Move to Globals" on an environment (the way out for those old
 *     "(imported)" environments): the variables move, the environment is
 *     deleted only after the confirm, and Send resolves them afterwards.
 *
 * The collection file is picked through the REAL `import:openFile` IPC (the
 * main process's dialog is patched), like spec 41. Environments are created
 * and removed through the UI so the renderer store and the DB never drift for
 * the specs that run after this one in the shared Electron instance.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { expect, type ElectronApplication, type Page } from '@playwright/test'
import { uiTest } from './_setup'
import {
  dismissOverlays,
  ensureCanonicalProject,
  navigateSidebar,
  openHttpRequestTab,
} from '../helpers/ui/bootstrap'
import { finishImportWizard, openImportDropdown } from '../helpers/ui/import-flow'
import {
  getActiveProjectId,
  listEnvironmentsByProject,
  listEnvVariables,
  listGlobalVariablesByProject,
} from '../helpers/ui/assert-ipc'
import {
  addVariable,
  closeEnvModal,
  createEnvironment,
  openEnvModal,
  selectEnvironmentInModal,
  setActiveEnvironment,
  switchEnvironment,
} from '../helpers/ui/env'
import { fillUrl } from '../helpers/ui/request-flow'
import { sendAndReadBody } from '../helpers/ui/http-extra'
import { localHttpBin } from '../helpers/test-servers'

const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
const SCHEMA = 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json'

type EnvRow = { id: string; name: string; is_active: number }
type GlobalRow = { id: string; key: string; value: string; initial_value?: string | null }

/** Make the next open-file dialog return `filePath`; returns the restore function. */
async function pickFileWithDialog(
  app: ElectronApplication,
  filePath: string,
): Promise<() => Promise<void>> {
  await app.evaluate(({ dialog }, p) => {
    const d = dialog as unknown as Record<string, unknown>
    if (!d.__orig281) d.__orig281 = d.showOpenDialog
    d.showOpenDialog = async () => ({ canceled: false, filePaths: [p] })
  }, filePath)
  return async () => {
    await app.evaluate(({ dialog }) => {
      const d = dialog as unknown as Record<string, unknown>
      if (d.__orig281) {
        d.showOpenDialog = d.__orig281
        delete d.__orig281
      }
    })
  }
}

/** Delete an environment through the modal (store and DB stay in step). */
async function deleteEnvViaUi(page: Page, name: string): Promise<void> {
  await openEnvModal(page)
  await selectEnvironmentInModal(page, name)
  await page.getByTestId('env-delete').click()
  await page.getByTestId('delete-confirm-btn').click()
  await expect(
    page.getByTestId('environment-modal').getByRole('button', { name, exact: true }),
  ).toHaveCount(0, { timeout: 8_000 })
  await closeEnvModal(page)
}

/** Project variables are keyed by random names here; dropping the rows is enough. */
async function deleteGlobals(page: Page, ids: string[]): Promise<void> {
  await page.evaluate(async (list) => {
    const api = (
      window as unknown as { api: { globalVariable: { delete: (id: string) => Promise<unknown> } } }
    ).api
    for (const id of list) await api.globalVariable.delete(id)
  }, ids)
}

/** Send `{{key}}/get?pm47=1` from a fresh HTTP tab; 200 only if `{{key}}` resolved. */
async function sendThroughVariable(page: Page, key: string): Promise<number> {
  await openHttpRequestTab(page)
  await expect(page.getByTestId('send-btn')).toBeVisible({ timeout: 10_000 })
  await fillUrl(page, `{{${key}}}/get?pm47=1`)
  const { status } = await sendAndReadBody(page)
  return status
}

uiTest.describe('Issue #281 — Postman collection variables are project variables', () => {
  uiTest.beforeEach(async ({ window }) => {
    await dismissOverlays(window)
    await ensureCanonicalProject(window)
    await navigateSidebar(window, 'apis')
  })

  uiTest(
    'a collection imported while another environment is active: Send resolves its variables',
    async ({ app, window }) => {
      const projectId = await getActiveProjectId(window)
      const before = (await listEnvironmentsByProject(window, projectId)) as EnvRow[]
      const previouslyActive = before.find((e) => e.is_active === 1)?.name
      const key = `pm47base_${uid().replace(/\W/g, '_')}`
      const envName = `Other 47 ${uid()}`
      const collName = `PM47 ${uid()}`
      const file = path.join(os.tmpdir(), `testnizer-281-${uid()}.postman_collection.json`)
      fs.writeFileSync(
        file,
        JSON.stringify({
          info: { name: collName, schema: SCHEMA },
          variable: [{ key, value: localHttpBin() }],
          item: [{ name: 'Get', request: { method: 'GET', url: `{{${key}}}/get` } }],
        }),
      )
      // Another environment is active — the old model hid the variables then.
      await openEnvModal(window)
      await createEnvironment(window, envName)
      await setActiveEnvironment(window)
      await closeEnvModal(window)
      await expect(window.getByTestId('footer-env')).toContainText(envName)

      const restore = await pickFileWithDialog(app, file)
      const globalIds: string[] = []
      try {
        await openImportDropdown(window, /Postman/i)
        const modal = window.getByTestId('import-modal')
        await modal.getByRole('button', { name: /Click to select a/i }).click()
        await expect(modal.getByText(/Ready to import/i)).toBeVisible({ timeout: 15_000 })
        await modal.getByPlaceholder('Folder name').fill(collName)
        await modal.getByRole('button', { name: /^Import$/i }).click()
        await finishImportWizard(window)

        // No "<collection> (imported)" environment any more.
        const envs = (await listEnvironmentsByProject(window, projectId)) as EnvRow[]
        expect(envs.some((e) => e.name === `${collName} (imported)`)).toBe(false)
        const row = ((await listGlobalVariablesByProject(window, projectId)) as GlobalRow[]).find(
          (g) => g.key === key,
        )
        expect(row?.value).toBe(localHttpBin())
        if (row) globalIds.push(row.id)

        // Send resolves it while "Other 47" is still the active environment.
        await expect(window.getByTestId('footer-env')).toContainText(envName)
        expect(await sendThroughVariable(window, key)).toBe(200)
      } finally {
        await restore()
        fs.rmSync(file, { force: true })
        await deleteGlobals(window, globalIds)
        await deleteEnvViaUi(window, envName)
        if (previouslyActive) await switchEnvironment(window, previouslyActive)
      }
    },
  )

  uiTest(
    'Move to Globals: variables move, the environment goes only after the confirm',
    async ({ window }) => {
      const projectId = await getActiveProjectId(window)
      const key = `pm47moved_${uid().replace(/\W/g, '_')}`
      const envName = `Legacy 47 (imported) ${uid()}`
      const globalIds: string[] = []
      let deleted = false
      await openEnvModal(window)
      await createEnvironment(window, envName)
      await addVariable(window, { key, initialValue: localHttpBin() })
      const envId = ((await listEnvironmentsByProject(window, projectId)) as EnvRow[]).find(
        (e) => e.name === envName,
      )!.id
      // The row is written through IPC; wait until it is in the DB.
      await expect
        .poll(async () =>
          ((await listEnvVariables(window, envId)) as Array<{ key: string }>).some(
            (v) => v.key === key,
          ),
        )
        .toBe(true)
      try {
        await window.getByTestId('env-move-to-project-vars').click()
        // Nothing is deleted before the confirm.
        await expect(window.getByTestId('delete-confirm-btn')).toBeVisible({ timeout: 10_000 })
        expect(
          ((await listEnvironmentsByProject(window, projectId)) as EnvRow[]).some(
            (e) => e.id === envId,
          ),
        ).toBe(true)
        await window.getByTestId('delete-confirm-btn').click()
        await expect
          .poll(async () =>
            ((await listEnvironmentsByProject(window, projectId)) as EnvRow[]).some(
              (e) => e.id === envId,
            ),
          )
          .toBe(false)
        deleted = true
        const row = ((await listGlobalVariablesByProject(window, projectId)) as GlobalRow[]).find(
          (g) => g.key === key,
        )
        expect(row?.value || row?.initial_value).toBe(localHttpBin())
        if (row) globalIds.push(row.id)
        await closeEnvModal(window)

        expect(await sendThroughVariable(window, key)).toBe(200)
      } finally {
        await deleteGlobals(window, globalIds)
        if (!deleted) {
          await closeEnvModal(window).catch(() => {})
          await deleteEnvViaUi(window, envName)
        }
      }
    },
  )
})
