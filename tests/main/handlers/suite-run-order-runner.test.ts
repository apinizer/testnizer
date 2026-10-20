/**
 * Tester report (Testnizer Suite, 2026-10) end to end: a collection turned into
 * a suite from the APIs tree, then run through `runner:execute`, must send its
 * requests module by module AND apply the folder pre-request scripts it had in
 * APIs. Before the fix the suite ran "request 0 of every module, then 1…" and
 * the mirrored folders carried no scripts, so `{{ApiProxyName}}` never resolved.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  setupHandlerHarness,
  makeElectronMock,
  createTestDb,
  seedProject,
  seedWorkspace,
} from './helpers'
import crypto from 'node:crypto'
import type Database from 'better-sqlite3'

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

const sent: string[] = []
vi.mock('../../../src/main/protocols/http.engine', () => ({
  stripUrlCredentials: (u: string) => u,
  executeHttpRequest: vi.fn(async (opts: { url: string }) => {
    sent.push(opts.url)
    return {
      status: 200,
      statusText: 'OK',
      headers: {},
      body: '{}',
      bodySize: 2,
      timing: { total: 1 },
      actualRequest: { method: 'GET', url: opts.url, headers: {}, body: '' },
    }
  }),
}))

const { registerRunnerHandlers, inSuiteExecutionOrder } =
  await import('../../../src/main/ipc/runner.handler')
const { registerTestSuiteHandlers } = await import('../../../src/main/ipc/test-suite.handler')

let projectId: string
let envId: string
let suiteId: string
let folderOrder = 0

function seedEnv(db: Database.Database): string {
  const id = crypto.randomUUID()
  const now = Date.now()
  const ws = db.prepare('SELECT workspace_id FROM projects WHERE id = ?').get(projectId) as {
    workspace_id: string
  }
  db.prepare(
    `INSERT INTO environments (id, workspace_id, project_id, name, is_active, created_at, updated_at)
     VALUES (?, ?, ?, 'Env', 1, ?, ?)`,
  ).run(id, ws.workspace_id, projectId, now, now)
  db.prepare(
    `INSERT INTO environment_variables (id, environment_id, key, value, enabled, secret, initial_value)
     VALUES (?, ?, 'runId', 'r42', 1, 0, 'r42')`,
  ).run(crypto.randomUUID(), id)
  return id
}

function seedFolder(name: string, parentId: string | null, preScript?: string): string {
  const id = crypto.randomUUID()
  testDb
    .prepare(
      `INSERT INTO folders (id, project_id, parent_id, name, sort_order, pre_script)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(id, projectId, parentId, name, folderOrder++, preScript ?? null)
  return id
}

function seedEndpoint(name: string, folderId: string, order: number, url: string): string {
  const id = crypto.randomUUID()
  const now = Date.now()
  testDb
    .prepare(
      `INSERT INTO endpoints (id, project_id, folder_id, name, protocol, method, path, status,
         request_schema, sort_order, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'http', 'GET', ?, 'developing', ?, ?, ?, ?)`,
    )
    .run(
      id,
      projectId,
      folderId,
      name,
      url,
      JSON.stringify({ url, method: 'GET', auth: { type: 'none' } }),
      order,
      now,
      now,
    )
  return id
}

beforeEach(() => {
  harness.reset()
  sent.length = 0
  folderOrder = 0
  testDb = createTestDb()
  projectId = seedProject(testDb, seedWorkspace(testDb))
  envId = seedEnv(testDb)
  const now = Date.now()
  suiteId = crypto.randomUUID()
  testDb
    .prepare(
      `INSERT INTO test_suites (id, project_id, name, sort_order, created_at, updated_at)
       VALUES (?, ?, 'Core', 0, ?, ?)`,
    )
    .run(suiteId, projectId, now, now)
  registerRunnerHandlers()
  registerTestSuiteHandlers()
})

/** Core → 00 Init (2 requests), 03 Proxy → 01 Setup (script) (2 requests). */
async function buildSuite(): Promise<string[]> {
  const core = seedFolder('Core', null)
  const init = seedFolder('00 Init', core)
  const proxy = seedFolder('03 Proxy', core)
  const setup = seedFolder(
    '01 Setup',
    proxy,
    "pm.environment.set('ApiProxyName', 'col-' + pm.environment.get('runId') + '-api-proxy')",
  )
  const ids = [
    seedEndpoint('Init runId', init, 0, 'http://api.test/init'),
    seedEndpoint('Create token', init, 1, 'http://api.test/token'),
    seedEndpoint('Create proxy', setup, 0, 'http://api.test/proxy/{{ApiProxyName}}'),
    seedEndpoint('Deploy proxy', setup, 1, 'http://api.test/deploy/{{ApiProxyName}}'),
  ]
  await harness.invoke('testSuite:importEndpoints', {
    suite_id: suiteId,
    endpoint_ids: ids,
    source_folder_id: core,
  })
  const listed = (await harness.invoke('testSuite:listEndpoints', suiteId)) as {
    data: { items: Array<{ id: string }> }
  }
  return listed.data.items.map((i) => i.id)
}

describe('a suite built from APIs runs like the collection', () => {
  it('sends module by module with the folder pre-request script applied', async () => {
    const ids = await buildSuite()
    const res = (await harness.invoke('runner:execute', {
      projectId,
      environmentId: envId,
      endpointIds: ids,
    })) as { success: boolean }
    expect(res.success).toBe(true)
    expect(sent).toEqual([
      'http://api.test/init',
      'http://api.test/token',
      'http://api.test/proxy/col-r42-api-proxy',
      'http://api.test/deploy/col-r42-api-proxy',
    ])
  })

  it('re-sorts a stale interleaved id list (e.g. a scheduled task saved before the fix)', async () => {
    const ids = await buildSuite()
    const interleaved = [ids[0], ids[2], ids[1], ids[3]]
    expect(inSuiteExecutionOrder(interleaved)).toEqual(ids)

    await harness.invoke('runner:execute', {
      projectId,
      environmentId: envId,
      endpointIds: interleaved,
    })
    expect(sent[1]).toBe('http://api.test/token')
  })

  it('leaves a non-suite id list exactly as given', () => {
    const init = seedFolder('X', null)
    const a = seedEndpoint('A', init, 1, 'http://api.test/a')
    const b = seedEndpoint('B', init, 0, 'http://api.test/b')
    expect(inSuiteExecutionOrder([a, b])).toEqual([a, b])
  })
})
