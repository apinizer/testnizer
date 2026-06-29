/**
 * E — import → run integration guard.
 *
 * Imports a synthetic (secret-free) Insomnia v5 collection that mirrors the real
 * APIOPS customer file's STRUCTURE — nested Setup/Flow/Teardown folders, a
 * folder-level bearer auth, a cross-request derive flow (Setup sets a var that a
 * later request consumes), an out-of-array-order sortKey, and a bundled
 * environment — then RUNS the resulting suite and asserts the end-to-end
 * behaviour the whole PR is about: order preserved, env auto-active, derived
 * {{vars}} resolved, folder auth applied.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  setupHandlerHarness,
  makeElectronMock,
  createTestDb,
  seedProject,
  seedWorkspace,
} from './helpers'
import fs from 'node:fs'
import path from 'node:path'

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

// Capturing HTTP engine stub — records what the runner actually sent.
const sent: Array<{ method: string; url: string; auth: unknown; projectId?: string }> = []
vi.mock('../../../src/main/protocols/http.engine', () => ({
  stripUrlCredentials: (u: string) => u,
  executeHttpRequest: vi.fn(
    async (opts: { method: string; url: string; auth: unknown; projectId?: string }) => {
      sent.push({ method: opts.method, url: opts.url, auth: opts.auth, projectId: opts.projectId })
      return {
        status: 200,
        statusText: 'OK',
        headers: {},
        body: '{}',
        bodySize: 2,
        timing: { total: 1 },
        actualRequest: { method: opts.method, url: opts.url, headers: {}, body: '' },
      }
    },
  ),
}))

const { importTestSuiteFromFile } = await import('../../../src/main/ipc/save.handler')
const { registerRunnerHandlers } = await import('../../../src/main/ipc/runner.handler')

const FIXTURE = fs.readFileSync(
  path.join(__dirname, '../../fixtures/import-export/apiops-nested-suite.insomnia-v5.json'),
  'utf8',
)

let projectId: string

beforeEach(() => {
  harness.reset()
  sent.length = 0
  testDb = createTestDb()
  projectId = seedProject(testDb, seedWorkspace(testDb))
  registerRunnerHandlers()
})

describe('suite import → run end-to-end (synthetic APIOPS)', () => {
  it('preserves nested structure on import, then runs in order with derived vars + folder auth', async () => {
    // ── Import ──
    const out = await importTestSuiteFromFile(FIXTURE, projectId)
    expect(out.format).toBe('insomnia')
    expect(out.itemsImported).toBe(3)

    // Folder tree rebuilt under test_suite_folders (3 folders, all top-level here).
    const folderNames = (
      testDb
        .prepare('SELECT name FROM test_suite_folders WHERE suite_id = ? ORDER BY sort_order')
        .all(out.suiteId) as { name: string }[]
    ).map((f) => f.name)
    expect(folderNames).toEqual(['00 Setup', '01 Flow', '02 Teardown'])

    // The bundled environment was imported AND activated (fresh project).
    const activeEnv = testDb
      .prepare('SELECT name FROM environments WHERE project_id = ? AND is_active = 1')
      .get(projectId) as { name: string } | undefined
    expect(activeEnv?.name).toBe('Base (demo)')

    // ── Run ── items in sort order (Init → Use → Cleanup).
    const itemIds = (
      testDb
        .prepare('SELECT id, name FROM test_suite_items WHERE suite_id = ? ORDER BY sort_order')
        .all(out.suiteId) as { id: string; name: string }[]
    ).map((r) => r.id)
    expect(itemIds).toHaveLength(3)

    const res = (await harness.invoke('runner:execute', {
      projectId,
      // No environmentId on purpose — the runner must fall back to the active
      // env (B-10), proving the imported {{vars}} resolve.
      endpointIds: itemIds,
    })) as { success: boolean }
    expect(res.success).toBe(true)
    expect(sent).toHaveLength(3)

    // Order preserved: Setup → Flow → Teardown.
    expect(sent.map((s) => s.method)).toEqual(['POST', 'GET', 'DELETE'])

    // Cross-request derive: Setup's pre-script set ProxyName from runId (r1), and
    // the Flow + Teardown requests resolved {{baseUrl}}/{{ProxyName}}.
    expect(sent[0].url).toBe('http://localhost:9999/init')
    expect(sent[1].url).toBe('http://localhost:9999/proxies/proxy-r1')
    expect(sent[2].url).toBe('http://localhost:9999/proxies/proxy-r1')

    // Folder-level bearer auth ({{token}}) reached the Flow request and resolved.
    expect(sent[1].auth).toMatchObject({ type: 'bearer', bearer: { token: 'demo-token' } })

    // C-cookie (TEST-07): every request carried the run's projectId, so the
    // engine scopes the cookie jar to this project instead of the shared
    // "_default" jar — Send/Run parity on session-cookie (login → protected)
    // flows. Without `resolvedOptions.projectId = options.projectId` this is
    // undefined and cookie-auth suites that pass on Send 401 in the Runner.
    expect(sent.map((s) => s.projectId)).toEqual([projectId, projectId, projectId])
  })
})

describe('suite import → run end-to-end (Postman collection)', () => {
  // The Postman sibling of the Insomnia fixture above. Same Setup/Flow/Teardown
  // shape — folder pre-request token script + folder bearer auth + a cross-
  // request derive — expressed as a Postman v2.1 collection. This locks the
  // FULL path the P0 importPostman fix was about: import → suite snapshot →
  // runner cascade. Before that fix the folder scripts/auth landed as NULL in
  // test_suite_folders and the Flow request would 401; here we assert the run
  // actually carries the resolved bearer token and derived var.
  const POSTMAN_COLLECTION = {
    info: {
      name: 'APIOPS Postman',
      schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
    },
    // Postman has no bundled environment — its collection variables are imported
    // as the project's (auto-activated) environment, mirroring the Insomnia env.
    variable: [
      { key: 'baseUrl', value: 'http://localhost:9999' },
      { key: 'token', value: 'demo-token' },
      { key: 'runId', value: 'r1' },
    ],
    // Array order IS run order in Postman (no sortKey): Setup → Flow → Teardown.
    item: [
      {
        name: '00 Setup',
        event: [
          {
            listen: 'prerequest',
            script: { exec: ["pm.environment.set('AccessChecked', 'yes');"] },
          },
        ],
        item: [
          {
            name: 'Init proxy name',
            event: [
              {
                listen: 'prerequest',
                script: {
                  exec: [
                    "pm.environment.set('ProxyName', 'proxy-' + (pm.environment.get('runId') || 'x'));",
                  ],
                },
              },
            ],
            request: { method: 'POST', url: '{{baseUrl}}/init' },
          },
        ],
      },
      {
        name: '01 Flow',
        auth: { type: 'bearer', bearer: [{ key: 'token', value: '{{token}}' }] },
        item: [
          {
            name: 'Use proxy',
            request: { method: 'GET', url: '{{baseUrl}}/proxies/{{ProxyName}}' },
          },
        ],
      },
      {
        name: '02 Teardown',
        item: [
          {
            name: 'Cleanup proxy',
            event: [
              {
                listen: 'test',
                script: { exec: ["pm.test('cleanup ok', () => pm.expect(true).to.be.true);"] },
              },
            ],
            request: { method: 'DELETE', url: '{{baseUrl}}/proxies/{{ProxyName}}' },
          },
        ],
      },
    ],
  }

  it('imports a Postman Setup/Flow/Teardown collection, then runs with folder token cascade + derived vars', async () => {
    // ── Import ──
    const out = await importTestSuiteFromFile(JSON.stringify(POSTMAN_COLLECTION), projectId)
    expect(out.format).toBe('postman')
    expect(out.itemsImported).toBe(3)

    // Folder tree rebuilt under test_suite_folders WITH cascade metadata intact
    // (the P0 parity fix — folder event[]/auth survive into the suite snapshot).
    const folders = testDb
      .prepare(
        'SELECT name, auth, pre_script FROM test_suite_folders WHERE suite_id = ? ORDER BY name',
      )
      .all(out.suiteId) as { name: string; auth: string | null; pre_script: string | null }[]
    expect(folders.map((f) => f.name)).toEqual(['00 Setup', '01 Flow', '02 Teardown'])
    expect(folders.find((f) => f.name === '00 Setup')!.pre_script).toContain('AccessChecked')
    expect(JSON.parse(folders.find((f) => f.name === '01 Flow')!.auth!).type).toBe('bearer')

    // collection.variable → active project env (fresh project auto-activates it).
    const activeEnv = testDb
      .prepare('SELECT name FROM environments WHERE project_id = ? AND is_active = 1')
      .get(projectId) as { name: string } | undefined
    expect(activeEnv?.name).toBe('APIOPS Postman (imported)')

    // ── Run ── items in array order (Init → Use → Cleanup).
    const itemIds = (
      testDb
        .prepare('SELECT id FROM test_suite_items WHERE suite_id = ? ORDER BY sort_order')
        .all(out.suiteId) as { id: string }[]
    ).map((r) => r.id)
    expect(itemIds).toHaveLength(3)

    const res = (await harness.invoke('runner:execute', {
      projectId,
      // No environmentId — runner must fall back to the active env (B-10).
      endpointIds: itemIds,
    })) as { success: boolean }
    expect(res.success).toBe(true)
    expect(sent).toHaveLength(3)

    // Order preserved: Setup → Flow → Teardown.
    expect(sent.map((s) => s.method)).toEqual(['POST', 'GET', 'DELETE'])

    // Cross-request derive: Setup's pre-script set ProxyName from runId (r1), and
    // the Flow + Teardown requests resolved {{baseUrl}}/proxies/{{ProxyName}}.
    expect(sent[0].url).toBe('http://localhost:9999/init')
    expect(sent[1].url).toBe('http://localhost:9999/proxies/proxy-r1')
    expect(sent[2].url).toBe('http://localhost:9999/proxies/proxy-r1')

    // THE assertion that proves the P0 fix end-to-end: the folder-level bearer
    // auth ({{token}}) reached the Flow request and resolved. Before the
    // importPostman folder fix this was absent and the request would 401.
    expect(sent[1].auth).toMatchObject({ type: 'bearer', bearer: { token: 'demo-token' } })

    // Cookie-jar projectId parity (TEST-07) holds on the Postman path too.
    expect(sent.map((s) => s.projectId)).toEqual([projectId, projectId, projectId])
  })
})
