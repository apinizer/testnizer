/**
 * `pm.request` works the same in a run as it does on Send.
 *
 * The Send path has honoured `pm.request.headers.{add,upsert,remove}` since
 * BUG-02, folding a script's header mutations into the outgoing request. The
 * Runner's `pm.request` was a literal stub — `{ method: '', url: '',
 * headers: {} }` — so on the Run path a script could not read the URL it was
 * about to send, and a header it added simply vanished.
 *
 * That is the Send/Run divergence `src/shared/script/` exists to prevent: a
 * collection whose pre-request script attaches a correlation or auth header
 * passed when sent by hand and failed in the Runner, with nothing to show why.
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

/** Captures exactly what the engine was asked to send. */
const sentHeaders: Array<Record<string, string>> = []
vi.mock('../../../src/main/protocols/http.engine', () => ({
  stripUrlCredentials: (u: string) => u,
  executeHttpRequest: vi.fn(
    async (opts: { url: string; headers?: Array<{ key: string; value: string; enabled?: boolean }> }) => {
      const map: Record<string, string> = {}
      for (const h of opts.headers ?? []) {
        if (h.enabled === false) continue
        map[h.key.toLowerCase()] = h.value
      }
      sentHeaders.push(map)
      return {
        status: 200,
        statusText: 'OK',
        headers: {},
        cookies: [],
        body: '{"ok":true}',
        bodySize: 11,
        timing: { total: 1 },
        actualRequest: { method: 'GET', url: opts.url, headers: map, body: '' },
      }
    },
  ),
}))

const { registerRunnerHandlers } = await import('../../../src/main/ipc/runner.handler')

let projectId: string
let envId: string

function seedEnvActive(db: Database.Database, project: string): string {
  const id = crypto.randomUUID()
  const ws = db.prepare('SELECT workspace_id FROM projects WHERE id = ?').get(project) as {
    workspace_id: string
  }
  db.prepare(
    `INSERT INTO environments (id, workspace_id, project_id, name, is_active, created_at, updated_at)
     VALUES (?, ?, ?, 'Env', 1, ?, ?)`,
  ).run(id, ws.workspace_id, project, Date.now(), Date.now())
  db.prepare(
    `INSERT INTO environment_variables (id, environment_id, key, value, enabled, secret, initial_value)
     VALUES (?, ?, 'token', 'tok-123', 1, 0, 'tok-123')`,
  ).run(crypto.randomUUID(), id)
  return id
}

function seedEndpoint(
  db: Database.Database,
  project: string,
  schema: Record<string, unknown>,
): string {
  const id = crypto.randomUUID()
  db.prepare(
    `INSERT INTO endpoints (id, project_id, folder_id, name, protocol, method, path, status, request_schema, sort_order, created_at, updated_at)
     VALUES (?, ?, NULL, 'EP', 'http', 'GET', '/x', 'developing', ?, 0, ?, ?)`,
  ).run(id, project, JSON.stringify(schema), Date.now(), Date.now())
  return id
}

const run = (endpointIds: string[]) =>
  harness.invoke('runner:execute', { projectId, environmentId: envId, endpointIds }) as Promise<{
    success: boolean
    data?: { envUpdates: Record<string, string> }
  }>

beforeEach(() => {
  harness.reset()
  sentHeaders.length = 0
  testDb = createTestDb()
  projectId = seedProject(testDb, seedWorkspace(testDb))
  envId = seedEnvActive(testDb, projectId)
  registerRunnerHandlers()
})

describe('pm.request in a run', () => {
  it('ships a header the pre-request script added', async () => {
    const ep = seedEndpoint(testDb, projectId, {
      url: 'http://api.test/x',
      method: 'GET',
      preScript: `pm.request.headers.upsert({ key: 'X-Correlation', value: 'abc' })`,
    })

    const res = await run([ep])

    expect(res.success).toBe(true)
    // The bug: the header never reached the engine.
    expect(sentHeaders[0]['x-correlation']).toBe('abc')
  })

  it('resolves {{variables}} in a script-added header', async () => {
    const ep = seedEndpoint(testDb, projectId, {
      url: 'http://api.test/x',
      method: 'GET',
      preScript: `pm.request.headers.upsert({ key: 'Authorization', value: 'Bearer {{token}}' })`,
    })

    await run([ep])

    // The runner resolves AFTER the scripts, so a script-added header is
    // expanded exactly like a typed one.
    expect(sentHeaders[0]['authorization']).toBe('Bearer tok-123')
  })

  it('lets the script read the request it is about to send', async () => {
    const ep = seedEndpoint(testDb, projectId, {
      url: 'http://api.test/orders',
      method: 'GET',
      preScript: `
        pm.environment.set('sawUrl', String(pm.request.url))
        pm.environment.set('sawMethod', String(pm.request.method))
        pm.environment.set('sawTyped', String(pm.request.headers.get('X-Typed')))
      `,
      headers: [{ key: 'X-Typed', value: 'typed-value', enabled: true }],
    })

    const res = await run([ep])
    const u = res.data!.envUpdates

    // All three were empty strings before: `pm.request` was a stub.
    expect(u.sawUrl).toBe('http://api.test/orders')
    expect(u.sawMethod).toBe('GET')
    expect(u.sawTyped).toBe('typed-value')
  })

  it('keeps the user’s typed headers when the script adds one', async () => {
    const ep = seedEndpoint(testDb, projectId, {
      url: 'http://api.test/x',
      method: 'GET',
      headers: [{ key: 'X-Typed', value: 'kept', enabled: true }],
      preScript: `pm.request.headers.upsert({ key: 'X-Added', value: 'new' })`,
    })

    await run([ep])

    expect(sentHeaders[0]['x-typed']).toBe('kept')
    expect(sentHeaders[0]['x-added']).toBe('new')
  })

  it('honours a removal', async () => {
    const ep = seedEndpoint(testDb, projectId, {
      url: 'http://api.test/x',
      method: 'GET',
      headers: [{ key: 'X-Drop-Me', value: 'gone', enabled: true }],
      preScript: `pm.request.headers.remove('x-drop-me')`,
    })

    await run([ep])

    expect(sentHeaders[0]['x-drop-me']).toBeUndefined()
  })

  it('does not revive a disabled header when a script runs', async () => {
    // The fold marks everything in the collection as enabled, so seeding it
    // from the raw list would send a header the user had unchecked.
    const ep = seedEndpoint(testDb, projectId, {
      url: 'http://api.test/x',
      method: 'GET',
      headers: [
        { key: 'X-Off', value: 'should-not-ship', enabled: false },
        { key: 'X-On', value: 'ships', enabled: true },
      ],
      preScript: `pm.request.headers.upsert({ key: 'X-Added', value: 'new' })`,
    })

    await run([ep])

    expect(sentHeaders[0]['x-off']).toBeUndefined()
    expect(sentHeaders[0]['x-on']).toBe('ships')
    expect(sentHeaders[0]['x-added']).toBe('new')
  })

  it('hides a disabled header from the script, as Send does', async () => {
    const ep = seedEndpoint(testDb, projectId, {
      url: 'http://api.test/x',
      method: 'GET',
      headers: [{ key: 'X-Off', value: 'hidden', enabled: false }],
      preScript: `pm.environment.set('sawOff', String(pm.request.headers.get('X-Off')))`,
    })

    const res = await run([ep])
    expect(res.data!.envUpdates.sawOff).toBe('undefined')
  })

  it('leaves headers untouched when there is no pre-request script', async () => {
    const ep = seedEndpoint(testDb, projectId, {
      url: 'http://api.test/x',
      method: 'GET',
      headers: [
        { key: 'X-Typed', value: 'kept', enabled: true },
        { key: 'X-Disabled', value: 'no', enabled: false },
      ],
    })

    await run([ep])

    expect(sentHeaders[0]['x-typed']).toBe('kept')
    // A disabled row must not be revived by the fold.
    expect(sentHeaders[0]['x-disabled']).toBeUndefined()
  })
})
