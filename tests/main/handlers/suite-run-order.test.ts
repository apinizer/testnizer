/**
 * Tester report (Testnizer Suite, 2026-10): a collection that runs fine from
 * APIs falls apart as a Test Suite.
 *
 *  1. Run order — `sort_order` is a per-folder sibling index, but the suite was
 *     read with one suite-wide `ORDER BY sort_order`, so "request 0 of every
 *     module, then request 1 of every module…" ran. Regressed when issue #94
 *     started mirroring folders (before it every item sat in one folder).
 *  2. Export — no global execution order in the file.
 *  3. Import — "FOREIGN KEY constraint failed": folders were inserted in
 *     sibling order, so a child (sort_order 0) came before its parent.
 *  4. Folder scripts — the #94 mirror copied folder names only; folder
 *     auth / pre_script / post_script were dropped.
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
const { exportTestSuiteData, importTestSuiteData } =
  await import('../../../src/main/ipc/save.handler')

let projectId: string
let suiteId: string

function seedSuite(db: Database.Database, project: string, name = 'Core'): string {
  const now = Date.now()
  const id = crypto.randomUUID()
  db.prepare(
    `INSERT INTO test_suites (id, project_id, name, sort_order, created_at, updated_at)
     VALUES (?, ?, ?, 0, ?, ?)`,
  ).run(id, project, name, now, now)
  return id
}

let folderOrder = 0
function seedFolder(
  db: Database.Database,
  name: string,
  parentId: string | null,
  settings: { auth?: string; pre_script?: string; post_script?: string } = {},
): string {
  const id = crypto.randomUUID()
  db.prepare(
    `INSERT INTO folders (id, project_id, parent_id, name, sort_order, auth, pre_script, post_script)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    projectId,
    parentId,
    name,
    folderOrder++,
    settings.auth ?? null,
    settings.pre_script ?? null,
    settings.post_script ?? null,
  )
  return id
}

function seedEndpoint(
  db: Database.Database,
  name: string,
  folderId: string,
  order: number,
): string {
  const id = crypto.randomUUID()
  const now = Date.now()
  db.prepare(
    `INSERT INTO endpoints
       (id, project_id, folder_id, name, protocol, method, path, status, request_schema,
        sort_order, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'http', 'GET', '/x', 'developing', ?, ?, ?, ?)`,
  ).run(id, projectId, folderId, name, JSON.stringify({ url: '/x' }), order, now, now)
  return id
}

interface ListedItem {
  id: string
  name: string
  folder_id: string | null
}
interface ListedFolder {
  id: string
  name: string
  parent_id: string | null
  auth: string | null
  pre_script: string | null
  post_script: string | null
}

async function listSuite(id = suiteId): Promise<{ items: ListedItem[]; folders: ListedFolder[] }> {
  const res = (await harness.invoke('testSuite:listEndpoints', id)) as {
    success: boolean
    data: { items: ListedItem[]; folders: ListedFolder[] }
  }
  expect(res.success).toBe(true)
  return res.data
}

/** A "Core/full"-shaped collection: modules, each with requests in order. */
function seedCollection(): { root: string; ids: string[] } {
  const root = seedFolder(testDb, 'Core', null)
  const ids: string[] = []
  for (const mod of ['00 Init', '03 Proxy', '06 Consumer']) {
    const f = seedFolder(testDb, mod, root)
    for (let i = 0; i < 3; i++) ids.push(seedEndpoint(testDb, `${mod} #${i}`, f, i))
  }
  return { root, ids }
}

beforeEach(() => {
  harness.reset()
  folderOrder = 0
  testDb = createTestDb()
  const ws = seedWorkspace(testDb)
  projectId = seedProject(testDb, ws)
  suiteId = seedSuite(testDb, projectId)
  registerTestSuiteHandlers()
})

describe('suite run order (tester report §1)', () => {
  it('runs module by module, not "the N-th request of every module" side by side', async () => {
    const { root, ids } = seedCollection()
    await harness.invoke('testSuite:importEndpoints', {
      suite_id: suiteId,
      endpoint_ids: ids,
      source_folder_id: root,
    })

    const { items } = await listSuite()
    expect(items.map((i) => i.name)).toEqual([
      '00 Init #0',
      '00 Init #1',
      '00 Init #2',
      '03 Proxy #0',
      '03 Proxy #1',
      '03 Proxy #2',
      '06 Consumer #0',
      '06 Consumer #1',
      '06 Consumer #2',
    ])
  })

  it('runs a folder’s own requests before its subfolders, at every depth', async () => {
    const root = seedFolder(testDb, 'Core', null)
    const mod = seedFolder(testDb, '03 Proxy', root)
    const setup = seedFolder(testDb, '01 Setup', mod)
    const ids = [
      seedEndpoint(testDb, 'Proxy loose', mod, 0),
      seedEndpoint(testDb, 'Setup create', setup, 0),
      seedEndpoint(testDb, 'Root loose', root, 0),
    ]
    await harness.invoke('testSuite:importEndpoints', {
      suite_id: suiteId,
      endpoint_ids: ids,
      source_folder_id: root,
    })

    const { items } = await listSuite()
    expect(items.map((i) => i.name)).toEqual(['Root loose', 'Proxy loose', 'Setup create'])
  })

  it('orders a hand-picked selection like the APIs tree, not by pick order', async () => {
    const { root, ids } = seedCollection()
    // Add Endpoints sends a Set in click order, with no source folder.
    void root
    const shuffled = [ids[7], ids[0], ids[4], ids[8], ids[2], ids[3], ids[6], ids[1], ids[5]]
    await harness.invoke('testSuite:importEndpoints', {
      suite_id: suiteId,
      endpoint_ids: shuffled,
    })

    const { items, folders } = await listSuite()
    expect(folders.map((f) => f.name)).toEqual(['00 Init', '03 Proxy', '06 Consumer'])
    expect(items.map((i) => i.name)).toEqual([
      '00 Init #0',
      '00 Init #1',
      '00 Init #2',
      '03 Proxy #0',
      '03 Proxy #1',
      '03 Proxy #2',
      '06 Consumer #0',
      '06 Consumer #1',
      '06 Consumer #2',
    ])
  })

  it('testSuiteItem:list returns the same execution order', async () => {
    const { root, ids } = seedCollection()
    await harness.invoke('testSuite:importEndpoints', {
      suite_id: suiteId,
      endpoint_ids: ids,
      source_folder_id: root,
    })
    const listed = (await harness.invoke('testSuiteItem:list', suiteId)) as {
      data: ListedItem[]
    }
    expect(listed.data.map((i) => i.name)).toEqual((await listSuite()).items.map((i) => i.name))
  })
})

describe('folder scripts follow the collection into the suite (tester report §4)', () => {
  it('copies folder auth + pre/post scripts when building a suite from APIs', async () => {
    const root = seedFolder(testDb, 'Core', null)
    const mod = seedFolder(testDb, '03 Proxy', root)
    const setup = seedFolder(testDb, '01 Setup', mod, {
      pre_script: "pm.environment.set('ApiProxyName', 'col-' + pm.environment.get('runId'))",
      post_script: "pm.test('ok', () => {})",
      auth: JSON.stringify({ type: 'bearer', bearer: { token: '{{token}}' } }),
    })
    const ep = seedEndpoint(testDb, 'Create proxy', setup, 0)
    await harness.invoke('testSuite:importEndpoints', {
      suite_id: suiteId,
      endpoint_ids: [ep],
      source_folder_id: root,
    })

    const { folders } = await listSuite()
    const copied = folders.find((f) => f.name === '01 Setup')!
    expect(copied.pre_script).toContain('ApiProxyName')
    expect(copied.post_script).toContain("pm.test('ok'")
    expect(copied.auth).toContain('bearer')
  })

  it('keeps the source folder as a wrapper when IT carries scripts, so they still cascade', async () => {
    const root = seedFolder(testDb, 'Core', null, {
      pre_script: "pm.environment.set('runScope', 'core')",
    })
    const mod = seedFolder(testDb, '00 Init', root)
    const ep = seedEndpoint(testDb, 'Init runId', mod, 0)
    await harness.invoke('testSuite:importEndpoints', {
      suite_id: suiteId,
      endpoint_ids: [ep],
      source_folder_id: root,
    })

    const { folders, items } = await listSuite()
    const core = folders.find((f) => f.name === 'Core')
    expect(core?.pre_script).toContain('runScope')
    const init = folders.find((f) => f.name === '00 Init')!
    expect(init.parent_id).toBe(core!.id)
    expect(items[0].folder_id).toBe(init.id)
  })

  it('fills an existing, settings-less suite folder on re-import', async () => {
    const root = seedFolder(testDb, 'Core', null)
    const setup = seedFolder(testDb, '01 Setup', root)
    const first = seedEndpoint(testDb, 'A', setup, 0)
    await harness.invoke('testSuite:importEndpoints', {
      suite_id: suiteId,
      endpoint_ids: [first],
      source_folder_id: root,
    })
    testDb.prepare('UPDATE folders SET pre_script = ? WHERE id = ?').run('// setup', setup)
    const second = seedEndpoint(testDb, 'B', setup, 1)
    await harness.invoke('testSuite:importEndpoints', {
      suite_id: suiteId,
      endpoint_ids: [second],
      source_folder_id: root,
    })

    const { folders } = await listSuite()
    expect(folders.filter((f) => f.name === '01 Setup')).toHaveLength(1)
    expect(folders[0].pre_script).toBe('// setup')
  })
})

describe('suite export → import (tester report §2, §3)', () => {
  /** Nested suite whose child folder has a LOWER sort_order than its parent. */
  function seedNestedSuite(): void {
    const now = Date.now()
    const ins = testDb.prepare(
      `INSERT INTO test_suite_folders (id, suite_id, parent_id, name, sort_order, pre_script, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    // Parent "03 Proxy" sits at sibling index 3; its child "01 Setup" at 0.
    ins.run('f-mod', suiteId, null, '03 Proxy', 3, null, now)
    ins.run('f-setup', suiteId, 'f-mod', '01 Setup', 0, "pm.environment.set('x', 1)", now)
    ins.run('f-init', suiteId, null, '00 Init', 0, null, now)
    const item = testDb.prepare(
      `INSERT INTO test_suite_items (id, suite_id, folder_id, protocol, name, method, url,
         request_schema, sort_order, created_at, updated_at)
       VALUES (?, ?, ?, 'http', ?, 'GET', '/x', '{}', ?, ?, ?)`,
    )
    item.run('i-1', suiteId, 'f-init', 'Init runId', 0, now, now)
    item.run('i-2', suiteId, 'f-init', 'Create token', 1, now, now)
    item.run('i-3', suiteId, 'f-setup', 'Create proxy', 0, now, now)
    item.run('i-4', suiteId, 'f-mod', 'Deploy proxy', 0, now, now)
  }

  it('imports back into the same project without a FOREIGN KEY failure', async () => {
    seedNestedSuite()
    const exported = JSON.parse(JSON.stringify(exportTestSuiteData(suiteId)))
    const out = importTestSuiteData(exported, projectId)

    const { items, folders } = await listSuite(out.suiteId)
    expect(items.map((i) => i.name)).toEqual([
      'Init runId',
      'Create token',
      'Deploy proxy',
      'Create proxy',
    ])
    const setup = folders.find((f) => f.name === '01 Setup')!
    expect(folders.find((f) => f.id === setup.parent_id)?.name).toBe('03 Proxy')
    expect(setup.pre_script).toContain("pm.environment.set('x'")
  })

  it('writes a documented global execution_order (0…N-1) and folder path on every item', () => {
    seedNestedSuite()
    const exported = exportTestSuiteData(suiteId) as unknown as {
      execution_model: string
      items: Array<{ name: string; execution_order: number; folder_path: string }>
    }
    expect(exported.execution_model).toBeTruthy()
    expect(exported.items.map((i) => [i.execution_order, i.name, i.folder_path])).toEqual([
      [0, 'Init runId', '00 Init'],
      [1, 'Create token', '00 Init'],
      [2, 'Deploy proxy', '03 Proxy'],
      [3, 'Create proxy', '03 Proxy / 01 Setup'],
    ])
  })

  it('honours execution_order on import over the per-folder sort_order', async () => {
    seedNestedSuite()
    const exported = JSON.parse(JSON.stringify(exportTestSuiteData(suiteId))) as {
      items: Array<{ name: string; execution_order: number; sort_order: number }>
    }
    // Swap the two Init requests by execution_order only; leave sort_order stale.
    for (const it of exported.items) {
      if (it.name === 'Init runId') it.execution_order = 1
      else if (it.name === 'Create token') it.execution_order = 0
    }
    const out = importTestSuiteData(exported as never, projectId)
    const { items } = await listSuite(out.suiteId)
    expect(items.slice(0, 2).map((i) => i.name)).toEqual(['Create token', 'Init runId'])
  })

  it('names the table and row when a foreign key still cannot be satisfied', () => {
    seedNestedSuite()
    const exported = JSON.parse(JSON.stringify(exportTestSuiteData(suiteId)))
    // Two folders that are each other's parent: whichever goes first points at
    // a row that does not exist yet.
    const [a, b] = exported.folders as Array<{ id: string; parent_id: string | null }>
    a.parent_id = b.id
    b.parent_id = a.id
    expect(() => importTestSuiteData(exported, projectId)).toThrow(/test_suite_folders/)
  })

  it('duplicating a three-level suite keeps the nesting', async () => {
    seedNestedSuite()
    const now = Date.now()
    testDb
      .prepare(
        `INSERT INTO test_suite_folders (id, suite_id, parent_id, name, sort_order, created_at)
         VALUES ('f-deep', ?, 'f-setup', 'Deep', 0, ?)`,
      )
      // Older than its parent, so a sibling-order copy meets it first.
      .run(suiteId, now - 1000)
    const dup = (await harness.invoke('testSuite:duplicate', suiteId)) as {
      success: boolean
      data: { id: string }
    }
    expect(dup.success).toBe(true)
    const { folders } = await listSuite(dup.data.id)
    const deep = folders.find((f) => f.name === 'Deep')!
    expect(folders.find((f) => f.id === deep.parent_id)?.name).toBe('01 Setup')
  })
})
