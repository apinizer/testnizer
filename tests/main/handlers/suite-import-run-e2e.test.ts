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
import { setupHandlerHarness, makeElectronMock, createTestDb, seedProject, seedWorkspace } from './helpers'
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
const sent: Array<{ method: string; url: string; auth: unknown }> = []
vi.mock('../../../src/main/protocols/http.engine', () => ({
  stripUrlCredentials: (u: string) => u,
  executeHttpRequest: vi.fn(async (opts: { method: string; url: string; auth: unknown }) => {
    sent.push({ method: opts.method, url: opts.url, auth: opts.auth })
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
  })
})
