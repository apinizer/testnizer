/**
 * Runner-level coverage for folder auth inheritance + cascade scripts.
 *
 * Project-level inheritance needs electron-store (covered by the pure-function
 * suite); here we exercise the DB-backed folder chain end-to-end through
 * `runner:execute`, capturing what the (stubbed) HTTP engine actually received.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setupHandlerHarness, makeElectronMock, createTestDb, seedProject, seedWorkspace } from './helpers'
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

// Capturing HTTP engine stub — records the resolved options of each call.
const sent: Array<{ url: string; auth: unknown }> = []
vi.mock('../../../src/main/protocols/http.engine', () => ({
  stripUrlCredentials: (u: string) => u,
  executeHttpRequest: vi.fn(async (opts: { url: string; auth: unknown }) => {
    sent.push({ url: opts.url, auth: opts.auth })
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

const { registerRunnerHandlers } = await import('../../../src/main/ipc/runner.handler')

let projectId: string
let envId: string

function seedEnv(db: Database.Database, project: string, vars: Record<string, string>): string {
  const id = crypto.randomUUID()
  const now = Date.now()
  const ws = db.prepare('SELECT workspace_id FROM projects WHERE id = ?').get(project) as {
    workspace_id: string
  }
  db.prepare(
    `INSERT INTO environments (id, workspace_id, project_id, name, is_active, created_at, updated_at)
     VALUES (?, ?, ?, 'Env', 1, ?, ?)`,
  ).run(id, ws.workspace_id, project, now, now)
  for (const [k, v] of Object.entries(vars)) {
    db.prepare(
      `INSERT INTO environment_variables (id, environment_id, key, value, enabled, secret, initial_value)
       VALUES (?, ?, ?, ?, 1, 0, ?)`,
    ).run(crypto.randomUUID(), id, k, v, v)
  }
  return id
}

function seedFolder(
  db: Database.Database,
  project: string,
  opts: { name: string; parent_id?: string | null; auth?: unknown; pre_script?: string },
): string {
  const id = crypto.randomUUID()
  db.prepare(
    `INSERT INTO folders (id, project_id, parent_id, name, sort_order, auth, pre_script, post_script)
     VALUES (?, ?, ?, ?, 0, ?, ?, NULL)`,
  ).run(
    id,
    project,
    opts.parent_id ?? null,
    opts.name,
    opts.auth ? JSON.stringify(opts.auth) : null,
    opts.pre_script ?? null,
  )
  return id
}

function seedEndpoint(
  db: Database.Database,
  project: string,
  folderId: string | null,
  schema: Record<string, unknown>,
): string {
  const id = crypto.randomUUID()
  const now = Date.now()
  db.prepare(
    `INSERT INTO endpoints (id, project_id, folder_id, name, protocol, method, path, status, request_schema, sort_order, created_at, updated_at)
     VALUES (?, ?, ?, 'EP', 'http', ?, ?, 'developing', ?, 0, ?, ?)`,
  ).run(
    id,
    project,
    folderId,
    (schema.method as string) ?? 'GET',
    (schema.url as string) ?? '/',
    JSON.stringify(schema),
    now,
    now,
  )
  return id
}

beforeEach(() => {
  harness.reset()
  sent.length = 0
  testDb = createTestDb()
  projectId = seedProject(testDb, seedWorkspace(testDb))
  envId = seedEnv(testDb, projectId, { tok: 'SECRET123' })
  registerRunnerHandlers()
})

describe('runner — folder auth inheritance', () => {
  it('a request with auth:inherit picks up the folder bearer and resolves its {{var}}', async () => {
    const folderId = seedFolder(testDb, projectId, {
      name: 'Secured',
      auth: { type: 'bearer', bearer: { token: '{{tok}}', prefix: 'Bearer' } },
    })
    const ep = seedEndpoint(testDb, projectId, folderId, {
      url: 'http://api.test/x',
      method: 'GET',
      auth: { type: 'inherit' },
    })

    const res = (await harness.invoke('runner:execute', {
      projectId,
      environmentId: envId,
      endpointIds: [ep],
    })) as { success: boolean }
    expect(res.success).toBe(true)
    expect(sent).toHaveLength(1)
    expect(sent[0].auth).toEqual({ type: 'bearer', bearer: { token: 'SECRET123', prefix: 'Bearer' } })
  })

  it('inner folder auth overrides outer; explicit request auth is not overridden', async () => {
    const outer = seedFolder(testDb, projectId, {
      name: 'Outer',
      auth: { type: 'bearer', bearer: { token: 'OUTER', prefix: 'Bearer' } },
    })
    const inner = seedFolder(testDb, projectId, {
      name: 'Inner',
      parent_id: outer,
      auth: { type: 'bearer', bearer: { token: 'INNER', prefix: 'Bearer' } },
    })
    const inheritEp = seedEndpoint(testDb, projectId, inner, {
      url: 'http://api.test/a',
      method: 'GET',
      auth: { type: 'inherit' },
    })
    const ownEp = seedEndpoint(testDb, projectId, inner, {
      url: 'http://api.test/b',
      method: 'GET',
      auth: { type: 'bearer', bearer: { token: 'OWN', prefix: 'Bearer' } },
    })

    await harness.invoke('runner:execute', {
      projectId,
      environmentId: envId,
      endpointIds: [inheritEp, ownEp],
    })
    const byUrl = Object.fromEntries(sent.map((s) => [s.url, s.auth]))
    expect(byUrl['http://api.test/a']).toMatchObject({ bearer: { token: 'INNER' } })
    expect(byUrl['http://api.test/b']).toMatchObject({ bearer: { token: 'OWN' } })
  })
})

describe('runner — cascade pre-request scripts', () => {
  it('a folder pre-request script sets a var the request URL then resolves', async () => {
    const folderId = seedFolder(testDb, projectId, {
      name: 'WithScript',
      pre_script: "pm.environment.set('dynPath', 'fromFolder')",
    })
    const ep = seedEndpoint(testDb, projectId, folderId, {
      url: 'http://api.test/{{dynPath}}',
      method: 'GET',
      auth: { type: 'none' },
    })

    await harness.invoke('runner:execute', {
      projectId,
      environmentId: envId,
      endpointIds: [ep],
    })
    expect(sent).toHaveLength(1)
    expect(sent[0].url).toBe('http://api.test/fromFolder')
  })
})

// ── Suite-item folder cascade (test_suite_folders, not the APIs `folders`) ──
// Imported suites store their hierarchy under test_suite_folders; the runner
// must walk THAT table (buildSuiteFolderChain) so folder-level setup scripts +
// inherited auth cascade for suite items the same way they do for APIs endpoints.
function seedSuite(db: Database.Database, project: string): string {
  const id = crypto.randomUUID()
  const now = Date.now()
  db.prepare(
    `INSERT INTO test_suites (id, project_id, name, sort_order, created_at, updated_at)
     VALUES (?, ?, 'Suite', 0, ?, ?)`,
  ).run(id, project, now, now)
  return id
}

function seedSuiteFolder(
  db: Database.Database,
  suiteId: string,
  opts: { name: string; parent_id?: string | null; auth?: unknown; pre_script?: string },
): string {
  const id = crypto.randomUUID()
  db.prepare(
    `INSERT INTO test_suite_folders (id, suite_id, parent_id, name, sort_order, auth, pre_script, post_script, created_at)
     VALUES (?, ?, ?, ?, 0, ?, ?, NULL, ?)`,
  ).run(
    id,
    suiteId,
    opts.parent_id ?? null,
    opts.name,
    opts.auth ? JSON.stringify(opts.auth) : null,
    opts.pre_script ?? null,
    Date.now(),
  )
  return id
}

function seedSuiteItem(
  db: Database.Database,
  suiteId: string,
  folderId: string | null,
  schema: Record<string, unknown>,
): string {
  const id = crypto.randomUUID()
  const now = Date.now()
  db.prepare(
    `INSERT INTO test_suite_items
       (id, suite_id, folder_id, protocol, name, method, url, request_schema, assertions,
        source_endpoint_id, sort_order, created_at, updated_at)
     VALUES (?, ?, ?, 'http', ?, ?, ?, ?, NULL, NULL, 0, ?, ?)`,
  ).run(
    id,
    suiteId,
    folderId,
    (schema.name as string) ?? 'Item',
    (schema.method as string) ?? 'GET',
    (schema.url as string) ?? '/',
    JSON.stringify(schema),
    now,
    now,
  )
  return id
}

describe('runner — suite folder cascade', () => {
  it('a suite folder pre-request script sets a var the suite item URL then resolves', async () => {
    const suiteId = seedSuite(testDb, projectId)
    const folderId = seedSuiteFolder(testDb, suiteId, {
      name: '01 Setup',
      pre_script: "pm.environment.set('dynPath', 'fromSuiteFolder')",
    })
    const item = seedSuiteItem(testDb, suiteId, folderId, {
      url: 'http://api.test/{{dynPath}}',
      method: 'GET',
      auth: { type: 'none' },
    })

    const res = (await harness.invoke('runner:execute', {
      projectId,
      environmentId: envId,
      endpointIds: [item],
    })) as { success: boolean }
    expect(res.success).toBe(true)
    expect(sent).toHaveLength(1)
    // Without buildSuiteFolderChain this stays unresolved ({{dynPath}}).
    expect(sent[0].url).toBe('http://api.test/fromSuiteFolder')
  })

  it('a suite item with auth:inherit picks up the nested suite-folder bearer + {{var}}', async () => {
    const suiteId = seedSuite(testDb, projectId)
    const outer = seedSuiteFolder(testDb, suiteId, {
      name: 'Outer',
      auth: { type: 'bearer', bearer: { token: 'OUTER', prefix: 'Bearer' } },
    })
    const inner = seedSuiteFolder(testDb, suiteId, {
      name: 'Inner',
      parent_id: outer,
      auth: { type: 'bearer', bearer: { token: '{{tok}}', prefix: 'Bearer' } },
    })
    const item = seedSuiteItem(testDb, suiteId, inner, {
      url: 'http://api.test/secured',
      method: 'GET',
      auth: { type: 'inherit' },
    })

    await harness.invoke('runner:execute', {
      projectId,
      environmentId: envId,
      endpointIds: [item],
    })
    expect(sent).toHaveLength(1)
    // Inner folder wins over outer, and its {{tok}} resolves from the env.
    expect(sent[0].auth).toEqual({ type: 'bearer', bearer: { token: 'SECRET123', prefix: 'Bearer' } })
  })

  it('pm.variables.set propagates to a later request within the same run', async () => {
    // Scope item (T-05): stock Postman/Insomnia keep pm.variables request-local,
    // but we deliberately propagate them across the run (not to the DB).
    const suiteId = seedSuite(testDb, projectId)
    const setItem = seedSuiteItem(testDb, suiteId, null, {
      url: 'http://api.test/seed',
      method: 'GET',
      auth: { type: 'none' },
      preScript: "pm.variables.set('vp', 'VARVAL')",
    })
    const useItem = seedSuiteItem(testDb, suiteId, null, {
      url: 'http://api.test/{{vp}}',
      method: 'GET',
      auth: { type: 'none' },
    })
    await harness.invoke('runner:execute', {
      projectId,
      environmentId: envId,
      endpointIds: [setItem, useItem],
    })
    expect(sent).toHaveLength(2)
    expect(sent[1].url).toBe('http://api.test/VARVAL')
  })

  it('cross-request env writes flow Setup → later item (token/derive pattern)', async () => {
    // Mirrors the real APIOPS flow: a Setup item runs environment.set('runId', …),
    // a later item derives + uses it. Both share the run's envVars.
    const suiteId = seedSuite(testDb, projectId)
    const setupItem = seedSuiteItem(testDb, suiteId, null, {
      url: 'http://api.test/init',
      method: 'GET',
      auth: { type: 'none' },
      preScript: "pm.environment.set('ApiProxyName', 'col-' + 'abc' + '-api-proxy')",
    })
    const useItem = seedSuiteItem(testDb, suiteId, null, {
      url: 'http://api.test/{{ApiProxyName}}/deploy',
      method: 'GET',
      auth: { type: 'none' },
    })

    await harness.invoke('runner:execute', {
      projectId,
      environmentId: envId,
      endpointIds: [setupItem, useItem],
    })
    expect(sent).toHaveLength(2)
    expect(sent[1].url).toBe('http://api.test/col-abc-api-proxy/deploy')
  })

  it('pm.execution.setNextRequest jumps over a request to a named one', async () => {
    // A → setNextRequest('C') skips B and lands on C. Run order A, C.
    const suiteId = seedSuite(testDb, projectId)
    const a = seedSuiteItem(testDb, suiteId, null, {
      name: 'A',
      url: 'http://api.test/a',
      method: 'GET',
      auth: { type: 'none' },
      postScript: "pm.execution.setNextRequest('C')",
    })
    const b = seedSuiteItem(testDb, suiteId, null, {
      name: 'B',
      url: 'http://api.test/b',
      method: 'GET',
      auth: { type: 'none' },
    })
    const c = seedSuiteItem(testDb, suiteId, null, {
      name: 'C',
      url: 'http://api.test/c',
      method: 'GET',
      auth: { type: 'none' },
    })

    await harness.invoke('runner:execute', {
      projectId,
      environmentId: envId,
      endpointIds: [a, b, c],
    })
    expect(sent.map((s) => s.url)).toEqual(['http://api.test/a', 'http://api.test/c'])
  })
})
