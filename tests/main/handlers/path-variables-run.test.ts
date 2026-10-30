/**
 * Issue #276 — `:name` path variables on Run (real `runner:execute`, local
 * server). Same cases as Send (tests/fixtures/path-variables-parity.ts), for
 * each row kind the runner reads: endpoint (`request_schema.pathVariables`),
 * saved request (`metadata.pathVariables`) and Test Suite item.
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
import { PATH_VARIABLE_CASES } from '../../fixtures/path-variables-parity'

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
class FakeStore {
  get(): unknown {
    return undefined
  }
  set(): void {}
}
vi.mock('electron-store', () => ({ default: FakeStore }))

const { registerRunnerHandlers } = await import('../../../src/main/ipc/runner.handler')

let server: Server
let base = ''
beforeAll(
  () =>
    new Promise<void>((resolve) => {
      server = createServer((req, res) => {
        res.writeHead(200, { 'Content-Type': 'text/plain' })
        res.end(`path=${req.url}`)
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
  registerRunnerHandlers()
})
afterEach(() => testDb.close())

function activeEnv(vars: Record<string, string>): void {
  const envId = crypto.randomUUID()
  const now = Date.now()
  testDb
    .prepare(
      'INSERT INTO environments (id, workspace_id, project_id, name, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?)',
    )
    .run(envId, workspaceId, projectId, 'E', now, now)
  for (const [k, v] of Object.entries(vars)) {
    testDb
      .prepare(
        'INSERT INTO environment_variables (id, environment_id, key, value) VALUES (?, ?, ?, ?)',
      )
      .run(crypto.randomUUID(), envId, k, v)
  }
}

async function runOne(id: string): Promise<string> {
  const res = (await harness.invoke('runner:execute', {
    projectId,
    workspaceId,
    endpointIds: [id],
  })) as { success: boolean; data?: { results: Array<{ body?: string; responseBody?: string }> } }
  expect(res.success).toBe(true)
  const row = res.data!.results[0]
  return String(row.body ?? row.responseBody ?? '')
}

describe('issue #276 — path variables on Run (Send ≡ Run cases)', () => {
  for (const c of PATH_VARIABLE_CASES) {
    it(`endpoint: ${c.name}`, async () => {
      activeEnv({ base, ...(c.env ?? {}) })
      const id = crypto.randomUUID()
      const now = Date.now()
      const schema = {
        url: c.url,
        method: 'GET',
        ...(c.pathVariables ? { pathVariables: c.pathVariables } : {}),
      }
      testDb
        .prepare(
          `INSERT INTO endpoints (id, project_id, folder_id, name, protocol, method, path, status, request_schema, sort_order, created_at, updated_at)
           VALUES (?, ?, NULL, ?, 'http', 'GET', ?, 'developing', ?, 0, ?, ?)`,
        )
        .run(id, projectId, c.name, c.url, JSON.stringify(schema), now, now)
      expect(await runOne(id)).toBe(`path=${c.expected}`)
    })
  }

  it('saved request: values from metadata', async () => {
    const c = PATH_VARIABLE_CASES[1]
    activeEnv({ base, ...(c.env ?? {}) })
    const id = crypto.randomUUID()
    const now = Date.now()
    testDb
      .prepare(
        `INSERT INTO saved_requests (id, project_id, folder_id, name, protocol, method, url, metadata, created_at, updated_at)
         VALUES (?, ?, NULL, 'sr', 'http', 'GET', ?, ?, ?, ?)`,
      )
      .run(id, projectId, c.url, JSON.stringify({ pathVariables: c.pathVariables }), now, now)
    expect(await runOne(id)).toBe(`path=${c.expected}`)
  })

  it('Test Suite item: values from its request_schema', async () => {
    const c = PATH_VARIABLE_CASES[0]
    activeEnv({ base })
    const now = Date.now()
    const suiteId = crypto.randomUUID()
    testDb
      .prepare(
        'INSERT INTO test_suites (id, project_id, name, sort_order, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?)',
      )
      .run(suiteId, projectId, 'S', now, now)
    const itemId = crypto.randomUUID()
    testDb
      .prepare(
        `INSERT INTO test_suite_items (id, suite_id, folder_id, protocol, name, method, url, request_schema, sort_order, created_at, updated_at)
         VALUES (?, ?, NULL, 'http', 'it', 'GET', ?, ?, 0, ?, ?)`,
      )
      .run(
        itemId,
        suiteId,
        c.url,
        JSON.stringify({ url: c.url, method: 'GET', pathVariables: c.pathVariables }),
        now,
        now,
      )
    expect(await runOne(itemId)).toBe(`path=${c.expected}`)
  })
})
