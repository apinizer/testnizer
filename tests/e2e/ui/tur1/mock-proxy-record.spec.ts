/**
 * MST-309 P1  Mock proxy record mode
 *
 * With proxyEnabled + proxyRecord both on, an unmatched request is forwarded to
 * the upstream and the captured upstream response is persisted as a NEW mock
 * endpoint (+ an "always" response) so it can be replayed offline later.
 *
 * Setup mirrors mock-proxy.spec.ts (MST-169): the upstream is our local
 * http-echo server, the request is issued through the renderer's request IPC
 * (same path the UI uses). Mock config (proxyEnabled / proxyTarget /
 * proxyRecord) is driven via the mock IPC bridge instead of the Settings-tab
 * form: those checkboxes carry no data-testid (see the NEEDS HOOK notes in
 * mock-proxy.spec.ts) so UI form-filling is brittle under parallel workers.
 * `mock:server:create` + `mock:server:update` is the same code the form calls.
 *
 * After the proxied hit we poll `mock:endpoint:list` for the recorded endpoint;
 * the recorder writes it as `GET <path>` with a "Recorded ..." description
 * (src/main/mock/server.ts:recordProxiedResponse).
 *
 * Does NOT modify mock-proxy.spec.ts, 09-mock-deep.spec.ts or mock-flow.ts.
 */
import { expect } from '@playwright/test'
import { uiTest } from './_setup'
import {
  dismissOverlays,
  ensureCanonicalProject,
  navigateSidebar,
} from '../../helpers/ui/bootstrap'
import { getActiveProjectId } from '../../helpers/ui/assert-ipc'
import { randomMockPort } from '../../helpers/ui/mock-flow'
import { localHttpBin } from '../../helpers/test-servers'
import type { Page } from '@playwright/test'

const upstreamBase = (): string => localHttpBin()
const uid = (): string => `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`

interface MockEndpointView {
  id: string
  method: string
  path: string
  description: string
}

/** Create a proxy+record mock server via IPC and return its id. */
async function ipcCreateProxyRecordServer(
  page: Page,
  opts: { projectId: string; name: string; port: number; target: string },
): Promise<string> {
  return page.evaluate(async (o) => {
    interface IpcResult<T> {
      success: boolean
      data?: T
      error?: string
    }
    const w = window as Window & {
      api?: {
        mock?: {
          server?: {
            create: (i: unknown) => Promise<IpcResult<{ id: string }>>
            update: (id: string, patch: unknown) => Promise<IpcResult<{ id: string }>>
          }
        }
      }
    }
    const created = await w.api?.mock?.server?.create({
      projectId: o.projectId,
      name: o.name,
      port: o.port,
      host: '127.0.0.1',
    })
    if (!created?.success || !created.data?.id) {
      throw new Error(created?.error ?? 'mock server create failed')
    }
    const id = created.data.id
    const updated = await w.api?.mock?.server?.update(id, {
      proxyEnabled: true,
      proxyTarget: o.target,
      proxyRecord: true,
    })
    if (!updated?.success) throw new Error(updated?.error ?? 'mock server update failed')
    return id
  }, opts)
}

async function ipcStartServer(page: Page, serverId: string): Promise<void> {
  const ok = await page.evaluate(async (sid) => {
    interface IpcResult<T> {
      success: boolean
      data?: T
      error?: string
    }
    const w = window as Window & {
      api?: { mock?: { server?: { start: (id: string) => Promise<IpcResult<{ status: string }>> } } }
    }
    const res = await w.api?.mock?.server?.start(sid)
    return !!res?.success && res.data?.status === 'running'
  }, serverId)
  expect(ok).toBe(true)
}

async function ipcStopServer(page: Page, serverId: string): Promise<void> {
  await page.evaluate(async (sid) => {
    const w = window as Window & {
      api?: { mock?: { server?: { stop: (id: string) => Promise<unknown> } } }
    }
    await w.api?.mock?.server?.stop(sid)
  }, serverId)
}

async function ipcListEndpoints(page: Page, serverId: string): Promise<MockEndpointView[]> {
  return page.evaluate(async (sid) => {
    interface IpcResult<T> {
      success: boolean
      data?: T
      error?: string
    }
    const w = window as Window & {
      api?: {
        mock?: { endpoint?: { list: (id: string) => Promise<IpcResult<unknown[]>> } }
      }
    }
    const res = await w.api?.mock?.endpoint?.list(sid)
    if (!res?.success) throw new Error(res?.error ?? 'endpoint list failed')
    return (res.data ?? []) as MockEndpointView[]
  }, serverId) as Promise<MockEndpointView[]>
}

/** Send a GET through the renderer request IPC (same path the UI Send button uses). */
async function ipcGet(page: Page, url: string): Promise<number> {
  return page.evaluate(async (u) => {
    const w = window as unknown as Window & {
      api?: {
        request?: { send: (p: unknown) => Promise<{ success: boolean; data?: { status?: number } }> }
      }
    }
    const res = await w.api?.request?.send({ method: 'GET', url: u })
    return res?.data?.status ?? 0
  }, url)
}

uiTest.describe('Tur1 — Mock proxy record [MST-309]', () => {
  uiTest.beforeEach(async ({ window }) => {
    await dismissOverlays(window)
    await ensureCanonicalProject(window)
    await navigateSidebar(window, 'mocks')
  })

  uiTest('MST-309 proxy+record persists captured upstream as a new mock endpoint', async ({
    window,
  }) => {
    const projectId = await getActiveProjectId(window)
    const port = randomMockPort()
    // http-echo serves GET /get → 200 (tests/e2e/servers/http-echo.ts).
    const recordedPath = '/get'

    const serverId = await ipcCreateProxyRecordServer(window, {
      projectId,
      name: `ProxyRecord-${uid()}`,
      port,
      target: upstreamBase(),
    })
    await ipcStartServer(window, serverId)

    try {
      // No endpoint matches /get → proxied to upstream → 200, and recorded.
      const proxiedStatus = await ipcGet(window, `http://127.0.0.1:${port}${recordedPath}?rec=309`)
      expect(proxiedStatus).toBe(200)

      // The recorder persists asynchronously after the response is sent; poll
      // the endpoint list until the captured endpoint appears.
      let recorded: MockEndpointView | undefined
      const deadline = Date.now() + 10_000
      while (Date.now() < deadline) {
        const endpoints = await ipcListEndpoints(window, serverId)
        recorded = endpoints.find(
          (ep) => ep.method === 'GET' && ep.path === recordedPath,
        )
        if (recorded) break
        await window.waitForTimeout(250)
      }

      expect(recorded, 'recorded endpoint not persisted after proxied request').toBeTruthy()
      expect(recorded!.method).toBe('GET')
      expect(recorded!.path).toBe(recordedPath)
    } finally {
      await ipcStopServer(window, serverId)
    }
  })
})
