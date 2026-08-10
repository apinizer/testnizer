/**
 * Functional tests for the Tests-module FOLDER MANAGEMENT feature added this
 * session (issue #56): testSuiteFolder:create / :rename / :delete / :move over
 * the real IPC handlers + repo. Covers the capability users asked for — nested
 * folders (folder-in-folder), rename, reparent + reorder via drag-drop (`move`),
 * and the cycle-guard that rejects dropping a folder into itself/a descendant.
 *
 * NOTE on cascade: production `database.ts` puts ON DELETE CASCADE on
 * `test_suite_folders.parent_id` / `test_suite_items.folder_id`, but the test
 * SCHEMA_SQL mirror (helpers.ts) intentionally omits the FK, so DB-level cascade
 * of children on delete is NOT asserted here (it is a production-schema concern);
 * we assert the delete removes the targeted folder row.
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

interface FolderRow {
  id: string
  suite_id: string
  parent_id: string | null
  name: string
  sort_order: number
}
type FolderRes = { success: boolean; data?: FolderRow; error?: string }
type DeleteRes = { success: boolean; data?: { deleted: boolean }; error?: string }

function seedSuite(db: Database.Database, project: string): string {
  const now = Date.now()
  const suite = crypto.randomUUID()
  db.prepare(
    `INSERT INTO test_suites (id, project_id, name, sort_order, created_at, updated_at)
     VALUES (?, ?, 'Suite', 0, ?, ?)`,
  ).run(suite, project, now, now)
  return suite
}

const create = (name: string, parentId: string | null = null): Promise<FolderRes> =>
  harness.invoke('testSuiteFolder:create', {
    suite_id: suiteId,
    parent_id: parentId,
    name,
  }) as Promise<FolderRes>

const rootOrder = (): string[] =>
  (
    testDb
      .prepare(
        'SELECT id FROM test_suite_folders WHERE suite_id = ? AND parent_id IS NULL ORDER BY sort_order ASC, created_at ASC',
      )
      .all(suiteId) as Array<{ id: string }>
  ).map((r) => r.id)

const parentOf = (id: string): string | null =>
  (
    testDb.prepare('SELECT parent_id FROM test_suite_folders WHERE id = ?').get(id) as {
      parent_id: string | null
    }
  ).parent_id

beforeEach(() => {
  harness.reset()
  testDb = createTestDb()
  projectId = seedProject(testDb, seedWorkspace(testDb))
  suiteId = seedSuite(testDb, projectId)
  registerTestSuiteHandlers()
})

describe('testSuiteFolder — create + nesting', () => {
  it('creates a root folder with parent_id null and sort_order 0', async () => {
    const res = await create('Setup')
    expect(res.success).toBe(true)
    expect(res.data?.parent_id).toBeNull()
    expect(res.data?.name).toBe('Setup')
    expect(res.data?.sort_order).toBe(0)
    expect(res.data?.suite_id).toBe(suiteId)
  })

  it('creates a folder INSIDE a folder (folder-in-folder), and a third level deep', async () => {
    const root = (await create('L1')).data!
    const child = await create('L2', root.id)
    expect(child.success).toBe(true)
    expect(child.data?.parent_id).toBe(root.id)

    const grandchild = await create('L3', child.data!.id)
    expect(grandchild.success).toBe(true)
    expect(grandchild.data?.parent_id).toBe(child.data!.id)

    // The whole chain persists with the right lineage.
    expect(parentOf(grandchild.data!.id)).toBe(child.data!.id)
    expect(parentOf(child.data!.id)).toBe(root.id)
    expect(parentOf(root.id)).toBeNull()
  })

  it('increments sort_order per sibling within the same parent', async () => {
    const a = (await create('A')).data!
    const b = (await create('B')).data!
    const c = (await create('C')).data!
    expect([a.sort_order, b.sort_order, c.sort_order]).toEqual([0, 1, 2])
    // sort_order restarts within a nested parent (independent sibling group)
    const nested1 = (await create('n1', a.id)).data!
    const nested2 = (await create('n2', a.id)).data!
    expect([nested1.sort_order, nested2.sort_order]).toEqual([0, 1])
  })
})

describe('testSuiteFolder — rename', () => {
  it('renames a folder and persists it', async () => {
    const f = (await create('Old')).data!
    const res = (await harness.invoke('testSuiteFolder:rename', f.id, 'New')) as FolderRes
    expect(res.success).toBe(true)
    expect(res.data?.name).toBe('New')
    const row = testDb.prepare('SELECT name FROM test_suite_folders WHERE id = ?').get(f.id) as {
      name: string
    }
    expect(row.name).toBe('New')
  })

  it('reports failure when renaming a folder that does not exist', async () => {
    const res = (await harness.invoke('testSuiteFolder:rename', 'nope', 'X')) as FolderRes
    expect(res.success).toBe(false)
    expect(res.error).toMatch(/not found/i)
  })
})

describe('testSuiteFolder — move (drag-drop reparent + reorder)', () => {
  it('reparents a root folder under another folder', async () => {
    const target = (await create('Target')).data!
    const moving = (await create('Moving')).data!
    const res = (await harness.invoke('testSuiteFolder:move', {
      id: moving.id,
      targetSuiteId: suiteId,
      targetParentId: target.id,
      insertBeforeId: null,
    })) as FolderRes
    expect(res.success).toBe(true)
    expect(res.data?.parent_id).toBe(target.id)
    expect(parentOf(moving.id)).toBe(target.id)
  })

  it('reorders siblings via insertBeforeId', async () => {
    const f1 = (await create('f1')).data!
    const f2 = (await create('f2')).data!
    const f3 = (await create('f3')).data!
    expect(rootOrder()).toEqual([f1.id, f2.id, f3.id])
    // Drop f3 before f1 → [f3, f1, f2]
    const res = (await harness.invoke('testSuiteFolder:move', {
      id: f3.id,
      targetSuiteId: suiteId,
      targetParentId: null,
      insertBeforeId: f1.id,
    })) as FolderRes
    expect(res.success).toBe(true)
    expect(rootOrder()).toEqual([f3.id, f1.id, f2.id])
  })

  it('moving to the end when insertBeforeId is null appends after siblings', async () => {
    const child = (await create('child', (await create('box')).data!.id)).data!
    const loose = (await create('loose')).data!
    // Move `loose` into `box` at the end (after `child`)
    const box = parentOf(child.id)!
    const res = (await harness.invoke('testSuiteFolder:move', {
      id: loose.id,
      targetSuiteId: suiteId,
      targetParentId: box,
      insertBeforeId: null,
    })) as FolderRes
    expect(res.success).toBe(true)
    const order = (
      testDb
        .prepare('SELECT id FROM test_suite_folders WHERE parent_id = ? ORDER BY sort_order ASC')
        .all(box) as Array<{ id: string }>
    ).map((r) => r.id)
    expect(order).toEqual([child.id, loose.id])
  })
})

describe('testSuiteFolder — move cycle-guard', () => {
  it('rejects moving a folder into itself', async () => {
    const f = (await create('self')).data!
    const res = (await harness.invoke('testSuiteFolder:move', {
      id: f.id,
      targetSuiteId: suiteId,
      targetParentId: f.id,
      insertBeforeId: null,
    })) as FolderRes
    expect(res.success).toBe(false)
    expect(res.error).toMatch(/itself or its descendants/i)
    expect(parentOf(f.id)).toBeNull() // unchanged
  })

  it('rejects moving a folder into one of its descendants', async () => {
    const parent = (await create('parent')).data!
    const child = (await create('child', parent.id)).data!
    const grandchild = (await create('grandchild', child.id)).data!
    const res = (await harness.invoke('testSuiteFolder:move', {
      id: parent.id,
      targetSuiteId: suiteId,
      targetParentId: grandchild.id,
      insertBeforeId: null,
    })) as FolderRes
    expect(res.success).toBe(false)
    expect(res.error).toMatch(/itself or its descendants/i)
    // Tree is untouched.
    expect(parentOf(parent.id)).toBeNull()
    expect(parentOf(child.id)).toBe(parent.id)
    expect(parentOf(grandchild.id)).toBe(child.id)
  })

  it('allows moving a descendant OUT to the root (not a cycle)', async () => {
    const parent = (await create('p')).data!
    const child = (await create('c', parent.id)).data!
    const res = (await harness.invoke('testSuiteFolder:move', {
      id: child.id,
      targetSuiteId: suiteId,
      targetParentId: null,
      insertBeforeId: null,
    })) as FolderRes
    expect(res.success).toBe(true)
    expect(parentOf(child.id)).toBeNull()
  })
})

describe('testSuiteFolder — delete', () => {
  it('deletes a folder and removes its row', async () => {
    const f = (await create('gone')).data!
    const res = (await harness.invoke('testSuiteFolder:delete', f.id)) as DeleteRes
    expect(res.success).toBe(true)
    expect(res.data?.deleted).toBe(true)
    const row = testDb.prepare('SELECT id FROM test_suite_folders WHERE id = ?').get(f.id)
    expect(row).toBeUndefined()
  })

  it('reports deleted:false for a folder that does not exist', async () => {
    const res = (await harness.invoke('testSuiteFolder:delete', 'missing')) as DeleteRes
    expect(res.success).toBe(true)
    expect(res.data?.deleted).toBe(false)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Cross-suite integrity. Both defects below are invisible from today's UI (the
// Tests panel has no folder drag-drop yet) and would have shipped the moment
// #56 added one.
// ─────────────────────────────────────────────────────────────────────────────

describe('testSuiteFolder — cross-suite move carries the whole subtree', () => {
  it('re-stamps suite_id on the folder, its descendants and their items', async () => {
    const otherSuite = seedSuite(testDb, projectId)
    const parent = await create('Parent')
    const child = await create('Child', parent.data!.id)

    // An item living in the child folder must travel with it.
    const itemId = crypto.randomUUID()
    const now = Date.now()
    testDb
      .prepare(
        `INSERT INTO test_suite_items
           (id, suite_id, folder_id, name, protocol, method, url, request_schema,
            sort_order, created_at, updated_at)
         VALUES (?, ?, ?, 'Req', 'http', 'GET', 'http://x.test', '{}', 0, ?, ?)`,
      )
      .run(itemId, suiteId, child.data!.id, now, now)

    const moved = (await harness.invoke('testSuiteFolder:move', {
      id: parent.data!.id,
      targetSuiteId: otherSuite,
      targetParentId: null,
      insertBeforeId: null,
    })) as FolderRes
    expect(moved.success).toBe(true)

    const suiteOf = (id: string): string =>
      (
        testDb.prepare('SELECT suite_id FROM test_suite_folders WHERE id = ?').get(id) as {
          suite_id: string
        }
      ).suite_id

    // Without this, the branch belonged to neither suite: listFoldersBySuite
    // filters on suite_id, so it vanished from the source tree (its parent moved
    // away) and never appeared in the target one.
    expect(suiteOf(parent.data!.id)).toBe(otherSuite)
    expect(suiteOf(child.data!.id)).toBe(otherSuite)
    expect(
      (
        testDb.prepare('SELECT suite_id FROM test_suite_items WHERE id = ?').get(itemId) as {
          suite_id: string
        }
      ).suite_id,
    ).toBe(otherSuite)
  })

  it('leaves suite_id alone for an ordinary same-suite reparent', async () => {
    const a = await create('A')
    const b = await create('B')
    await harness.invoke('testSuiteFolder:move', {
      id: b.data!.id,
      targetSuiteId: suiteId,
      targetParentId: a.data!.id,
      insertBeforeId: null,
    })
    const row = testDb
      .prepare('SELECT suite_id, parent_id FROM test_suite_folders WHERE id = ?')
      .get(b.data!.id) as { suite_id: string; parent_id: string | null }
    expect(row.suite_id).toBe(suiteId)
    expect(row.parent_id).toBe(a.data!.id)
  })
})

describe('testSuiteItem:move — guards the DRAGGED item, not just the target', () => {
  it('refuses to move an item out of its own suite', async () => {
    const otherSuite = seedSuite(testDb, projectId)
    const targetFolder = (await harness.invoke('testSuiteFolder:create', {
      suite_id: otherSuite,
      parent_id: null,
      name: 'Elsewhere',
    })) as FolderRes

    const itemId = crypto.randomUUID()
    const now = Date.now()
    testDb
      .prepare(
        `INSERT INTO test_suite_items
           (id, suite_id, folder_id, name, protocol, method, url, request_schema,
            sort_order, created_at, updated_at)
         VALUES (?, ?, NULL, 'Req', 'http', 'GET', 'http://x.test', '{}', 0, ?, ?)`,
      )
      .run(itemId, suiteId, now, now)

    const res = (await harness.invoke('testSuiteItem:move', {
      id: itemId,
      targetSuiteId: otherSuite,
      targetFolderId: targetFolder.data!.id,
      insertBeforeId: null,
    })) as { success: boolean; error?: string }

    // The old guard only checked the TARGET folder, so this passed and left the
    // item parented into another suite while still listed under its own.
    expect(res.success).toBe(false)
    expect(res.error).toMatch(/across suites/i)
    const after = testDb
      .prepare('SELECT suite_id, folder_id FROM test_suite_items WHERE id = ?')
      .get(itemId) as { suite_id: string; folder_id: string | null }
    expect(after.suite_id).toBe(suiteId)
    expect(after.folder_id).toBeNull()
  })
})
