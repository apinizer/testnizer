/**
 * MST-308 P0  Mock CORS behaviour
 *
 * A mock server with CORS enabled must answer OPTIONS preflight requests with
 * `Access-Control-Allow-Origin` / `Access-Control-Allow-Methods` headers, and
 * decorate normal (GET) responses with the same allow-origin header. A second
 * mock server with CORS disabled must NOT emit any of those headers.
 *
 * Mock config (CORS flags, origins) is driven via the mock IPC bridge rather
 * than the MockServerEditor form: the CORS controls live behind the Settings
 * tab with no data-testid hooks, so UI form-filling would be brittle under
 * parallel workers. The IPC path (`mock:server:create` + `mock:server:update`)
 * is the same code the form ultimately calls and lets us assert the runtime
 * behaviour deterministically. We still drive create/start/stop through IPC so
 * the test never depends on editor layout.
 *
 * Preflight + GET are issued from the test process with raw node http so we
 * observe the wire headers directly (the renderer CSP blocks cross-origin fetch
 * and would strip CORS semantics anyway).
 *
 * Does NOT modify 09-mock-deep.spec.ts or mock-flow.ts.
 */
import http from 'node:http'
import { expect } from '@playwright/test'
import { uiTest } from './_setup'
import {
  dismissOverlays,
  ensureCanonicalProject,
  navigateSidebar,
} from '../../helpers/ui/bootstrap'
import { getActiveProjectId } from '../../helpers/ui/assert-ipc'
import { randomMockPort } from '../../helpers/ui/mock-flow'
import type { Page } from '@playwright/test'

const uid = (): string => `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`

interface RawResponse {
  status: number
  headers: Record<string, string | string[] | undefined>
}

/** Issue a raw HTTP request from the test process and resolve status + headers. */
function rawRequest(opts: {
  port: number
  method: string
  path: string
  headers?: Record<string, string>
}): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port: opts.port,
        method: opts.method,
        path: opts.path,
        headers: opts.headers,
        timeout: 10_000,
      },
      (res) => {
        // Drain the body so the socket can close cleanly.
        res.on('data', () => {})
        res.on('end', () =>
          resolve({ status: res.statusCode ?? 0, headers: res.headers }),
        )
      },
    )
    req.on('error', reject)
    req.on('timeout', () => {
      req.destroy(new Error('raw request timeout'))
    })
    req.end()
  })
}

/** Create a mock server via IPC and return its id. */
async function ipcCreateServer(
  page: Page,
  opts: { projectId: string; name: string; port: number; corsEnabled: boolean; corsOrigins?: string },
): Promise<string> {
  return page.evaluate(async (o) => {
    interface IpcResult<T> {
      success: boolean
      data?: T
      error?: string
    }
    const w = window as Window & {
      api?: { mock?: { server?: { create: (i: unknown) => Promise<IpcResult<{ id: string }>> } } }
    }
    const res = await w.api?.mock?.server?.create({
      projectId: o.projectId,
      name: o.name,
      port: o.port,
      host: '127.0.0.1',
      corsEnabled: o.corsEnabled,
      corsAllowOrigins: o.corsOrigins,
    })
    if (!res?.success || !res.data?.id) throw new Error(res?.error ?? 'mock server create failed')
    return res.data.id
  }, opts)
}

/** Add a GET endpoint with a 200 response so a normal (non-preflight) request matches. */
async function ipcAddGetEndpoint(page: Page, serverId: string, path: string): Promise<void> {
  await page.evaluate(
    async ({ sid, p }) => {
      interface IpcResult<T> {
        success: boolean
        data?: T
        error?: string
      }
      const w = window as Window & {
        api?: {
          mock?: {
            endpoint?: { create: (i: unknown) => Promise<IpcResult<{ id: string }>> }
            response?: { create: (i: unknown) => Promise<IpcResult<{ id: string }>> }
          }
        }
      }
      const epRes = await w.api?.mock?.endpoint?.create({
        serverId: sid,
        method: 'GET',
        path: p,
        pathMode: 'exact',
      })
      if (!epRes?.success || !epRes.data?.id) throw new Error(epRes?.error ?? 'endpoint create failed')
      const rRes = await w.api?.mock?.response?.create({
        endpointId: epRes.data.id,
        statusCode: 200,
        bodyType: 'json',
        body: '{"ok":true}',
        condition: { type: 'always' },
        enabled: true,
      })
      if (!rRes?.success) throw new Error(rRes?.error ?? 'response create failed')
    },
    { sid: serverId, p: path },
  )
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

uiTest.describe('Tur1 — Mock CORS [MST-308]', () => {
  uiTest.beforeEach(async ({ window }) => {
    await dismissOverlays(window)
    await ensureCanonicalProject(window)
    await navigateSidebar(window, 'mocks')
  })

  uiTest('MST-308 CORS-enabled mock emits allow headers; disabled mock does not', async ({
    window,
  }) => {
    const projectId = await getActiveProjectId(window)
    const origin = 'https://app.example.test'

    // ── CORS-enabled server ──────────────────────────────────────
    const corsPort = randomMockPort()
    const corsServerId = await ipcCreateServer(window, {
      projectId,
      name: `CorsOn-${uid()}`,
      port: corsPort,
      corsEnabled: true,
      corsOrigins: origin,
    })
    await ipcAddGetEndpoint(window, corsServerId, '/data')
    await ipcStartServer(window, corsServerId)

    // ── CORS-disabled server (separate port) ─────────────────────
    const noCorsPort = randomMockPort()
    const noCorsServerId = await ipcCreateServer(window, {
      projectId,
      name: `CorsOff-${uid()}`,
      port: noCorsPort,
      corsEnabled: false,
    })
    await ipcAddGetEndpoint(window, noCorsServerId, '/data')
    await ipcStartServer(window, noCorsServerId)

    try {
      // Preflight against CORS-enabled server.
      const preflight = await rawRequest({
        port: corsPort,
        method: 'OPTIONS',
        path: '/data',
        headers: {
          Origin: origin,
          'Access-Control-Request-Method': 'GET',
        },
      })
      // Preflight is answered with 204 + CORS headers.
      expect(preflight.status).toBe(204)
      const allowOrigin = String(preflight.headers['access-control-allow-origin'] ?? '')
      // allowOrigins matched our origin exactly → echoes it back.
      expect(allowOrigin).toBe(origin)
      const allowMethods = String(preflight.headers['access-control-allow-methods'] ?? '')
      expect(allowMethods.toUpperCase()).toContain('GET')

      // Normal GET against the CORS-enabled server also carries allow-origin.
      const corsGet = await rawRequest({
        port: corsPort,
        method: 'GET',
        path: '/data',
        headers: { Origin: origin },
      })
      expect(corsGet.status).toBe(200)
      expect(String(corsGet.headers['access-control-allow-origin'] ?? '')).toBe(origin)

      // CORS-disabled server: GET works but emits NO allow-origin header.
      const noCorsGet = await rawRequest({
        port: noCorsPort,
        method: 'GET',
        path: '/data',
        headers: { Origin: origin },
      })
      expect(noCorsGet.status).toBe(200)
      expect(noCorsGet.headers['access-control-allow-origin']).toBeUndefined()
      expect(noCorsGet.headers['access-control-allow-methods']).toBeUndefined()
    } finally {
      await ipcStopServer(window, corsServerId)
      await ipcStopServer(window, noCorsServerId)
    }
  })
})
