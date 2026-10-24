/**
 * Collection Runner variable scopes after the shared `pm` factory (issue #281).
 *
 * Run used to keep every variable in ONE map: `pm.globals.set('x')` overwrote
 * an environment `x` for the rest of the run, `pm.variables.set` values were
 * visible through `pm.environment`, and `pm.variables.get` had no data tier.
 * Now the run keeps global / environment / local layers and resolves `{{var}}`
 * with Postman's precedence (global < environment < local), and
 * `pm.variables.get` reads local > data > environment > global. These are
 * Run-only behaviours (Send has no iteration data and no later steps), so they
 * are pinned here rather than in the Send≡Run parity fixture.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import crypto from 'node:crypto'
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

const { registerRunnerHandlers } = await import('../../../src/main/ipc/runner.handler')

let projectId: string
let envId: string

function seedEnv(db: Database.Database, project: string, vars: Record<string, string>): string {
  const id = crypto.randomUUID()
  const ws = db.prepare('SELECT workspace_id FROM projects WHERE id = ?').get(project) as {
    workspace_id: string
  }
  db.prepare(
    `INSERT INTO environments (id, workspace_id, project_id, name, is_active, created_at, updated_at)
     VALUES (?, ?, ?, 'Env', 1, ?, ?)`,
  ).run(id, ws.workspace_id, project, Date.now(), Date.now())
  for (const [key, value] of Object.entries(vars)) {
    db.prepare(
      `INSERT INTO environment_variables (id, environment_id, key, value, enabled) VALUES (?, ?, ?, ?, 1)`,
    ).run(crypto.randomUUID(), id, key, value)
  }
  return id
}

let order = 0
function seedEndpoint(name: string, schema: Record<string, unknown>): string {
  const id = crypto.randomUUID()
  testDb
    .prepare(
      `INSERT INTO endpoints (id, project_id, folder_id, name, protocol, method, path, status, request_schema, sort_order, created_at, updated_at)
       VALUES (?, ?, NULL, ?, 'http', 'GET', '/x', 'developing', ?, ?, ?, ?)`,
    )
    .run(id, projectId, name, JSON.stringify(schema), order++, Date.now(), Date.now())
  return id
}

interface RunData {
  envUpdates: Record<string, string>
}

async function run(endpointIds: string[], extra: Record<string, unknown> = {}): Promise<RunData> {
  const res = (await harness.invoke('runner:execute', {
    projectId,
    environmentId: envId,
    endpointIds,
    ...extra,
  })) as { success: boolean; data?: RunData; error?: string }
  expect(res.success, res.error).toBe(true)
  return res.data!
}

beforeEach(() => {
  harness.reset()
  sent.length = 0
  testDb = createTestDb()
  projectId = seedProject(testDb, seedWorkspace(testDb))
  envId = seedEnv(testDb, projectId, { k: 'E', x: 'E', y: 'E0' })
  registerRunnerHandlers()
})

describe('Run variable scopes (issue #281)', () => {
  it('pm.variables.get: data row beats environment, a local beats the data row', async () => {
    const ep = seedEndpoint('A', {
      url: 'http://api.test/a',
      method: 'GET',
      preScript: `
        pm.environment.set('fromVars', pm.variables.get('k'));
        pm.environment.set('fromEnv', pm.environment.get('k'));
        pm.variables.set('k', 'L');
        pm.environment.set('afterLocal', pm.variables.get('k'));
      `,
    })
    const data = await run([ep], { iterationData: [{ k: 'D' }] })
    expect(data.envUpdates.fromVars).toBe('D')
    expect(data.envUpdates.fromEnv).toBe('E')
    expect(data.envUpdates.afterLocal).toBe('L')
  })

  it('a pm.globals.set no longer shadows the environment value for later requests', async () => {
    const a = seedEndpoint('A', {
      url: 'http://api.test/a',
      method: 'GET',
      postScript: "pm.globals.set('x', 'G')",
    })
    const b = seedEndpoint('B', { url: 'http://api.test/{{x}}', method: 'GET' })
    await run([a, b])
    // Postman precedence: environment over global. It used to be last-write-wins.
    expect(sent).toEqual(['http://api.test/a', 'http://api.test/E'])
  })

  it('a run-local from an earlier step shadows a later environment write of the same key', async () => {
    const a = seedEndpoint('A', {
      url: 'http://api.test/a',
      method: 'GET',
      postScript: "pm.variables.set('y', 'L')",
    })
    const b = seedEndpoint('B', {
      url: 'http://api.test/{{y}}',
      method: 'GET',
      preScript: "pm.environment.set('y', 'E2')",
    })
    const data = await run([a, b])
    expect(sent).toEqual(['http://api.test/a', 'http://api.test/L'])
    // The environment write itself is still recorded (and persisted).
    expect(data.envUpdates.y).toBe('E2')
  })
})
