/**
 * Issue #303 — a mock endpoint opens in a normal HTTP request tab, never in
 * the system browser.
 *
 * The URL bar of an HTTP mock server used to carry an "Open" button that handed
 * the endpoint to the browser (GET only). It is now "Open in request tab":
 * the tab is "<server> · client", method + URL prefilled, sent once on open,
 * and — being an ordinary request tab — it Sends, Ctrl+S saves it into the APIs
 * tree, and the saved request reopens with its method and URL.
 *
 * Cleanup: tabs are force-closed and the mock server + saved request deleted.
 */
import { expect, type Page } from '@playwright/test'
import { uiTest } from './_setup'
import {
  closeAllTabs,
  dismissOverlays,
  ensureCanonicalProject,
  navigateSidebar,
} from '../helpers/ui/bootstrap'
import {
  addMockEndpoint,
  addMockResponse,
  createMockServer,
  randomMockPort,
  startMockServer,
  stopMockServer,
} from '../helpers/ui/mock-flow'
import { getActiveProjectId, listSavedRequestsByProject } from '../helpers/ui/assert-ipc'
import { pressModShortcut } from '../helpers/ui/keyboard'
import { treeClearSearch, treeOpenNode } from '../helpers/ui/tree'

// Screenshots land in the test output dir; TESTNIZER_SHOTS_DIR redirects them for manual review.
const shot = (name: string): string =>
  process.env.TESTNIZER_SHOTS_DIR
    ? `${process.env.TESTNIZER_SHOTS_DIR}/${name}`
    : uiTest.info().outputPath(name)
const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`

type IpcResult<T> = { success: boolean; data?: T; error?: string }

async function deleteMockServerByName(page: Page, projectId: string, name: string): Promise<void> {
  await page.evaluate(
    async ({ pid, n }) => {
      const w = window as unknown as Window & {
        api: {
          mock: {
            server: {
              list: (p: string) => Promise<IpcResult<Array<{ id: string; name: string }>>>
              stop: (id: string) => Promise<unknown>
              delete: (id: string) => Promise<unknown>
            }
          }
        }
      }
      const res = await w.api.mock.server.list(pid)
      for (const s of res.data ?? []) {
        if (s.name !== n) continue
        await w.api.mock.server.stop(s.id).catch(() => {})
        await w.api.mock.server.delete(s.id)
      }
    },
    { pid: projectId, n: name },
  )
}

async function deleteSavedRequestsByName(page: Page, projectId: string, name: string): Promise<void> {
  const rows = (await listSavedRequestsByProject(page, projectId)) as Array<{ id: string; name: string }>
  for (const r of rows.filter((x) => x.name === name)) {
    await page.evaluate(async (id) => {
      const w = window as unknown as Window & {
        api: { savedRequest: { delete: (id: string) => Promise<unknown> } }
      }
      await w.api.savedRequest.delete(id)
    }, r.id)
  }
}

uiTest.describe('Issue #303 — mock endpoint opens in a request tab', () => {
  uiTest.beforeEach(async ({ window }) => {
    await dismissOverlays(window)
    await ensureCanonicalProject(window)
  })

  uiTest('open → sends → response shown → Ctrl+S saves → reopens with method and URL', async ({
    window,
  }) => {
    const stamp = uid()
    const serverName = `Mock303 ${stamp}`
    const reqName = `Mock303 saved ${stamp}`
    const port = randomMockPort()
    const path = `/orders-${stamp.slice(-4)}`
    const projectId = await getActiveProjectId(window)

    try {
      // A running HTTP mock with one POST endpoint answering 201.
      await createMockServer(window, serverName, port)
      await addMockEndpoint(window, { path, method: 'POST' })
      await addMockResponse(window, { status: 201 })
      await startMockServer(window)

      // No control hands the endpoint to the system browser.
      const bar = window.getByTestId('mock-endpoint-url-bar')
      await expect(bar).toBeVisible()
      await expect(bar.getByRole('button', { name: /^\s*↗?\s*Open\s*$/i })).toHaveCount(0)
      await expect(bar.getByText(/^Open$/)).toHaveCount(0)
      await expect(bar.locator('a[href], [data-testid="mock-endpoint-open"]')).toHaveCount(0)
      await window.evaluate(() => {
        const w = window as unknown as { __opened: string[]; open: (...a: unknown[]) => unknown }
        w.__opened = []
        w.open = (...a: unknown[]) => {
          w.__opened.push(String(a[0]))
          return null
        }
      })

      await window.screenshot({ path: shot('303-1-mock-url-bar.png') })

      const openBtn = bar.getByTestId('mock-endpoint-open-in-http')
      await expect(openBtn).toBeEnabled()
      await openBtn.click()

      // The client tab: "<server> · client", POST + the mock URL, response already shown.
      const clientTab = window.locator(
        `[data-testid="endpoint-tab"][data-tab-name="${serverName} · client"]`,
      )
      await expect(clientTab).toHaveCount(1, { timeout: 10_000 })
      await expect(clientTab).toHaveAttribute('data-active', 'true')
      await expect(window.getByTestId('url-method')).toHaveText(/POST/)
      const mockUrl = `http://127.0.0.1:${port}${path}`
      await expect(window.getByTestId('url-input')).toHaveValue(new RegExp(`:${port}${path}$`))
      // A prefilled scratch tab is not dirty.
      await expect(clientTab).toHaveAttribute('data-dirty', 'false')

      // Sent once on open: the mock's 201 + body is in the response pane.
      await expect(window.getByTestId('response-status')).toContainText('201', { timeout: 20_000 })
      await expect(window.locator('.view-lines:visible').filter({ hasText: /"ok"/ }).first()).toBeVisible({
        timeout: 10_000,
      })
      await window.screenshot({ path: shot('303-2-client-tab-response.png') })

      // Send again by hand — still the mock's answer.
      await window.getByTestId('send-btn').click()
      await expect(window.getByTestId('response-status')).toContainText('201', { timeout: 20_000 })

      // The system browser was never asked.
      expect(await window.evaluate(() => (window as unknown as { __opened: string[] }).__opened)).toEqual([])

      // Ctrl+S → Save As (first save) → into the APIs tree.
      await pressModShortcut(window, 's')
      const modal = window.getByTestId('endpoint-save-modal')
      await expect(modal).toBeVisible({ timeout: 8_000 })
      await modal.locator('input').first().fill(reqName)
      await window.screenshot({ path: shot('303-3-save-as.png') })
      await modal.getByRole('button', { name: /Save|Update/i }).click()
      await expect(modal).toBeHidden({ timeout: 20_000 })

      await expect
        .poll(
          async () =>
            ((await listSavedRequestsByProject(window, projectId)) as Array<{
              name: string
              method: string
              url: string
            }>).find((r) => r.name === reqName)?.url ?? null,
          { timeout: 10_000 },
        )
        .toBe(mockUrl)
      const saved = ((await listSavedRequestsByProject(window, projectId)) as Array<{
        name: string
        method: string
        url: string
      }>).find((r) => r.name === reqName)
      expect(saved?.method).toBe('POST')

      // Close everything, reopen from the tree: method + URL come back.
      await closeAllTabs(window)
      await navigateSidebar(window, 'apis')
      await treeOpenNode(window, reqName)
      await expect(window.getByTestId('url-method')).toHaveText(/POST/, { timeout: 10_000 })
      await expect(window.getByTestId('url-input')).toHaveValue(mockUrl)
      await window.screenshot({ path: shot('303-4-reopened-from-tree.png') })
    } finally {
      await treeClearSearch(window).catch(() => {})
      await closeAllTabs(window).catch(() => {})
      await stopMockServer(window).catch(() => {})
      await deleteSavedRequestsByName(window, projectId, reqName).catch(() => {})
      await deleteMockServerByName(window, projectId, serverName).catch(() => {})
    }
  })
})
