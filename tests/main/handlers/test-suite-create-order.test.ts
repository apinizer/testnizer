/**
 * Functional test for issue #57: a newly created test suite must land at the
 * BOTTOM of the project's suite list (the sidebar bug was that the name input
 * appeared at the top while the created suite dropped to the bottom; the fix
 * moved the input to the bottom to match this ordering). This locks the
 * underlying "new suite appends at the end" contract that the UI fix aligned to.
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

interface SuiteRow {
  id: string
  name: string
  sort_order: number
  created_at: number
}
type SuiteRes = { success: boolean; data?: SuiteRow; error?: string }
type ListRes = { success: boolean; data?: SuiteRow[]; error?: string }

let projectId: string

function seedSuiteRow(
  db: Database.Database,
  project: string,
  name: string,
  createdAt: number,
  sortOrder = 0,
): string {
  const id = crypto.randomUUID()
  db.prepare(
    `INSERT INTO test_suites (id, project_id, name, description, sort_order, created_at, updated_at)
     VALUES (?, ?, ?, NULL, ?, ?, ?)`,
  ).run(id, project, name, sortOrder, createdAt, createdAt)
  return id
}

const createSuite = (name: string): Promise<SuiteRes> =>
  harness.invoke('testSuite:create', { project_id: projectId, name }) as Promise<SuiteRes>
const listSuites = (): Promise<ListRes> =>
  harness.invoke('testSuite:list', projectId) as Promise<ListRes>

beforeEach(() => {
  harness.reset()
  testDb = createTestDb()
  projectId = seedProject(testDb, seedWorkspace(testDb))
  registerTestSuiteHandlers()
})

describe('testSuite:create ordering (issue #57)', () => {
  it('a newly created suite lands at the bottom of the project list', async () => {
    const now = Date.now()
    seedSuiteRow(testDb, projectId, 'Alpha', now - 2000)
    seedSuiteRow(testDb, projectId, 'Beta', now - 1000)

    const created = await createSuite('Gamma')
    expect(created.success).toBe(true)

    const list = await listSuites()
    expect(list.success).toBe(true)
    expect(list.data!.map((s) => s.name)).toEqual(['Alpha', 'Beta', 'Gamma'])
    // The just-created suite is the LAST row (i.e. it appended at the bottom).
    expect(list.data![list.data!.length - 1].id).toBe(created.data!.id)
  })

  it('appends past a REORDERED list — the append is real, not a created_at tie-break', async () => {
    // The original fix assumed "sort_order 0 + created_at tie-break == append".
    // It only looks like an append while every row sits at 0; one imported,
    // duplicated or manually reordered suite (sort_order > 0) and the new suite
    // jumped above it — the exact mismatch #57 reported between where the name
    // input sits and where the suite lands.
    const now = Date.now()
    seedSuiteRow(testDb, projectId, 'reordered-down', now - 5000, 5)
    seedSuiteRow(testDb, projectId, 'pinned-top', now - 4000, 0)

    const created = await createSuite('Gamma')
    expect(created.data!.sort_order).toBe(6)

    const list = await listSuites()
    expect(list.data!.map((s) => s.name)).toEqual(['pinned-top', 'reordered-down', 'Gamma'])
  })

  it('assigns increasing sort_order and disambiguates duplicate names', async () => {
    const a = await createSuite('Dup')
    const b = await createSuite('Dup')
    expect(a.data!.sort_order).toBe(0)
    expect(b.data!.sort_order).toBe(1)
    expect(a.data!.name).toBe('Dup')
    expect(b.data!.name).toMatch(/^Dup \(1\)$/)
  })

  it('lists suites ordered by sort_order first, then created_at', async () => {
    const now = Date.now()
    // A later-created row with a LOWER sort_order must still come first.
    seedSuiteRow(testDb, projectId, 'pinned-top', now, 0)
    seedSuiteRow(testDb, projectId, 'reordered-down', now - 5000, 5)
    const list = await listSuites()
    expect(list.data!.map((s) => s.name)).toEqual(['pinned-top', 'reordered-down'])
  })
})
