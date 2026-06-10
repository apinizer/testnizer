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
