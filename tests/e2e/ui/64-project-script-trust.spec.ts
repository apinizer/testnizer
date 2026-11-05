/**
 * A script from a project that came from outside does not run until the user
 * allows it on this computer.
 *
 * Import a scripted collection through the real UI → Send, "Not now": the server
 * receives nothing and the tab says why → Allow: the script runs, seen in the URL
 * the server receives. The same for Run, and leaving the tab while the dialog is
 * open (docs/e2e/test-rules.md rule 1). The dialog is native; the stub answers it
 * (`helpers/ui/script-trust.ts`). The server is this spec's own, so "received
 * nothing" is what it saw.
 */
import fs from 'node:fs'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { expect, type ElectronApplication, type Page } from '@playwright/test'
import { uiTest } from './_setup'
import {
  closeAllTabs,
  dismissOverlays,
  ensureCanonicalProject,
  navigateSidebar,
  openHttpRequestTab,
} from '../helpers/ui/bootstrap'
import { openImportDropdown, refreshWorkspaceTree } from '../helpers/ui/import-flow'
import { getActiveProjectId } from '../helpers/ui/assert-ipc'
import { treeClearSearch, treeOpenNode } from '../helpers/ui/tree'
import {
  openCollectionRunner,
  selectOnlyRunnerEndpoints,
  startRunnerTabRun,
  waitRunnerTabComplete,
} from '../helpers/ui/runner-flow'
import {
  answerHeldScriptTrustDialog,
  blockProjectScripts,
  resetScriptTrustDialog,
  scriptTrustPrompts,
  scriptTrustStatus,
  stubScriptTrustDialog,
  waitForHeldScriptTrustDialog,
} from '../helpers/ui/script-trust'

const uid = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
const FOLDER_NAME = `Trust ${uid}`
const SCRIPTED = `Scripted ${uid}`
const OTHER = `Other ${uid}`
const REFUSED = /not allowed on this computer/i

/** The script's only effect: a variable the URL reads, so the server sees it ran. */
const SCRIPT = "pm.variables.set('trust_canary', 'ran')"

async function pickFileWithDialog(
  app: ElectronApplication,
  filePath: string,
): Promise<() => Promise<void>> {
  await app.evaluate(({ dialog }, p) => {
    const d = dialog as unknown as Record<string, unknown>
    if (!d.__orig64) d.__orig64 = d.showOpenDialog
    d.showOpenDialog = async () => ({ canceled: false, filePaths: [p] })
  }, filePath)
  return async () => {
    await app.evaluate(({ dialog }) => {
      const d = dialog as unknown as Record<string, unknown>
      if (d.__orig64) {
        d.showOpenDialog = d.__orig64
        delete d.__orig64
      }
    })
  }
}

async function importCollection(
  window: Page,
  app: ElectronApplication,
  file: string,
): Promise<void> {
  const restore = await pickFileWithDialog(app, file)
  try {
    await openImportDropdown(window, /Postman/i)
    const modal = window.getByTestId('import-modal')
    await modal.getByRole('button', { name: /Click to select a/i }).click()
    await expect(modal.getByText(/Ready to import/i)).toBeVisible({ timeout: 15_000 })
    await modal.getByPlaceholder('Folder name').fill(FOLDER_NAME)
    await modal.getByRole('button', { name: /^Import$/i }).click()
    // The report appears only when there is something to report; otherwise the modal closes.
    const report = window.getByTestId('import-result')
    await expect
      .poll(async () => (await report.isVisible()) || !(await modal.isVisible()), {
        timeout: 30_000,
      })
      .toBe(true)
    if (await report.isVisible()) await window.getByTestId('import-result-done').click()
    await expect(modal).toBeHidden({ timeout: 10_000 })
  } finally {
    await restore()
  }
}

const tabNamed = (window: Page, name: string) =>
  window.locator(`[data-testid="endpoint-tab"][data-tab-name="${name}"]`)

/** The tree reads the row before it opens the tab: Send only once it is this tab. */
async function openRequest(window: Page, name: string): Promise<void> {
  await treeOpenNode(window, name)
  await expect(tabNamed(window, name)).toHaveAttribute('data-active', 'true', { timeout: 10_000 })
}

uiTest.describe('Project script trust', () => {
  uiTest.describe.configure({ mode: 'serial' })

  let server: http.Server
  let received: string[] = []
  let dir = ''
  let collectionFile = ''
  let scriptFreeFile = ''
  let projectId = ''

  uiTest.beforeAll(async ({ app, window }) => {
    await new Promise<void>((resolve) => {
      server = http.createServer((req, res) => {
        received.push(req.url ?? '/')
        req.resume()
        req.on('end', () => {
          res.writeHead(200, { 'Content-Type': 'text/plain' })
          res.end('ok')
        })
      })
      server.listen(0, '127.0.0.1', () => resolve())
    })
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
    const collection = (items: unknown[]): string =>
      JSON.stringify({
        info: {
          name: 'Trust',
          schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
        },
        item: items,
      })
    const scripted = (name: string, route: string): unknown => ({
      name,
      event: [{ listen: 'prerequest', script: { type: 'text/javascript', exec: [SCRIPT] } }],
      request: { method: 'GET', url: `${base}/${route}/{{trust_canary}}` },
    })
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'testnizer-64-'))
    collectionFile = path.join(dir, 'scripted.postman_collection.json')
    fs.writeFileSync(
      collectionFile,
      collection([scripted(SCRIPTED, 'hit'), scripted(OTHER, 'other')]),
    )
    scriptFreeFile = path.join(dir, 'plain.postman_collection.json')
    fs.writeFileSync(
      scriptFreeFile,
      collection([{ name: `Plain ${uid}`, request: { method: 'GET', url: `${base}/plain` } }]),
    )
    await dismissOverlays(window)
    await ensureCanonicalProject(window)
    projectId = await getActiveProjectId(window)
    await resetScriptTrustDialog(app)
  })

  uiTest.afterAll(async ({ app, window }) => {
    await closeAllTabs(window).catch(() => {})
    await resetScriptTrustDialog(app).catch(() => {})
    await window
      .evaluate(
        async ({ pid, folder }) => {
          const api = (
            window as unknown as {
              api: {
                folder: {
                  list: (p: string) => Promise<{ data?: Array<{ id: string; name: string }> }>
                  delete: (id: string) => Promise<unknown>
                }
                projectTrust: {
                  ensure: (id: string, o: { hasScript: boolean }) => Promise<unknown>
                }
              }
            }
          ).api
          for (const f of (await api.folder.list(pid)).data ?? []) {
            if (f.name === folder) await api.folder.delete(f.id)
          }
          // Leave the shared project as it was found.
          await api.projectTrust.ensure(pid, { hasScript: true })
        },
        { pid: projectId, folder: FOLDER_NAME },
      )
      .catch(() => {})
    await refreshWorkspaceTree(window).catch(() => {})
    await treeClearSearch(window).catch(() => {})
    await new Promise<void>((resolve) => server.close(() => resolve()))
    fs.rmSync(dir, { recursive: true, force: true })
  })

  uiTest.beforeEach(() => {
    received = []
  })

  uiTest('a script-free import does not mark the project or ask', async ({ app, window }) => {
    await navigateSidebar(window, 'apis')
    await importCollection(window, app, scriptFreeFile)
    expect((await scriptTrustStatus(window, projectId)).blocked).toBe(false)
    expect(await scriptTrustPrompts(app)).toEqual([])
  })

  uiTest(
    'Send: Not now sends nothing and says why; Allow runs the script',
    async ({ app, window }) => {
      await navigateSidebar(window, 'apis')
      await importCollection(window, app, collectionFile)
      const status = await scriptTrustStatus(window, projectId)
      expect(status.blocked).toBe(true)
      expect(status.scriptCount).toBeGreaterThanOrEqual(2)
      expect(await scriptTrustPrompts(app), 'importing asks nothing').toEqual([])

      await refreshWorkspaceTree(window)
      await openRequest(window, SCRIPTED)

      await stubScriptTrustDialog(app, 'notNow')
      await window.getByTestId('send-btn').click()
      const errorPanel = window.getByTestId('response-error')
      await expect(errorPanel).toBeVisible({ timeout: 15_000 })
      await expect(errorPanel).toContainText(REFUSED)
      expect(received).toEqual([])

      const shown = await scriptTrustPrompts(app)
      expect(shown).toHaveLength(1)
      expect(shown[0].detail).toMatch(/\d+ scripts?/)
      expect(shown[0].defaultId).toBe(1)
      expect(shown[0].cancelId).toBe(1)
      expect((await scriptTrustStatus(window, projectId)).blocked).toBe(true)

      await stubScriptTrustDialog(app, 'allow')
      await window.getByTestId('send-btn').click()
      await expect(window.getByTestId('response-status')).toContainText('200', { timeout: 15_000 })
      expect(received).toEqual(['/hit/ran'])
      expect((await scriptTrustStatus(window, projectId)).blocked).toBe(false)

      // Allowed stays allowed: the next Send does not ask.
      await window.getByTestId('send-btn').click()
      await expect.poll(() => received.length).toBe(2)
      expect(await scriptTrustPrompts(app)).toHaveLength(2)
    },
  )

  uiTest(
    'Send: Not now after moving to another tab lands on the tab that asked',
    async ({ app, window }) => {
      await navigateSidebar(window, 'apis')
      await blockProjectScripts(window, projectId)
      await openRequest(window, SCRIPTED)

      await stubScriptTrustDialog(app, 'hold')
      await window.getByTestId('send-btn').click()
      await waitForHeldScriptTrustDialog(app)

      await openHttpRequestTab(window)
      await answerHeldScriptTrustDialog(app, 'notNow')
      // Every open tab stays mounted, so this is about what is on screen.
      await expect(window.getByTestId('response-error')).toBeHidden()
      expect(received).toEqual([])

      await tabNamed(window, SCRIPTED).click()
      await expect(window.getByTestId('response-error')).toContainText(REFUSED, { timeout: 10_000 })
      expect(received).toEqual([])
    },
  )

  uiTest(
    'Run: Not now does not start; Allow runs, also when the user left the tab',
    async ({ app, window }) => {
      await navigateSidebar(window, 'apis')
      await blockProjectScripts(window, projectId)

      await openCollectionRunner(window)
      await selectOnlyRunnerEndpoints(window, uid)
      const runnerName = (await window
        .locator('[data-testid="endpoint-tab"][data-active="true"]')
        .getAttribute('data-tab-name')) as string

      await stubScriptTrustDialog(app, 'notNow')
      await startRunnerTabRun(window)
      await expect(window.locator('[data-sonner-toast]').filter({ hasText: REFUSED })).toBeVisible({
        timeout: 10_000,
      })
      await expect(window.getByTestId('runner-stop')).toHaveCount(0)
      expect(received).toEqual([])

      // The dialog stays open while the user goes elsewhere; the run keeps its tab.
      await stubScriptTrustDialog(app, 'hold')
      await startRunnerTabRun(window)
      await waitForHeldScriptTrustDialog(app)
      await openHttpRequestTab(window)
      await answerHeldScriptTrustDialog(app, 'allow')
      await expect
        .poll(() => received.filter((u) => u.endsWith('/ran')).length, { timeout: 20_000 })
        .toBeGreaterThan(0)

      await tabNamed(window, runnerName).click()
      await waitRunnerTabComplete(window)
      expect(received).toEqual(expect.arrayContaining(['/hit/ran', '/other/ran']))
    },
  )

  uiTest(
    'Project Settings: the row shows the state, Block and Allow change it',
    async ({ app, window }) => {
      await blockProjectScripts(window, projectId)
      await window.getByTestId('nav-settings').click()
      await expect(window.getByTestId('project-detail-modal')).toBeVisible({ timeout: 8_000 })
      await window.getByTestId('project-detail-tab-general').click()
      const row = window.getByTestId('project-script-trust')
      await expect(row).toHaveAttribute('data-blocked', 'true')

      await stubScriptTrustDialog(app, 'notNow')
      await window.getByTestId('project-script-trust-allow').click()
      await expect.poll(async () => (await scriptTrustPrompts(app)).length).toBeGreaterThan(0)
      await expect(row).toHaveAttribute('data-blocked', 'true')

      await stubScriptTrustDialog(app, 'allow')
      await window.getByTestId('project-script-trust-allow').click()
      await expect(row).toHaveAttribute('data-blocked', 'false')
      expect((await scriptTrustStatus(window, projectId)).blocked).toBe(false)

      await window.getByTestId('project-script-trust-block').click()
      await expect(row).toHaveAttribute('data-blocked', 'true')
      await dismissOverlays(window)
    },
  )
})
