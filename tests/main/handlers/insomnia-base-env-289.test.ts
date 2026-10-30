/**
 * Issue #289 / issue #281 follow-up — an imported Insomnia collection's base
 * environment on the Run path.
 *
 * The importer writes the base environment to the project variables (the
 * scope `insomnia.baseEnvironment` reads); with no environment selected
 * `insomnia.environment` is that scope too (Insomnia: `activeEnvironment ||
 * baseEnvironment`). A token captured with `insomnia.environment.set` in one
 * request resolves in the next and is persisted as a project variable.
 *
 * A project imported BEFORE this change has its base environment as an
 * ordinary active environment: the same scripts keep reading and writing it.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import crypto from 'node:crypto'
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
  executeHttpRequest: vi.fn(async (opts: { method: string; url: string }) => {
    sent.push(opts.url)
    return {
      status: 200,
      statusText: 'OK',
      headers: {},
      body: '{}',
      bodySize: 2,
      timing: { total: 1 },
      actualRequest: { method: opts.method, url: opts.url, headers: {}, body: '' },
    }
  }),
}))

const { importInsomnia } = await import('../../../src/main/ipc/import-export.handler')
const { registerRunnerHandlers } = await import('../../../src/main/ipc/runner.handler')

const LOGIN_POST = "insomnia.environment.set('accessToken', 'tok-' + insomnia.environment.get('AccessURL'));"
const ME_PRE =
  "insomnia.environment.set('seen', [insomnia.environment.get('accessToken'), insomnia.baseEnvironment.get('AccessURL')].join('|'));"

const v5Doc = {
  type: 'collection.insomnia.rest/5.0',
  name: 'APIOPS mini',
  collection: [
    {
      name: '01 Login',
      meta: { sortKey: -2 },
      method: 'POST',
      url: '{{AccessURL}}/login',
      scripts: { afterResponse: LOGIN_POST },
    },
    {
      name: '02 Me',
      meta: { sortKey: -1 },
      method: 'GET',
      url: '{{AccessURL}}/me?t={{accessToken}}',
      scripts: { preRequest: ME_PRE },
    },
  ],
  environments: { name: 'Base Environment', data: { AccessURL: 'http://h' } },
}

let workspaceId: string
let projectId: string

beforeEach(() => {
  harness.reset()
  sent.length = 0
  testDb = createTestDb()
  workspaceId = seedWorkspace(testDb)
  projectId = seedProject(testDb, workspaceId)
  registerRunnerHandlers()
})

function endpointIds(): string[] {
  return (
    testDb
      .prepare('SELECT id FROM endpoints WHERE project_id = ? ORDER BY sort_order')
      .all(projectId) as Array<{ id: string }>
  ).map((r) => r.id)
}

function projectVar(key: string): string | undefined {
  return (
    testDb
      .prepare('SELECT value FROM global_variables WHERE project_id = ? AND key = ?')
      .get(projectId, key) as { value: string } | undefined
  )?.value
}

async function run(ids: string[]): Promise<{ globalUpdates: Record<string, string> }> {
  const res = (await harness.invoke('runner:execute', { projectId, workspaceId, endpointIds: ids })) as {
    success: boolean
    data: { globalUpdates: Record<string, string> }
  }
  expect(res.success).toBe(true)
  return res.data
}

describe('Insomnia base environment on Run (issue #289)', () => {
  it('a fresh import: insomnia.environment reads and writes the project variables', async () => {
    const r = await importInsomnia(projectId, JSON.stringify(v5Doc))
    expect(r.success).toBe(true)
    expect(projectVar('AccessURL')).toBe('http://h')

    const data = await run(endpointIds())
    // The token captured by request 1 resolved in request 2, both in the URL
    // and through insomnia.environment / insomnia.baseEnvironment.
    expect(sent).toEqual(['http://h/login', 'http://h/me?t=tok-http://h'])
    expect(data.globalUpdates.seen).toBe('tok-http://h|http://h')
    // …and was persisted where the next run reads it: the project variables.
    expect(projectVar('accessToken')).toBe('tok-http://h')

    // A later run of request 2 alone still has the token.
    sent.length = 0
    await run([endpointIds()[1]])
    expect(sent).toEqual(['http://h/me?t=tok-http://h'])
  })

  it('a project imported earlier (base environment as an active environment) behaves as before', async () => {
    // The shape the importer used to produce.
    const now = Date.now()
    testDb
      .prepare(
        `INSERT INTO environments (id, workspace_id, project_id, name, is_active, created_at, updated_at)
         VALUES ('env-old', ?, ?, 'Base Environment', 1, ?, ?)`,
      )
      .run(workspaceId, projectId, now, now)
    testDb
      .prepare(
        `INSERT INTO environment_variables (id, environment_id, key, value, enabled, secret, initial_value)
         VALUES (?, 'env-old', 'AccessURL', 'http://old', 1, 0, 'http://old')`,
      )
      .run(crypto.randomUUID())
    for (const [i, item] of v5Doc.collection.entries()) {
      const schema = {
        method: item.method,
        url: item.url,
        params: [],
        headers: [],
        ...(item.scripts.preRequest ? { preScript: item.scripts.preRequest } : {}),
        ...(item.scripts.afterResponse ? { postScript: item.scripts.afterResponse } : {}),
      }
      testDb
        .prepare(
          `INSERT INTO endpoints (id, project_id, folder_id, name, protocol, method, path, status, request_schema, sort_order, created_at, updated_at)
           VALUES (?, ?, NULL, ?, 'http', ?, '/', 'developing', ?, ?, ?, ?)`,
        )
        .run(crypto.randomUUID(), projectId, item.name, item.method, JSON.stringify(schema), i, now, now)
    }

    await run(endpointIds())
    expect(sent).toEqual(['http://old/login', 'http://old/me?t=tok-http://old'])
    // Written to the environment, as before — not to the project variables.
    const envToken = testDb
      .prepare("SELECT value FROM environment_variables WHERE environment_id = 'env-old' AND key = 'accessToken'")
      .get() as { value: string } | undefined
    expect(envToken?.value).toBe('tok-http://old')
    expect(projectVar('accessToken')).toBeUndefined()
  })
})
