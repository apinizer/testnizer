/**
 * Tester finding 11 (critical) — a running mock moved to a busy port.
 *
 * Mock A (GET /a) and mock B (GET /b) both running. A → Settings → Port: B's
 * port → Tab. Before the fix the header said ":<B's port> Running", no error,
 * and `GET :<B's port>/a` reached B (404) while the row stored B's port. When
 * another application held the port, A stopped serving altogether.
 *
 * Now: a toast says the port was not changed and where the server keeps
 * running, the port box and the header go back to A's port, and A still
 * answers there. Same for a port held by something that is not a mock.
 *
 * Ports are picked free at run time (never fixed 3001/3002). Cleanup: both
 * mock servers stopped and deleted, the foreign listener closed.
 */
import net from 'node:net'
import { expect, type Page } from '@playwright/test'
import { uiTest } from './_setup'
import { closeAllTabs, dismissOverlays, ensureCanonicalProject } from '../helpers/ui/bootstrap'
import {
  addMockEndpoint,
  addMockResponse,
  createMockServer,
  startMockServer,
} from '../helpers/ui/mock-flow'
import { getActiveProjectId } from '../helpers/ui/assert-ipc'

const SCREENS = 'test-results/screens'
const uid = (): string => `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`

type IpcResult<T> = { success: boolean; data?: T; error?: string }

/** A port nothing listens on right now (asked from the OS, then released). */
async function freePort(): Promise<number> {
  const srv = net.createServer()
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', () => r()))
  const port = (srv.address() as net.AddressInfo).port
  await new Promise<void>((r) => srv.close(() => r()))
  return port
}

/** "Another application" holding a port. */
async function holdPort(): Promise<{ port: number; close: () => Promise<void> }> {
  const srv = net.createServer((socket) => socket.end())
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', () => r()))
  return {
    port: (srv.address() as net.AddressInfo).port,
    close: () => new Promise<void>((r) => srv.close(() => r())),
  }
}

/** HTTP status of `GET <path>`; 0 = nothing answers on that port. */
async function statusOf(port: number, path: string): Promise<number> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}${path}`)
    return res.status
  } catch {
    return 0
  }
}

/** Running HTTP mock answering `GET <path>`; its editor is left open. */
async function runningMock(page: Page, name: string, port: number, path: string): Promise<void> {
  await createMockServer(page, name, port)
  await addMockEndpoint(page, { path })
  await addMockResponse(page)
  await startMockServer(page)
  await expect.poll(() => statusOf(port, path), { timeout: 10_000 }).toBe(200)
}

async function openMockSettings(page: Page, name: string): Promise<void> {
  await page.getByText(name).first().click()
  await expect(page.getByTestId('mock-add-endpoint')).toBeVisible({ timeout: 10_000 })
  await page.getByTestId('mock-tab-settings').click()
  await expect(page.getByTestId('mock-settings-port')).toBeVisible({ timeout: 10_000 })
}

/** Type a port and leave the box with Tab, as the tester did. */
async function changePort(page: Page, port: number): Promise<void> {
  const input = page.getByTestId('mock-settings-port')
  await input.click()
  await input.fill(String(port))
  await page.keyboard.press('Tab')
}

async function deleteMockServersByName(
  page: Page,
  projectId: string,
  names: string[],
): Promise<void> {
  await page.evaluate(
    async ({ pid, ns }) => {
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
        if (!ns.includes(s.name)) continue
        await w.api.mock.server.stop(s.id).catch(() => {})
        await w.api.mock.server.delete(s.id)
      }
    },
    { pid: projectId, ns: names },
  )
}

async function storedPort(page: Page, projectId: string, name: string): Promise<number | null> {
  return page.evaluate(
    async ({ pid, n }) => {
      const w = window as unknown as Window & {
        api: {
          mock: {
            server: {
              list: (p: string) => Promise<IpcResult<Array<{ name: string; port: number }>>>
            }
          }
        }
      }
      const res = await w.api.mock.server.list(pid)
      return res.data?.find((s) => s.name === n)?.port ?? null
    },
    { pid: projectId, n: name },
  )
}

/** The refusal shows; port box, header and the stored row stay on `kept`. */
async function expectRefused(
  page: Page,
  projectId: string,
  name: string,
  kept: number,
  refused: number,
  screen: string,
): Promise<void> {
  const toast = page
    .locator('[data-sonner-toast]')
    .filter({ hasText: 'Port not changed' })
    .filter({ hasText: String(refused) })
  await expect(toast).toBeVisible({ timeout: 10_000 })
  await expect(toast).toContainText(`127.0.0.1:${kept}`)
  await expect(page.getByTestId('mock-settings-port')).toHaveValue(String(kept))
  await expect(page.getByTestId('mock-base-url')).toContainText(`:${kept}`)
  await expect(page.getByTestId('mock-base-url')).not.toContainText(`:${refused}`)
  await expect(page.getByTestId('mock-status')).toContainText(/running/i)
  await page.screenshot({ path: `${SCREENS}/71-${screen}.png` })
  expect(await storedPort(page, projectId, name)).toBe(kept)
}

uiTest.describe('Tester finding 11 — mock port changed to a busy port', () => {
  uiTest.beforeEach(async ({ window }) => {
    await dismissOverlays(window)
    await ensureCanonicalProject(window)
  })

  uiTest(
    'to the port of another running mock: error, port goes back, A keeps serving',
    async ({ window }) => {
      const stamp = uid()
      const nameA = `Mock71 A ${stamp}`
      const nameB = `Mock71 B ${stamp}`
      const projectId = await getActiveProjectId(window)
      const portA = await freePort()
      let portB = await freePort()
      while (portB === portA) portB = await freePort()

      try {
        await runningMock(window, nameA, portA, '/a')
        await runningMock(window, nameB, portB, '/b')
        await window.screenshot({ path: `${SCREENS}/71-1-two-mocks-running.png` })

        await openMockSettings(window, nameA)
        await changePort(window, portB)
        await expectRefused(window, projectId, nameA, portA, portB, '2-refused-mock-port')

        // A still answers on its own port; B's port is still B (A's /a is not there).
        expect(await statusOf(portA, '/a')).toBe(200)
        expect(await statusOf(portB, '/b')).toBe(200)
        expect(await statusOf(portB, '/a')).toBe(404)
      } finally {
        await closeAllTabs(window).catch(() => {})
        await deleteMockServersByName(window, projectId, [nameA, nameB]).catch(() => {})
      }
    },
  )

  uiTest('to a port another application holds: same error, A keeps serving', async ({ window }) => {
    const stamp = uid()
    const nameA = `Mock71 A ${stamp}`
    const projectId = await getActiveProjectId(window)
    const foreign = await holdPort()
    let portA = await freePort()
    while (portA === foreign.port) portA = await freePort()

    try {
      await runningMock(window, nameA, portA, '/a')

      await openMockSettings(window, nameA)
      await changePort(window, foreign.port)
      await expectRefused(window, projectId, nameA, portA, foreign.port, '3-refused-foreign-port')

      expect(await statusOf(portA, '/a')).toBe(200)
    } finally {
      await foreign.close().catch(() => {})
      await closeAllTabs(window).catch(() => {})
      await deleteMockServersByName(window, projectId, [nameA]).catch(() => {})
    }
  })
})
