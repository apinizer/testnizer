/**
 * Runner script-runtime parity (v1.4.18): the Collection Runner must expose the
 * SAME globals as the Send path — CryptoJS + the `t` alias — and the same pm
 * surface (pm.response.cookies, pm.*.toObject). A script using these used to
 * pass on Send but throw "CryptoJS is not defined" on Run.
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

vi.mock('../../../src/main/protocols/http.engine', () => ({
  stripUrlCredentials: (u: string) => u,
  executeHttpRequest: vi.fn(async (opts: { url: string }) => ({
    status: 200,
    statusText: 'OK',
    headers: { 'set-cookie': 'session=abc123; Path=/' },
    cookies: [{ name: 'session', value: 'abc123' }],
    body: '{"ok":true}',
    bodySize: 11,
    timing: { total: 1 },
    actualRequest: { method: 'GET', url: opts.url, headers: {}, body: '' },
  })),
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
     VALUES (?, ?, 'secret', 's3cr3t', 1, 0, 's3cr3t')`,
  ).run(crypto.randomUUID(), id)
  return id
}

function seedEndpoint(db: Database.Database, project: string, schema: Record<string, unknown>): string {
  const id = crypto.randomUUID()
  db.prepare(
    `INSERT INTO endpoints (id, project_id, folder_id, name, protocol, method, path, status, request_schema, sort_order, created_at, updated_at)
     VALUES (?, ?, NULL, 'EP', 'http', 'GET', '/x', 'developing', ?, 0, ?, ?)`,
  ).run(id, project, JSON.stringify(schema), Date.now(), Date.now())
  return id
}

beforeEach(() => {
  harness.reset()
  testDb = createTestDb()
  projectId = seedProject(testDb, seedWorkspace(testDb))
  envId = seedEnvActive(testDb, projectId)
  registerRunnerHandlers()
})

describe('runner script runtime parity', () => {
  it('CryptoJS + pm.response.cookies + toObject all work in a post-response script', async () => {
    const ep = seedEndpoint(testDb, projectId, {
      url: 'http://api.test/x',
      method: 'GET',
      postScript: `
        // pm.response.cookies — read the cookie the server set
        var sid = pm.response.cookies.get('session')
        pm.environment.set('sid', sid)
        // CryptoJS must be bound (parity with Send)
        var sig = CryptoJS.HmacSHA256(sid, pm.environment.get('secret')).toString()
        pm.environment.set('sig', sig)
        // toObject snapshot
        pm.environment.set('hasSecret', String(pm.environment.toObject().secret === 's3cr3t'))
        // t.* alias must also be bound
        t.environment.set('viaAlias', 'yes')
      `,
    })

    const res = (await harness.invoke('runner:execute', {
      projectId,
      environmentId: envId,
      endpointIds: [ep],
    })) as { success: boolean; data?: { envUpdates: Record<string, string> } }

    expect(res.success).toBe(true)
    const u = res.data!.envUpdates
    expect(u.sid).toBe('abc123')
    expect(u.sig).toHaveLength(64) // hex sha256 → CryptoJS worked
    expect(u.hasSecret).toBe('true')
    expect(u.viaAlias).toBe('yes') // t.* alias worked
  })

  it('pm.sendRequest fires an auxiliary request via the engine and is awaited', async () => {
    const ep = seedEndpoint(testDb, projectId, {
      url: 'http://api.test/main',
      method: 'GET',
      postScript: `
        var r = await pm.sendRequest('http://api.test/aux')
        pm.environment.set('auxOk', String(r.json().ok))
        pm.environment.set('auxCode', String(r.code))
      `,
    })
    const res = (await harness.invoke('runner:execute', {
      projectId,
      environmentId: envId,
      endpointIds: [ep],
    })) as { success: boolean; data?: { envUpdates: Record<string, string> } }
    expect(res.success).toBe(true)
    expect(res.data!.envUpdates.auxOk).toBe('true') // engine response reached the script
    expect(res.data!.envUpdates.auxCode).toBe('200')
  })

  // Parity with the Send path: pm.response.body must be the raw body string so
  // real token scripts (String(pm.response.body).trim() → JSON.parse) work. Was
  // undefined on Run → token scripts produced {} → accessToken cleared → 401.
  it('pm.response.body is the raw body string so token scripts can String()/parse it', async () => {
    const ep = seedEndpoint(testDb, projectId, {
      url: 'http://api.test/token',
      method: 'GET',
      postScript: `
        var raw = String(pm.response.body || '').trim();
        pm.environment.set('rawLen', String(raw.length));
        pm.environment.set('bodyIsString', String(typeof pm.response.body === 'string'));
        pm.environment.set('bodyEqualsText', String(pm.response.body === pm.response.text()));
        var json = pm.response.json();
        pm.environment.set('okFlag', String(json.ok));
        pm.test('body present + parseable', function () {
          pm.expect(raw).to.be.a('string').and.not.empty;
        });
      `,
    })
    const res = (await harness.invoke('runner:execute', {
      projectId,
      environmentId: envId,
      endpointIds: [ep],
    })) as { success: boolean; data?: { envUpdates: Record<string, string> } }
    expect(res.success).toBe(true)
    const u = res.data!.envUpdates
    expect(u.bodyIsString).toBe('true')
    expect(u.bodyEqualsText).toBe('true')
    expect(u.rawLen).toBe('11') // '{"ok":true}'.length — was '0' before the body fix
    expect(u.okFlag).toBe('true')
  })
})
