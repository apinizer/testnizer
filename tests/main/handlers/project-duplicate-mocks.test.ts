/**
 * Issue #190 — `importProjectAsNew` (Duplicate Project / Import Project) never
 * copied HTTP mock servers, their endpoints and responses.
 * Issue #186 follow-up — the saved Runner configuration (`test_suites.run_config`)
 * was exported but no import path wrote it; on the fresh-id paths its suite
 * item / environment ids must follow the copy.
 *
 * Real save handlers, real `project:duplicate`, in-memory DB (foreign keys ON).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { randomUUID } from 'crypto'
import type Database from 'better-sqlite3'
import {
  setupHandlerHarness,
  makeElectronMock,
  createTestDb,
  seedProject,
  seedWorkspace,
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

let testDb: Database.Database
vi.mock('../../../src/main/db/database', () => ({
  getDb: () => testDb,
}))

vi.mock('../../../src/main/lib/secure-storage', () => ({
  encryptSecret: (s: string | null | undefined) => (s ? `enc:${s}` : null),
  decryptSecret: (s: string | null | undefined) => (s ? s.replace(/^enc:/, '') : null),
}))

vi.mock('../../../src/main/ipc/import-export.handler', () => ({
  importPostman: vi.fn(),
  importInsomnia: vi.fn(),
}))

vi.mock('../../../src/main/ipc/test-suite.handler', () => ({
  snapshotEndpointForSuite: vi.fn(() => ({})),
  ensureUniqueSuiteName: (_db: unknown, _pid: string, name: string) => name,
}))

const {
  registerSaveHandlers,
  exportProjectData,
  importProjectAsNew,
  exportTestSuiteData,
  importTestSuiteData,
} = await import('../../../src/main/ipc/save.handler')

type Row = Record<string, unknown>
type Envelope<T> = { success: boolean; error?: string; data?: T }

beforeEach(() => {
  harness.reset()
  registerSaveHandlers()
})

const BEARER_AUTH = JSON.stringify({ type: 'bearer', tokens: ['tok-1'] })
const BASIC_OVERRIDE = JSON.stringify({
  type: 'basic',
  users: [{ username: 'alice', password: 'alice-pw' }],
})

interface Seeded {
  workspaceId: string
  projectId: string
  envId: string
  suiteId: string
  itemId: string
  serverId: string
  endpointId: string
  responseIds: string[]
}

function runConfig(itemId: string, envId: string): string {
  return JSON.stringify({
    version: 1,
    items: [{ id: itemId, selected: false, phase: 'setup' }],
    delay: 250,
    iterationDelay: 0,
    iterations: 3,
    stopOnError: false,
    persistResponses: true,
    keepVariableValues: true,
    environmentId: envId,
  })
}

function seed(db: Database.Database): Seeded {
  const workspaceId = seedWorkspace(db)
  const projectId = seedProject(db, workspaceId, 'Mocked')
  const now = Date.now()
  const s: Seeded = {
    workspaceId,
    projectId,
    envId: randomUUID(),
    suiteId: randomUUID(),
    itemId: randomUUID(),
    serverId: randomUUID(),
    endpointId: randomUUID(),
    responseIds: [randomUUID(), randomUUID()],
  }
  db.prepare(
    `INSERT INTO environments (id, workspace_id, project_id, name, is_active, created_at, updated_at)
     VALUES (?, ?, ?, 'Dev', 1, ?, ?)`,
  ).run(s.envId, workspaceId, projectId, now, now)

  db.prepare(
    `INSERT INTO test_suites (id, project_id, name, sort_order, run_config, created_at, updated_at)
     VALUES (?, ?, 'Suite', 0, ?, ?, ?)`,
  ).run(s.suiteId, projectId, runConfig(s.itemId, s.envId), now, now)
  db.prepare(
    `INSERT INTO test_suite_items (id, suite_id, folder_id, protocol, name, method, url,
       request_schema, sort_order, created_at, updated_at)
     VALUES (?, ?, NULL, 'http', 'Item', 'GET', 'https://x.test', '{}', 0, ?, ?)`,
  ).run(s.itemId, s.suiteId, now, now)

  db.prepare(
    `INSERT INTO mock_servers (id, project_id, name, port, base_path, auto_start, auth_config, created_at, updated_at)
     VALUES (?, ?, 'Orders mock', 4701, '/api', 1, ?, ?, ?)`,
  ).run(s.serverId, projectId, BEARER_AUTH, now, now)
  db.prepare(
    `INSERT INTO mock_endpoints (id, server_id, method, path, priority, auth_override, created_at, updated_at)
     VALUES (?, ?, 'POST', '/orders', 5, ?, ?, ?)`,
  ).run(s.endpointId, s.serverId, BASIC_OVERRIDE, now, now)
  const insResp = db.prepare(
    `INSERT INTO mock_responses (id, endpoint_id, name, status_code, body, response_order)
     VALUES (?, ?, ?, ?, ?, ?)`,
  )
  insResp.run(s.responseIds[0], s.endpointId, 'Created', 201, '{"id":1}', 0)
  insResp.run(s.responseIds[1], s.endpointId, 'Conflict', 409, '{"error":"dup"}', 1)
  return s
}

function mockGraphOf(
  db: Database.Database,
  projectId: string,
): {
  servers: Row[]
  endpoints: Row[]
  responses: Row[]
} {
  const servers = db
    .prepare('SELECT * FROM mock_servers WHERE project_id = ?')
    .all(projectId) as Row[]
  const endpoints = db
    .prepare(
      `SELECT me.* FROM mock_endpoints me JOIN mock_servers ms ON ms.id = me.server_id
       WHERE ms.project_id = ?`,
    )
    .all(projectId) as Row[]
  const responses = db
    .prepare(
      `SELECT mr.* FROM mock_responses mr
       JOIN mock_endpoints me ON me.id = mr.endpoint_id
       JOIN mock_servers ms ON ms.id = me.server_id
       WHERE ms.project_id = ? ORDER BY mr.response_order`,
    )
    .all(projectId) as Row[]
  return { servers, endpoints, responses }
}

describe('Duplicate Project copies HTTP mock servers (issue #190)', () => {
  it('carries servers, endpoints and responses with fresh ids and remapped foreign keys', async () => {
    testDb = createTestDb()
    const s = seed(testDb)
    const res = (await harness.invoke('project:duplicate', {
      projectId: s.projectId,
      workspaceId: s.workspaceId,
    })) as Envelope<{ projectId: string }>
    expect(res.error).toBeUndefined()
    const copy = res.data!.projectId

    const { servers, endpoints, responses } = mockGraphOf(testDb, copy)
    expect(servers).toHaveLength(1)
    const server = servers[0]
    expect(server.id).not.toBe(s.serverId)
    expect(server).toMatchObject({
      name: 'Orders mock',
      port: 4701,
      base_path: '/api',
      // Local copy: secrets are NOT stripped (issue #177 strips files only).
      auth_config: BEARER_AUTH,
    })

    expect(endpoints).toHaveLength(1)
    expect(endpoints[0].id).not.toBe(s.endpointId)
    expect(endpoints[0]).toMatchObject({
      server_id: server.id,
      method: 'POST',
      path: '/orders',
      priority: 5,
      auth_override: BASIC_OVERRIDE,
    })

    expect(responses.map((r) => r.endpoint_id)).toEqual([endpoints[0].id, endpoints[0].id])
    expect(responses.map((r) => [r.name, r.status_code, r.body])).toEqual([
      ['Created', 201, '{"id":1}'],
      ['Conflict', 409, '{"error":"dup"}'],
    ])
    for (const r of responses) expect(s.responseIds).not.toContain(r.id)

    // The source graph is untouched.
    const source = mockGraphOf(testDb, s.projectId)
    expect(source.servers.map((r) => r.id)).toEqual([s.serverId])
    expect(source.endpoints.map((r) => r.id)).toEqual([s.endpointId])
    expect(source.responses.map((r) => r.id)).toEqual(s.responseIds)
  })

  it('the copy never auto-starts: auto_start = 0 on the copy, port kept, source unchanged', async () => {
    testDb = createTestDb()
    const s = seed(testDb)
    const res = (await harness.invoke('project:duplicate', {
      projectId: s.projectId,
      workspaceId: s.workspaceId,
    })) as Envelope<{ projectId: string }>
    expect(res.error).toBeUndefined()
    const copy = mockGraphOf(testDb, res.data!.projectId).servers
    expect(copy).toHaveLength(1)
    // Same port as the original: starting both at launch would fight for it,
    // so the user starts the copy by hand.
    expect(copy[0]).toMatchObject({ port: 4701, auto_start: 0 })
    const source = testDb
      .prepare('SELECT port, auto_start FROM mock_servers WHERE id = ?')
      .get(s.serverId) as Row
    expect(source).toEqual({ port: 4701, auto_start: 1 })

    // Import Project (fresh ids from a file) follows the same rule.
    const { projectId } = importProjectAsNew(exportProjectData(s.projectId), s.workspaceId, {
      name: 'Imported copy',
    })
    expect(mockGraphOf(testDb, projectId).servers[0]).toMatchObject({ port: 4701, auto_start: 0 })
  })

  it('an older file missing newer mock columns imports with the column defaults', () => {
    testDb = createTestDb()
    const s = seed(testDb)
    const data = exportProjectData(s.projectId)
    for (const m of data.mockServers ?? []) {
      delete m.proxy_record
      delete m.echo_enabled
    }
    for (const e of data.mockEndpoints ?? []) delete e.schema_validation
    for (const r of data.mockResponses ?? []) delete r.script

    const { projectId } = importProjectAsNew(data, s.workspaceId, { name: 'Old file' })
    const { servers, endpoints, responses } = mockGraphOf(testDb, projectId)
    expect(servers).toHaveLength(1)
    expect(servers[0]).toMatchObject({ proxy_record: 0, echo_enabled: 0 })
    expect(endpoints[0].schema_validation).toBe('')
    expect(responses.map((r) => r.script)).toEqual(['', ''])
  })
})

describe('saved Runner configuration on the fresh-id import paths (issue #186)', () => {
  it('Duplicate Project: run_config follows the copied suite item and environment', async () => {
    testDb = createTestDb()
    const s = seed(testDb)
    const res = (await harness.invoke('project:duplicate', {
      projectId: s.projectId,
      workspaceId: s.workspaceId,
    })) as Envelope<{ projectId: string }>
    expect(res.error).toBeUndefined()
    const copy = res.data!.projectId

    const suite = testDb
      .prepare('SELECT id, run_config FROM test_suites WHERE project_id = ?')
      .get(copy) as { id: string; run_config: string | null }
    const item = testDb
      .prepare('SELECT id FROM test_suite_items WHERE suite_id = ?')
      .get(suite.id) as { id: string }
    const env = testDb.prepare('SELECT id FROM environments WHERE project_id = ?').get(copy) as {
      id: string
    }
    expect(suite.run_config).not.toBeNull()
    expect(JSON.parse(suite.run_config!)).toEqual(JSON.parse(runConfig(item.id, env.id)))
  })

  it('Import Test Suite: run_config follows the new item ids; a foreign environment is dropped', () => {
    testDb = createTestDb()
    const s = seed(testDb)
    const file = exportTestSuiteData(s.suiteId)

    // Same project: the environment exists here, so it is kept.
    const same = importTestSuiteData(file, s.projectId)
    const sameRow = testDb
      .prepare('SELECT run_config FROM test_suites WHERE id = ?')
      .get(same.suiteId) as { run_config: string | null }
    const sameItem = testDb
      .prepare('SELECT id FROM test_suite_items WHERE suite_id = ?')
      .get(same.suiteId) as { id: string }
    expect(JSON.parse(sameRow.run_config!)).toEqual(JSON.parse(runConfig(sameItem.id, s.envId)))

    // Another project: the source environment does not belong to it.
    const other = seedProject(testDb, s.workspaceId, 'Other')
    const moved = importTestSuiteData(file, other)
    const movedCfg = JSON.parse(
      (
        testDb.prepare('SELECT run_config FROM test_suites WHERE id = ?').get(moved.suiteId) as {
          run_config: string
        }
      ).run_config,
    ) as Row
    expect(movedCfg.environmentId).toBeUndefined()
    expect(movedCfg.iterations).toBe(3)
  })
})
