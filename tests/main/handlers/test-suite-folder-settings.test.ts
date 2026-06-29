/**
 * D-2 backend: testSuiteFolder:getSettings / :updateSettings round-trip.
 * Lets the suite-tree Folder Settings modal read + persist folder-level auth +
 * cascade scripts (the same data the importer now lands there).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setupHandlerHarness, makeElectronMock, createTestDb, seedProject, seedWorkspace } from './helpers'
import crypto from 'node:crypto'
import type Database from 'better-sqlite3'

const harness = setupHandlerHarness()
vi.mock('electron', () => ({ ...makeElectronMock() }))

let testDb: ReturnType<typeof createTestDb>
vi.mock('../../../src/main/db/database', () => ({ getDb: () => testDb }))

const { registerTestSuiteHandlers } = await import('../../../src/main/ipc/test-suite.handler')

let projectId: string
let suiteId: string
let folderId: string

function seedSuiteAndFolder(db: Database.Database, project: string): { suite: string; folder: string } {
  const now = Date.now()
  const suite = crypto.randomUUID()
  db.prepare(
    `INSERT INTO test_suites (id, project_id, name, sort_order, created_at, updated_at)
     VALUES (?, ?, 'Suite', 0, ?, ?)`,
  ).run(suite, project, now, now)
  const folder = crypto.randomUUID()
  db.prepare(
    `INSERT INTO test_suite_folders (id, suite_id, parent_id, name, sort_order, created_at)
     VALUES (?, ?, NULL, '01 Setup', 0, ?)`,
  ).run(folder, suite, now)
  return { suite, folder }
}

beforeEach(() => {
  harness.reset()
  testDb = createTestDb()
  projectId = seedProject(testDb, seedWorkspace(testDb))
  const seeded = seedSuiteAndFolder(testDb, projectId)
  suiteId = seeded.suite
  folderId = seeded.folder
  registerTestSuiteHandlers()
})

describe('testSuiteFolder settings round-trip', () => {
  it('getSettings returns nulls for a fresh folder', async () => {
    const res = (await harness.invoke('testSuiteFolder:getSettings', folderId)) as {
      success: boolean
      data?: { auth: string | null; pre_script: string | null; post_script: string | null }
    }
    expect(res.success).toBe(true)
    expect(res.data).toEqual({ auth: null, pre_script: null, post_script: null })
  })

  it('updateSettings persists auth + scripts and getSettings reads them back', async () => {
    const auth = JSON.stringify({ type: 'bearer', bearer: { token: '{{tok}}', prefix: 'Bearer' } })
    const upd = (await harness.invoke('testSuiteFolder:updateSettings', folderId, {
      auth,
      pre_script: "pm.environment.set('runId', 'abc')",
      post_script: "pm.test('ok', () => {})",
    })) as { success: boolean }
    expect(upd.success).toBe(true)

    const got = (await harness.invoke('testSuiteFolder:getSettings', folderId)) as {
      success: boolean
      data?: { auth: string | null; pre_script: string | null; post_script: string | null }
    }
    expect(got.data?.auth).toBe(auth)
    expect(got.data?.pre_script).toContain('runId')
    expect(got.data?.post_script).toContain('ok')

    // Persisted on the row itself.
    const row = testDb
      .prepare('SELECT auth, pre_script FROM test_suite_folders WHERE id = ?')
      .get(folderId) as { auth: string; pre_script: string }
    expect(row.pre_script).toContain('runId')
  })

  it('updateSettings on a missing folder reports failure', async () => {
    const res = (await harness.invoke('testSuiteFolder:updateSettings', 'nope', {
      auth: null,
      pre_script: null,
      post_script: null,
    })) as { success: boolean; error?: string }
    expect(res.success).toBe(false)
  })

  // suiteId is referenced so the seed is meaningful even if a future assertion drops.
  it('the seeded folder belongs to the seeded suite', () => {
    const row = testDb
      .prepare('SELECT suite_id FROM test_suite_folders WHERE id = ?')
      .get(folderId) as { suite_id: string }
    expect(row.suite_id).toBe(suiteId)
  })
})
