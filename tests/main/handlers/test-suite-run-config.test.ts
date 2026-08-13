/**
 * Issue #100 — persisted Runner run configuration per test suite.
 *
 * The Runner's Run Sequence (include/exclude + setup/flow/teardown roles) and
 * run options (iterations, delays, stop-on-error, lifecycle scripts) used to
 * live only in RunnerTab React state + tab-scoped sessionStorage, so closing
 * the suite tab lost the whole configuration. These tests drive the new
 * `testSuite:getRunConfig` / `testSuite:saveRunConfig` IPC pair over the real
 * handler + a real SQLite test DB:
 *
 *  - save → get round-trip returns the exact JSON string
 *  - a fresh suite has no config (null)
 *  - saving null clears a stored config
 *  - unknown suite ids fail cleanly on both channels
 *  - deleting the suite removes the config with the row
 *  - duplicating a suite deliberately does NOT copy run_config (item ids are
 *    reminted on duplicate, so a verbatim copy would reference dead ids)
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
vi.mock('electron', () => ({ ...makeElectronMock() }))

let testDb: ReturnType<typeof createTestDb>
vi.mock('../../../src/main/db/database', () => ({ getDb: () => testDb }))

const { registerTestSuiteHandlers } = await import('../../../src/main/ipc/test-suite.handler')

let projectId: string
let suiteId: string

type ConfigRes = { success: boolean; data?: string | null; error?: string }
type SaveRes = { success: boolean; data?: boolean; error?: string }
type SuiteRes = { success: boolean; data?: { id: string }; error?: string }

function seedSuite(db: Database.Database, project: string): string {
  const now = Date.now()
  const suite = crypto.randomUUID()
  db.prepare(
    `INSERT INTO test_suites (id, project_id, name, sort_order, created_at, updated_at)
     VALUES (?, ?, 'Suite', 0, ?, ?)`,
  ).run(suite, project, now, now)
  return suite
}

const getConfig = (id: string): Promise<ConfigRes> =>
  harness.invoke('testSuite:getRunConfig', id) as Promise<ConfigRes>

const saveConfig = (id: string, config: string | null): Promise<SaveRes> =>
  harness.invoke('testSuite:saveRunConfig', id, config) as Promise<SaveRes>

const SAMPLE_CONFIG = JSON.stringify({
  version: 1,
  items: [
    { id: 'item-1', selected: true, phase: 'setup' },
    { id: 'item-2', selected: false },
    { id: 'item-3', selected: true, phase: 'teardown' },
  ],
  delay: 250,
  iterationDelay: 1000,
  iterations: 3,
  stopOnError: false,
  persistResponses: true,
  keepVariableValues: false,
  environmentId: 'env-9',
  runPreScript: 'console.log("pre")',
  runPostScript: 'console.log("post")',
})

beforeEach(() => {
  harness.reset()
  testDb = createTestDb()
  projectId = seedProject(testDb, seedWorkspace(testDb))
  suiteId = seedSuite(testDb, projectId)
  registerTestSuiteHandlers()
})

describe('testSuite:getRunConfig / saveRunConfig — round-trip', () => {
  it('a fresh suite has no run config (null)', async () => {
    const res = await getConfig(suiteId)
    expect(res.success).toBe(true)
    expect(res.data).toBeNull()
  })

  it('save → get returns the exact JSON string', async () => {
    const saved = await saveConfig(suiteId, SAMPLE_CONFIG)
    expect(saved.success).toBe(true)

    const res = await getConfig(suiteId)
    expect(res.success).toBe(true)
    expect(res.data).toBe(SAMPLE_CONFIG)
  })

  it('re-saving overwrites the previous config', async () => {
    await saveConfig(suiteId, SAMPLE_CONFIG)
    const second = JSON.stringify({ version: 1, items: [], iterations: 7 })
    await saveConfig(suiteId, second)

    const res = await getConfig(suiteId)
    expect(res.data).toBe(second)
  })

  it('saving null clears a stored config', async () => {
    await saveConfig(suiteId, SAMPLE_CONFIG)
    const cleared = await saveConfig(suiteId, null)
    expect(cleared.success).toBe(true)

    const res = await getConfig(suiteId)
    expect(res.success).toBe(true)
    expect(res.data).toBeNull()
  })

  it('save bumps the suite updated_at', async () => {
    testDb.prepare('UPDATE test_suites SET updated_at = 1 WHERE id = ?').run(suiteId)
    await saveConfig(suiteId, SAMPLE_CONFIG)
    const row = testDb
      .prepare('SELECT updated_at FROM test_suites WHERE id = ?')
      .get(suiteId) as { updated_at: number }
    expect(row.updated_at).toBeGreaterThan(1)
  })
})

describe('testSuite run config — error paths', () => {
  it('getRunConfig on an unknown suite fails', async () => {
    const res = await getConfig(crypto.randomUUID())
    expect(res.success).toBe(false)
    expect(res.error).toMatch(/not found/i)
  })

  it('saveRunConfig on an unknown suite fails', async () => {
    const res = await saveConfig(crypto.randomUUID(), SAMPLE_CONFIG)
    expect(res.success).toBe(false)
    expect(res.error).toMatch(/not found/i)
  })

  it('saveRunConfig rejects a non-string, non-null payload', async () => {
    const res = (await harness.invoke('testSuite:saveRunConfig', suiteId, {
      version: 1,
    })) as SaveRes
    expect(res.success).toBe(false)
  })
})

describe('testSuite run config — lifecycle with the suite row', () => {
  it('deleting the suite removes the config with the row', async () => {
    await saveConfig(suiteId, SAMPLE_CONFIG)
    const del = (await harness.invoke('testSuite:delete', suiteId)) as SaveRes
    expect(del.success).toBe(true)

    // The row is gone, so the config is unreachable — same "not found" as any
    // other missing suite. Nothing lingers in the table either.
    const res = await getConfig(suiteId)
    expect(res.success).toBe(false)
    const count = testDb
      .prepare('SELECT COUNT(*) as c FROM test_suites WHERE id = ?')
      .get(suiteId) as { c: number }
    expect(count.c).toBe(0)
  })

  it('duplicating a suite does NOT copy run_config (item ids are reminted)', async () => {
    await saveConfig(suiteId, SAMPLE_CONFIG)
    const dup = (await harness.invoke('testSuite:duplicate', suiteId)) as SuiteRes
    expect(dup.success).toBe(true)

    const copyConfig = await getConfig(dup.data!.id)
    expect(copyConfig.success).toBe(true)
    expect(copyConfig.data).toBeNull()
    // …and the original keeps its own config untouched.
    const orig = await getConfig(suiteId)
    expect(orig.data).toBe(SAMPLE_CONFIG)
  })
})
