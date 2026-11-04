/**
 * QA findings on 1.6.0, walked the way the tester walked them. Each one lived
 * BETWEEN features whose own tests were green:
 *
 *   1. Start a run, open another tab, come back. Workbench mounts only the
 *      active tab; the run's whole state died with RunnerTab while main kept
 *      going, so the Runner tab was blank and only the Console showed traffic.
 *   2. Import OpenAPI → folder → "Create mock server" → "Open in request tab".
 *      The import stores the full URL in `endpoints.path`; every mock test built
 *      its endpoint by hand with a clean `/orders`, and nothing fed one step's
 *      real output to the next.
 *
 * Cleanup: tabs force-closed; folder, requests and mock server deleted via IPC.
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
import { fillUrl, saveRequestToFolder } from '../helpers/ui/request-flow'
import {
  createFolder,
  getActiveProjectId,
  listSavedRequestsByProject,
} from '../helpers/ui/assert-ipc'
import {
  openCollectionRunner,
  readRunnerTabSummary,
  selectOnlyRunnerEndpoints,
  startRunnerTabRun,
  waitRunnerTabComplete,
} from '../helpers/ui/runner-flow'
import { importFixtureViaIpc, refreshWorkspaceTree } from '../helpers/ui/import-flow'
import { randomMockPort, stopMockServer } from '../helpers/ui/mock-flow'
import { treeClearSearch, treeContextAction, treeSearch } from '../helpers/ui/tree'
import { localHttpBin } from '../helpers/test-servers'

const uid = (): string => String(Date.now()).slice(-8)
const activeTab = (page: Page) => page.locator('[data-testid="endpoint-tab"][data-active="true"]')

type IpcResult<T> = { success: boolean; data?: T; error?: string }
type MockApi = {
  api: {
    mock: {
      server: {
        list: (p: string) => Promise<IpcResult<Array<{ id: string; name: string; port: number }>>>
        update: (id: string, patch: { port: number }) => Promise<IpcResult<unknown>>
        stop: (id: string) => Promise<unknown>
        delete: (id: string) => Promise<unknown>
      }
      endpoint: {
        list: (s: string) => Promise<IpcResult<Array<{ path: string; pathMode: string }>>>
      }
    }
    folder: { delete: (id: string) => Promise<unknown> }
    savedRequest: { delete: (id: string) => Promise<unknown> }
  }
}

function runHistoryTotal(page: Page, projectId: string): Promise<number> {
  return page.evaluate(async (pid) => {
    const w = window as unknown as {
      api: { runner: { history: (a: unknown) => Promise<IpcResult<{ total: number }>> } }
    }
    return (await w.api.runner.history({ projectId: pid, limit: 1 })).data?.total ?? 0
  }, projectId)
}

uiTest.describe('Tester journeys on 1.6.0', () => {
  uiTest.beforeEach(async ({ window }) => {
    await dismissOverlays(window)
    await ensureCanonicalProject(window)
    await navigateSidebar(window, 'apis')
  })

  uiTest(
    'a run keeps its screen across a tab switch, and finishes while away',
    async ({ window }) => {
      const stamp = uid()
      const folderName = `Trip ${stamp}`
      const names = [`Trip a ${stamp}`, `Trip b ${stamp}`, `Trip c ${stamp}`]
      const projectId = await getActiveProjectId(window)
      const folderId = await createFolder(window, projectId, folderName)

      try {
        for (const name of names) {
          await openHttpRequestTab(window)
          // Long enough to leave and come back on a slow CI runner (about 8x a laptop).
          await fillUrl(window, `${localHttpBin()}/delay/8?trip=${stamp}`)
          await saveRequestToFolder(window, name, folderName)
        }

        await openCollectionRunner(window)
        await selectOnlyRunnerEndpoints(window, stamp)
        const runnerTabName = (await activeTab(window).getAttribute('data-tab-name')) as string
        const runnerTab = window.locator(
          `[data-testid="endpoint-tab"][data-tab-name="${runnerTabName}"]`,
        )
        const runsBefore = await runHistoryTotal(window, projectId)
        await startRunnerTabRun(window)
        await expect(window.getByTestId('runner-stop')).toBeVisible({ timeout: 10_000 })

        // Away and back, run still going: progress and Stop are there, not a blank page.
        await openHttpRequestTab(window)
        await expect(window.getByTestId('runner-stop')).toHaveCount(0)
        // Tells a window too short for this machine apart from a screen that lost the run.
        expect(await runHistoryTotal(window, projectId), 'run ended before the return').toBe(
          runsBefore,
        )
        await runnerTab.click()
        await expect(window.getByTestId('runner-stop')).toBeVisible({ timeout: 5_000 })
        await expect(window.getByTestId('runner-results-nothing')).toHaveCount(0)

        // The rows that arrive after coming back still land on this screen.
        await expect(window.getByTestId('runner-results-list').getByText(names[0])).toBeVisible({
          timeout: 30_000,
        })

        // Away again, this time until the run has ended (a new history row).
        await openHttpRequestTab(window)
        await expect
          .poll(() => runHistoryTotal(window, projectId), { timeout: 60_000, intervals: [500] })
          .toBeGreaterThan(runsBefore)
        await runnerTab.click()

        // The final results are there without having watched the end.
        await waitRunnerTabComplete(window, 20_000)
        expect(await readRunnerTabSummary(window)).toEqual({ passed: 3, failed: 0 })
        for (const name of names) {
          await expect(window.getByTestId('runner-results-list').getByText(name)).toBeVisible()
        }
      } finally {
        await closeAllTabs(window).catch(() => {})
        const rows = (await listSavedRequestsByProject(window, projectId)) as Array<{
          id: string
          name: string
        }>
        await window
          .evaluate(
            async ({ ids, fid }) => {
              const w = window as unknown as MockApi
              for (const id of ids) await w.api.savedRequest.delete(id)
              await w.api.folder.delete(fid)
            },
            { ids: rows.filter((r) => names.includes(r.name)).map((r) => r.id), fid: folderId },
          )
          .catch(() => {})
      }
    },
  )

  uiTest('Import OpenAPI → mock from the folder → open in a request tab', async ({ window }) => {
    const folderName = `PetsMock ${uid()}`
    const projectId = await getActiveProjectId(window)
    const port = randomMockPort()

    try {
      // The real importer: `endpoints.path` = https://petstore.example.com/v1/pets/:petId
      await importFixtureViaIpc(window, 'openapi', 'openapi-3.0.json', folderName)
      await refreshWorkspaceTree(window)
      await treeSearch(window, folderName)
      await treeContextAction(window, folderName, /Create mock server/i)

      // The mock binds paths; the OpenAPI template became a `:param` it can match.
      const created = await window.evaluate(
        async ({ pid, name, p }) => {
          const w = window as unknown as MockApi
          for (let i = 0; i < 50; i++) {
            const servers = await w.api.mock.server.list(pid)
            const server = servers.data?.find((s) => s.name === name)
            const eps = server ? await w.api.mock.endpoint.list(server.id) : null
            // Endpoints arrive one by one, each with its responses: wait for the last.
            if (server && eps?.data?.some((e) => e.path === '/v1/pets/:petId')) {
              // 8080 may be taken on the machine running this.
              await w.api.mock.server.update(server.id, { port: p })
              return { id: server.id, endpoints: eps.data }
            }
            await new Promise((r) => setTimeout(r, 100))
          }
          return null
        },
        { pid: projectId, name: folderName, p: port },
      )
      expect(created).not.toBeNull()
      expect(created!.endpoints.map((e) => e.path).sort()).toEqual(
        expect.arrayContaining(['/v1/pets', '/v1/pets/:petId']),
      )
      expect(created!.endpoints.find((e) => e.path === '/v1/pets/:petId')?.pathMode).toBe('param')

      // The panel reloads its servers when it mounts: that picks up the new port.
      await navigateSidebar(window, 'apis')
      await treeClearSearch(window)
      await navigateSidebar(window, 'mocks')
      await window.getByText(folderName).first().click()

      // The reported URL: mock host + path, no second URL glued on.
      await window.getByText('/v1/pets/:petId').first().click()
      const openBtn = window.getByTestId('mock-endpoint-open-in-http')
      await expect(openBtn).toBeEnabled({ timeout: 10_000 })
      await openBtn.click()
      await expect(window.getByTestId('url-input')).toHaveValue(
        `http://127.0.0.1:${port}/v1/pets/:petId`,
        { timeout: 15_000 },
      )
      // A `:param` request opens with its path-variable row, unsent.
      await expect(window.getByTestId('path-variables')).toBeVisible({ timeout: 10_000 })
      await expect(window.getByTestId('path-variables')).toContainText('petId')

      // An exact endpoint opens and sends — and it is the mock that answers.
      await navigateSidebar(window, 'mocks')
      await window.getByText(folderName).first().click()
      await window.getByText('/v1/pets', { exact: true }).first().click()
      await window.getByTestId('mock-endpoint-open-in-http').click()
      await expect(window.getByTestId('url-input')).toHaveValue(
        `http://127.0.0.1:${port}/v1/pets`,
        { timeout: 15_000 },
      )
      // 200, not the 501 of an endpoint with no response.
      await expect(window.getByTestId('response-status')).toContainText('200', { timeout: 20_000 })
      await expect(window.getByTestId('response-error')).toHaveCount(0)
    } finally {
      await treeClearSearch(window).catch(() => {})
      await closeAllTabs(window).catch(() => {})
      await stopMockServer(window).catch(() => {})
      await window
        .evaluate(
          async ({ pid, name }) => {
            const w = window as unknown as MockApi
            const res = await w.api.mock.server.list(pid)
            for (const s of res.data ?? []) {
              if (s.name !== name) continue
              await w.api.mock.server.stop(s.id).catch(() => {})
              await w.api.mock.server.delete(s.id)
            }
          },
          { pid: projectId, name: folderName },
        )
        .catch(() => {})
    }
  })
})
