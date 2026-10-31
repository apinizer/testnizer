/**
 * Run follows the active environment the user chose — including "none"
 * (follow-up to issue #307).
 *
 * A run with no explicit `environmentId` resolves `{{var}}` from the project's
 * `is_active = 1` environment (`runner.handler.ts`). The renderer persists the
 * header picker through `environment:setActiveForProject`; choosing
 * "No environment" sends `null`, which must leave NO active row so the run —
 * like Send — resolves no environment variables. Choosing an environment again
 * must make the run use it. Renderer half: `tests/renderer/active-environment-db-truth.test.ts`.
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
vi.mock('../../../src/main/db/database', async (orig) => ({
  ...(await orig<typeof import('../../../src/main/db/database')>()),
  getDb: () => testDb,
}))

const { registerRunnerHandlers } = await import('../../../src/main/ipc/runner.handler')
const { registerEnvironmentHandlers } = await import('../../../src/main/ipc/environment.handler')

let server: Server
let base = ''
const paths: string[] = []

beforeAll(
  () =>
    new Promise<void>((resolve) => {
      server = createServer((req, res) => {
        paths.push(req.url ?? '/')
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
  paths.length = 0
  registerRunnerHandlers()
  registerEnvironmentHandlers()
})
afterEach(() => testDb.close())

function seedEnv(name: string, active: boolean, tag: string): string {
  const id = crypto.randomUUID()
  const now = Date.now()
  testDb
    .prepare(
      `INSERT INTO environments (id, workspace_id, project_id, name, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(id, workspaceId, projectId, name, active ? 1 : 0, now, now)
  testDb
    .prepare(
      `INSERT INTO environment_variables (id, environment_id, key, value, initial_value, enabled, secret)
       VALUES (?, ?, 'tag', ?, ?, 1, 0)`,
    )
    .run(crypto.randomUUID(), id, tag, tag)
  return id
}

function seedEndpoint(): string {
  const id = crypto.randomUUID()
  const now = Date.now()
  const url = `${base}/env/{{tag}}`
  testDb
    .prepare(
      `INSERT INTO endpoints
        (id, project_id, folder_id, name, protocol, method, path, status,
         request_schema, sort_order, created_at, updated_at)
       VALUES (?, ?, NULL, 'e', 'http', 'GET', ?, 'developing', ?, 0, ?, ?)`,
    )
    .run(id, projectId, url, JSON.stringify({ method: 'GET', url }), now, now)
  return id
}

async function run(endpointId: string): Promise<{ environmentName?: string }> {
  const res = (await harness.invoke('runner:execute', {
    projectId,
    workspaceId,
    endpointIds: [endpointId],
  })) as { success: boolean; error?: string; data?: { environmentName?: string } }
  expect(res.success, res.error).toBe(true)
  return res.data!
}

async function setActive(id: string | null): Promise<void> {
  const res = (await harness.invoke('environment:setActiveForProject', projectId, id)) as {
    success: boolean
    error?: string
  }
  expect(res.success, res.error).toBe(true)
}

describe('the run uses the active environment the user chose', () => {
  it('"No environment" (null) clears the active row: the run resolves no environment', async () => {
    seedEnv('Staging', true, 'stg')
    const ep = seedEndpoint()

    await setActive(null)
    const active = testDb
      .prepare('SELECT COUNT(*) AS n FROM environments WHERE project_id = ? AND is_active = 1')
      .get(projectId) as { n: number }
    expect(active.n).toBe(0)

    const report = await run(ep)
    expect(report.environmentName).toBe('')
    expect(paths.at(-1)).not.toBe('/env/stg')
  })

  it('choosing an environment again makes the run use its variables', async () => {
    seedEnv('Prod', true, 'prod')
    const staging = seedEnv('Staging', false, 'stg')
    const ep = seedEndpoint()

    await setActive(null)
    await setActive(staging)
    const report = await run(ep)
    expect(report.environmentName).toBe('Staging')
    expect(paths.at(-1)).toBe('/env/stg')
  })
})
