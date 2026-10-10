/**
 * Issue #185 — Run honours the request's saved settings and resolves the
 * timeout with Send's chain.
 *
 * Before: `buildRequestFromEndpoint` read `request_schema.timeout ?? 30000`,
 * which nothing wrote, so every Run used 30 s whatever the Settings tab or the
 * project said; a saved request's settings never reached the runner at all.
 * Now: per-request `timeout` (endpoint / suite item: top of request_schema;
 * saved request: top of metadata) → project `requestTimeout` → app-wide
 * `defaultTimeout` → 30 s — `resolveHttpTimeout`, the function Send uses.
 *
 * Real `executeCollection` against a local server whose `/slow` answers after
 * 1.5 s and whose `/hop` redirects; electron-store is a fake so the project /
 * app settings are under the test's control.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import {
  createTestDb,
  makeElectronMock,
  seedProject,
  seedWorkspace,
  setupHandlerHarness,
} from './helpers'

const harness = setupHandlerHarness()
vi.mock('electron', () => ({
  ...makeElectronMock(),
  BrowserWindow: {
    getFocusedWindow: () => null,
    getAllWindows: () => [],
    fromWebContents: () => null,
    fromId: () => null,
  },
}))

let testDb: ReturnType<typeof createTestDb>
vi.mock('../../../src/main/db/database', () => ({ getDb: () => testDb }))

/** What the fake electron-store returns — set per test. */
const storeState = vi.hoisted(() => ({ values: {} as Record<string, unknown> }))
class FakeStore {
  get(key: string): unknown {
    return storeState.values[key]
  }
  set(): void {}
}
vi.mock('electron-store', () => ({ default: FakeStore }))

const { registerRunnerHandlers, buildRequestFromEndpoint } =
  await import('../../../src/main/ipc/runner.handler')

let server: Server
let base = ''

beforeAll(
  () =>
    new Promise<void>((resolve) => {
      server = createServer((req, res) => {
        if (req.url?.startsWith('/slow')) {
          const t = setTimeout(() => {
            res.writeHead(200, { 'Content-Type': 'text/plain' })
            res.end('late')
          }, 1_500)
          req.on('close', () => clearTimeout(t))
          return
        }
        if (req.url?.startsWith('/hop')) {
          res.writeHead(302, { Location: '/ok' })
          res.end()
          return
        }
        res.writeHead(200, { 'Content-Type': 'text/plain' })
        res.end('ok')
      })
      server.listen(0, '127.0.0.1', () => {
        base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
        resolve()
      })
    }),
)

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())))

let workspaceId: string
let projectId: string

beforeEach(() => {
  harness.reset()
  testDb = createTestDb()
  workspaceId = seedWorkspace(testDb)
  projectId = seedProject(testDb, workspaceId)
  storeState.values = {}
  registerRunnerHandlers()
})

afterEach(() => {
  testDb.close()
})

function seedEndpoint(path: string, settings: Record<string, unknown> = {}): string {
  const id = crypto.randomUUID()
  const now = Date.now()
  const schema = JSON.stringify({ method: 'GET', url: `${base}${path}`, ...settings })
  testDb
    .prepare(
      `INSERT INTO endpoints
        (id, project_id, folder_id, name, protocol, method, path, status,
         request_schema, sort_order, created_at, updated_at)
       VALUES (?, ?, NULL, 'EP', 'http', 'GET', ?, 'developing', ?, 0, ?, ?)`,
    )
    .run(id, projectId, path, schema, now, now)
  return id
}

/** A saved_requests row as Ctrl+S writes it: settings at the top of `metadata`. */
function seedSavedRequest(path: string, metadata: Record<string, unknown>): string {
  const id = crypto.randomUUID()
  const now = Date.now()
  testDb
    .prepare(
      `INSERT INTO saved_requests
         (id, project_id, folder_id, name, protocol, method, url, params, headers, body, auth,
          pre_script, post_script, assertions, metadata, sort_order, created_at, updated_at)
       VALUES (?, ?, NULL, 'SR', 'http', 'GET', ?, '[]', '[]', NULL, NULL, NULL, NULL, '[]', ?, 0, ?, ?)`,
    )
    .run(id, projectId, `${base}${path}`, JSON.stringify(metadata), now, now)
  return id
}

interface Row {
  status: number | null
  error?: string
  duration: number
}

async function runOne(id: string): Promise<Row> {
  const res = (await harness.invoke('runner:execute', {
    projectId,
    workspaceId,
    endpointIds: [id],
  })) as { success: boolean; data?: { results: Row[] } }
  expect(res.success).toBe(true)
  return res.data!.results[0]
}

describe("issue #185 — Run resolves the timeout with Send's chain", () => {
  it("the request's own timeout bounds the call (not a fixed 30 s)", async () => {
    const started = Date.now()
    const row = await runOne(seedEndpoint('/slow', { timeout: 200 }))
    expect(Date.now() - started).toBeLessThan(1_400)
    expect(row.status).toBeNull()
    expect(row.error).toMatch(/timeout|timed out/i)
  })

  it("no request timeout → the project's general timeout applies", async () => {
    storeState.values[`project.${projectId}.settings`] = { requestTimeout: 200 }
    const started = Date.now()
    const row = await runOne(seedEndpoint('/slow'))
    expect(Date.now() - started).toBeLessThan(1_400)
    expect(row.status).toBeNull()
    expect(row.error).toMatch(/timeout|timed out/i)
  })

  it('no request / project timeout → the app-wide defaultTimeout applies', async () => {
    storeState.values.defaultTimeout = 200
    const row = await runOne(seedEndpoint('/slow'))
    expect(row.status).toBeNull()
    expect(row.error).toMatch(/timeout|timed out/i)
  })

  it("the request's own value wins over the project setting (an explicit 0 = no timeout)", async () => {
    storeState.values[`project.${projectId}.settings`] = { requestTimeout: 200 }
    const row = await runOne(seedEndpoint('/slow', { timeout: 0 }))
    expect(row.status).toBe(200)
  })

  it("a saved request's timeout (in metadata) reaches Run", async () => {
    const row = await runOne(seedSavedRequest('/slow', { timeout: 200 }))
    expect(row.status).toBeNull()
    expect(row.error).toMatch(/timeout|timed out/i)
  })

  it("a saved request's followRedirects: false is honoured (302 returned, not followed)", async () => {
    const followed = await runOne(seedSavedRequest('/hop', {}))
    expect(followed.status).toBe(200)
    const kept = await runOne(seedSavedRequest('/hop', { followRedirects: false }))
    expect(kept.status).toBe(302)
  })
})

describe('buildRequestFromEndpoint — settings keys (issue #185)', () => {
  const ep = (schema: Record<string, unknown>) =>
    ({
      path: '/x',
      method: 'GET',
      protocol: 'http',
      request_schema: JSON.stringify(schema),
    }) as never

  it('maps timeout / redirects / ssl; falls back project → app → 30 s', () => {
    expect(
      buildRequestFromEndpoint(
        ep({
          url: '/x',
          timeout: 5,
          followRedirects: false,
          maxRedirects: 2,
          sslVerification: false,
        }),
      ),
    ).toMatchObject({ timeout: 5, followRedirects: false, maxRedirects: 2, sslVerification: false })
    expect(buildRequestFromEndpoint(ep({ url: '/x' }), { project: 7, app: 9 })?.timeout).toBe(7)
    expect(buildRequestFromEndpoint(ep({ url: '/x' }), { app: 9 })?.timeout).toBe(9)
    expect(buildRequestFromEndpoint(ep({ url: '/x' }))?.timeout).toBe(30_000)
    expect(buildRequestFromEndpoint(ep({ url: '/x', timeoutSeconds: 3 }))?.timeout).toBe(3_000)
  })
})
