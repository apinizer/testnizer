/**
 * issue #94 — converting a collection to a suite must not flatten it.
 *
 * The same collection ran as a tree from APIs and as one long list from Tests.
 * The reason was one line: `testSuite:importEndpoints` wrote every row to a
 * single `folder_id` and never looked at where the request came from. The
 * runner's suite path already reads `parent_id` and already renders a tree
 * (issue #90) — that half was done, and was being handed nothing to draw.
 *
 * These tests work on the source of the data (what lands in
 * `test_suite_folders` / `test_suite_items`), because that is what both the
 * Tests sidebar and Run Sequence read.
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

interface SuiteFolder {
  id: string
  parent_id: string | null
  name: string
}
interface SuiteItem {
  id: string
  name: string
  folder_id: string | null
}

function seedSuite(db: Database.Database, project: string): string {
  const now = Date.now()
  const id = crypto.randomUUID()
  db.prepare(
    `INSERT INTO test_suites (id, project_id, name, sort_order, created_at, updated_at)
     VALUES (?, ?, 'ApiOps', 0, ?, ?)`,
  ).run(id, project, now, now)
  return id
}

function seedFolder(db: Database.Database, name: string, parentId: string | null): string {
  const id = crypto.randomUUID()
  db.prepare(
    `INSERT INTO folders (id, project_id, parent_id, name, sort_order)
     VALUES (?, ?, ?, ?, 0)`,
  ).run(id, projectId, parentId, name)
  return id
}

function seedEndpoint(db: Database.Database, name: string, folderId: string | null): string {
  const id = crypto.randomUUID()
  const now = Date.now()
  db.prepare(
    `INSERT INTO endpoints
       (id, project_id, folder_id, name, protocol, method, path, status, request_schema,
        sort_order, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'http', 'GET', '/x', 'developing', ?, 0, ?, ?)`,
  ).run(id, projectId, folderId, name, JSON.stringify({ url: '/x' }), now, now)
  return id
}

const importInto = (
  endpointIds: string[],
  opts: { source_folder_id?: string | null; folder_id?: string | null } = {},
): Promise<{ success: boolean; data?: { added: number } }> =>
  harness.invoke('testSuite:importEndpoints', {
    suite_id: suiteId,
    endpoint_ids: endpointIds,
    ...opts,
  }) as Promise<{ success: boolean; data?: { added: number } }>

function readSuite(): { folders: SuiteFolder[]; items: SuiteItem[] } {
  return {
    folders: testDb
      .prepare('SELECT id, parent_id, name FROM test_suite_folders WHERE suite_id = ?')
      .all(suiteId) as SuiteFolder[],
    items: testDb
      .prepare('SELECT id, name, folder_id FROM test_suite_items WHERE suite_id = ?')
      .all(suiteId) as SuiteItem[],
  }
}

/** Where an item ended up, as a "A / B / Name" path — how the tree reads. */
function pathOf(itemName: string): string {
  const { folders, items } = readSuite()
  const byId = new Map(folders.map((f) => [f.id, f]))
  const item = items.find((i) => i.name === itemName)
  if (!item) return `<missing: ${itemName}>`
  const parts: string[] = [item.name]
  let cur = item.folder_id
  while (cur) {
    const f = byId.get(cur)
    if (!f) break
    parts.unshift(f.name)
    cur = f.parent_id
  }
  return parts.join(' / ')
}

beforeEach(() => {
  harness.reset()
  testDb = createTestDb()
  const ws = seedWorkspace(testDb)
  projectId = seedProject(testDb, ws)
  suiteId = seedSuite(testDb, projectId)
  registerTestSuiteHandlers()
})

describe('converting a collection folder into a suite (#94)', () => {
  it('keeps the subfolders instead of flattening them into one list', async () => {
    const root = seedFolder(testDb, 'ApiOps', null)
    const setup = seedFolder(testDb, '00 Collection Setup', root)
    const projects = seedFolder(testDb, '01 Projects', root)
    const login = seedEndpoint(testDb, 'Login', setup)
    const list = seedEndpoint(testDb, 'List projects', projects)

    // What TreeView's "create test suite from folder" sends.
    await importInto([login, list], { source_folder_id: root })

    expect(pathOf('Login')).toBe('00 Collection Setup / Login')
    expect(pathOf('List projects')).toBe('01 Projects / List projects')
  })

  it('does not nest the collection under a copy of the folder it came from', async () => {
    // The suite is already called ApiOps; mirroring ApiOps into it would put
    // every request one pointless level down.
    const root = seedFolder(testDb, 'ApiOps', null)
    const setup = seedFolder(testDb, '00 Collection Setup', root)
    await importInto([seedEndpoint(testDb, 'Login', setup)], { source_folder_id: root })

    expect(readSuite().folders.map((f) => f.name)).not.toContain('ApiOps')
  })

  it('mirrors folders nested more than one level deep', async () => {
    const root = seedFolder(testDb, 'ApiOps', null)
    const projects = seedFolder(testDb, '01 Projects', root)
    const detail = seedFolder(testDb, 'Detail', projects)
    await importInto([seedEndpoint(testDb, 'Get one', detail)], { source_folder_id: root })

    expect(pathOf('Get one')).toBe('01 Projects / Detail / Get one')
  })

  it('leaves a request that sits directly in the source folder at the suite root', async () => {
    const root = seedFolder(testDb, 'ApiOps', null)
    await importInto([seedEndpoint(testDb, 'Ping', root)], { source_folder_id: root })

    expect(pathOf('Ping')).toBe('Ping')
    expect(readSuite().folders).toHaveLength(0)
  })

  it('imports a second time into the SAME folders rather than duplicating them', async () => {
    const root = seedFolder(testDb, 'ApiOps', null)
    const setup = seedFolder(testDb, '00 Collection Setup', root)
    await importInto([seedEndpoint(testDb, 'Login', setup)], { source_folder_id: root })
    await importInto([seedEndpoint(testDb, 'Refresh', setup)], { source_folder_id: root })

    expect(readSuite().folders.filter((f) => f.name === '00 Collection Setup')).toHaveLength(1)
    expect(pathOf('Login')).toBe('00 Collection Setup / Login')
    expect(pathOf('Refresh')).toBe('00 Collection Setup / Refresh')
  })
})

describe('importing a hand-picked selection (#94)', () => {
  it('drops the ancestors every pick shares and keeps what differs', async () => {
    // No source folder named — the shared root is inferred, so the user does
    // not get "Default module / ApiOps / …" prefixed onto everything.
    const root = seedFolder(testDb, 'ApiOps', null)
    const setup = seedFolder(testDb, 'Setup', root)
    const flow = seedFolder(testDb, 'Flow', root)
    const a = seedEndpoint(testDb, 'A', setup)
    const b = seedEndpoint(testDb, 'B', flow)

    await importInto([a, b])

    expect(pathOf('A')).toBe('Setup / A')
    expect(pathOf('B')).toBe('Flow / B')
  })

  it('places requests under the target folder when one is given', async () => {
    const root = seedFolder(testDb, 'ApiOps', null)
    const setup = seedFolder(testDb, 'Setup', root)
    const flow = seedFolder(testDb, 'Flow', root)
    const target = (
      (await harness.invoke('testSuiteFolder:create', {
        suite_id: suiteId,
        parent_id: null,
        name: 'Imported',
      })) as { data: SuiteFolder }
    ).data

    await importInto([seedEndpoint(testDb, 'A', setup), seedEndpoint(testDb, 'B', flow)], {
      folder_id: target.id,
    })

    expect(pathOf('A')).toBe('Imported / Setup / A')
  })

  it('still imports requests that belong to no folder at all', async () => {
    // The pre-#94 path for everything; it must keep working unchanged.
    const loose = seedEndpoint(testDb, 'Loose', null)
    const res = await importInto([loose])

    expect(res.success).toBe(true)
    expect(res.data?.added).toBe(1)
    expect(pathOf('Loose')).toBe('Loose')
    expect(readSuite().folders).toHaveLength(0)
  })

  it('survives a cycle in the source folder chain instead of hanging', async () => {
    // A corrupted parent_id must not spin the walk forever — the import is a
    // synchronous IPC call, so a loop here freezes the app.
    const a = seedFolder(testDb, 'A', null)
    const b = seedFolder(testDb, 'B', a)
    testDb.prepare('UPDATE folders SET parent_id = ? WHERE id = ?').run(b, a)

    const res = await importInto([seedEndpoint(testDb, 'Looped', b)])
    expect(res.success).toBe(true)
  })
})
