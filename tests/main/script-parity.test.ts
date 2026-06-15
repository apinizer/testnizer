/**
 * Run-path half of the Send≡Run script-parity proof.
 *
 * Drives the SAME fixtures (tests/fixtures/script-parity.ts) through the MAIN
 * Collection Runner. One endpoint per case carries the case's script as its
 * postScript; the http.engine mock is parametrized by URL so each endpoint gets
 * its own fixture response. After runner:execute we assert:
 *   - res.data.envUpdates matches the case's deterministic expectEnv
 *   - the case's per-endpoint result.assertions (pm.test outcomes) match
 *     expectTests
 *
 * Identical fixtures + identical expectations vs tests/renderer/script-parity.test.ts.
 * Both green ⇒ no Send/Run scripting drift (shared runtime src/shared/script/*).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  setupHandlerHarness,
  makeElectronMock,
  createTestDb,
  seedProject,
  seedWorkspace,
} from './handlers/helpers'
import crypto from 'node:crypto'
import type Database from 'better-sqlite3'
import { parityCases } from '../fixtures/script-parity'

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
vi.mock('../../src/main/db/database', () => ({ getDb: () => testDb }))

// Map endpoint URL → fixture response. The runner resolves `{{caseUrl}}` per
// endpoint; the engine mock looks the case up by that URL and returns the
// matching status/headers/body/cookies. This is how each case gets a distinct
// response through the single shared engine mock.
const urlToCaseIndex = new Map<string, number>()
function caseUrl(i: number): string {
  return `http://parity.test/case-${i}`
}
parityCases.forEach((_, i) => urlToCaseIndex.set(caseUrl(i), i))

vi.mock('../../src/main/protocols/http.engine', () => ({
  stripUrlCredentials: (u: string) => u,
  executeHttpRequest: vi.fn(async (opts: { url: string }) => {
    const idx = urlToCaseIndex.get(opts.url)
    const c = idx === undefined ? undefined : parityCases[idx]
    const r = c?.response
    const status = r?.status ?? 200
    const statusText = r?.statusText ?? 'OK'
    const headers = r?.headers ?? {}
    const body = r?.body ?? '{}'
    const cookies = r?.cookies ?? []
    return {
      status,
      statusText,
      headers,
      cookies,
      body,
      bodySize: body.length,
      timing: { total: 1 },
      actualRequest: { method: 'GET', url: opts.url, headers: {}, body: '' },
    }
  }),
}))

const { registerRunnerHandlers } = await import('../../src/main/ipc/runner.handler')

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

interface RunData {
  envUpdates: Record<string, string>
  results: Array<{
    endpointId: string
    assertions: Array<{ name: string; passed: boolean; error?: string }>
  }>
}

beforeEach(() => {
  harness.reset()
  testDb = createTestDb()
  projectId = seedProject(testDb, seedWorkspace(testDb))
  envId = seedEnvActive(testDb, projectId)
  registerRunnerHandlers()
})

describe('script parity — Run path (Collection Runner)', () => {
  for (let i = 0; i < parityCases.length; i++) {
    const c = parityCases[i]
    // Same known-bug handling as the Send-path test: run intended-but-broken
    // cases under it.fails. They fail IDENTICALLY to the Send path — that
    // identical failure is itself the parity proof for this case.
    const test = c.knownRuntimeBug ? it.fails : it
    test(c.name, async () => {
      const ep = seedEndpoint(testDb, projectId, {
        url: caseUrl(i),
        method: 'GET',
        postScript: c.script,
      })

      const res = (await harness.invoke('runner:execute', {
        projectId,
        environmentId: envId,
        endpointIds: [ep],
      })) as { success: boolean; data?: RunData; error?: string }

      expect(res.success, res.error).toBe(true)
      const data = res.data!

      // Env writes — subset match against the run-level envUpdates.
      for (const [key, value] of Object.entries(c.expectEnv)) {
        expect(data.envUpdates[key], `env ${key}`).toBe(value)
      }

      // pm.test / legacy tests[] outcomes — pulled from this endpoint's result.
      const epResult = data.results.find((r) => r.endpointId === ep)
      expect(epResult, 'endpoint result present').toBeDefined()
      for (const t of c.expectTests) {
        const hit = epResult!.assertions.find((a) => a.name === t.name)
        expect(hit, `test "${t.name}" present`).toBeDefined()
        expect(hit!.passed, `test "${t.name}" passed (${hit!.error ?? ''})`).toBe(t.passed)
      }
    })
  }
})
