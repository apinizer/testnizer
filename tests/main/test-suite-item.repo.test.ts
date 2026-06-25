/**
 * Unit tests for the test_suite_items + test_suite_folders repos. Drives a
 * real in-memory better-sqlite3 instance with just the schema slice these
 * repos touch, then exercises CRUD + move (drag-drop) semantics directly.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import Database from 'better-sqlite3'

let memDb: Database.Database

vi.mock('../../src/main/db/database', () => ({
  getDb: () => memDb,
  initDatabase: () => {},
}))

// Imports must come after the mock so the modules pick up the mocked getDb.
import {
  createItem,
  updateItem,
  deleteItem,
  getItemById,
  listItemsBySuite,
  moveItem,
  bulkInsertItems,
} from '../../src/main/db/test-suite-item.repo'
import {
  createFolder,
  renameFolder,
  deleteFolder,
  listFoldersBySuite,
  isDescendantOf,
  moveFolder,
} from '../../src/main/db/test-suite-folder.repo'

function freshDb(): Database.Database {
  const d = new Database(':memory:')
  d.pragma('foreign_keys = ON')
  d.exec(`
    CREATE TABLE test_suites (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE test_suite_folders (
      id TEXT PRIMARY KEY,
      suite_id TEXT NOT NULL,
      parent_id TEXT,
      name TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      auth TEXT,
      pre_script TEXT,
      post_script TEXT,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (suite_id) REFERENCES test_suites(id) ON DELETE CASCADE,
      FOREIGN KEY (parent_id) REFERENCES test_suite_folders(id) ON DELETE CASCADE
    );
    CREATE TABLE test_suite_items (
      id TEXT PRIMARY KEY,
      suite_id TEXT NOT NULL,
      folder_id TEXT,
      protocol TEXT NOT NULL,
      name TEXT NOT NULL,
      method TEXT,
      url TEXT,
      request_schema TEXT NOT NULL,
      assertions TEXT,
      source_endpoint_id TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (suite_id) REFERENCES test_suites(id) ON DELETE CASCADE,
      FOREIGN KEY (folder_id) REFERENCES test_suite_folders(id) ON DELETE CASCADE
    );
  `)
  // Seed a suite that every test reuses.
  const now = Date.now()
  d.prepare(
    `INSERT INTO test_suites (id, project_id, name, sort_order, created_at, updated_at)
     VALUES ('suite-1', 'project-1', 'Test Suite', 0, ?, ?)`,
  ).run(now, now)
  return d
}

beforeEach(() => {
  memDb = freshDb()
})

describe('createItem', () => {
  it('persists a row with the supplied fields', () => {
    const row = createItem({
      suite_id: 'suite-1',
      protocol: 'http',
      name: 'Get pets',
      method: 'GET',
      url: 'https://api.example.com/pets',
      request_schema: '{"headers":[]}',
      assertions: '[]',
    })
    expect(row.id).toBeTruthy()
    expect(row.name).toBe('Get pets')
    expect(row.method).toBe('GET')
    expect(row.request_schema).toBe('{"headers":[]}')
    expect(row.sort_order).toBe(0)
  })

  it('auto-increments sort_order within the same suite root', () => {
    const a = createItem({
      suite_id: 'suite-1',
      protocol: 'http',
      name: 'A',
      request_schema: '{}',
    })
    const b = createItem({
      suite_id: 'suite-1',
      protocol: 'http',
      name: 'B',
      request_schema: '{}',
    })
    expect(a.sort_order).toBe(0)
    expect(b.sort_order).toBe(1)
  })

  it('keeps independent sort_order sequences per folder', () => {
    const folder = createFolder({ suite_id: 'suite-1', name: 'pet' })
    const root = createItem({
      suite_id: 'suite-1',
      protocol: 'http',
      name: 'root',
      request_schema: '{}',
    })
    const inFolder = createItem({
      suite_id: 'suite-1',
      folder_id: folder.id,
      protocol: 'http',
      name: 'in-folder',
      request_schema: '{}',
    })
    expect(root.sort_order).toBe(0)
    expect(inFolder.sort_order).toBe(0)
  })
})

describe('updateItem', () => {
  it('updates only the supplied fields', () => {
    const row = createItem({
      suite_id: 'suite-1',
      protocol: 'http',
      name: 'X',
      method: 'GET',
      request_schema: '{}',
    })
    const updated = updateItem(row.id, { name: 'Y', method: 'POST' })
    expect(updated?.name).toBe('Y')
    expect(updated?.method).toBe('POST')
    expect(updated?.protocol).toBe('http')
  })

  it('returns undefined when the row is missing', () => {
    expect(updateItem('nope', { name: 'X' })).toBeUndefined()
  })

  it('persists request_schema and assertions changes', () => {
    const row = createItem({
      suite_id: 'suite-1',
      protocol: 'http',
      name: 'X',
      request_schema: '{}',
    })
    updateItem(row.id, {
      request_schema: JSON.stringify({ url: '/v2', method: 'PATCH' }),
      assertions: '[{"type":"status_equals","expected":200}]',
    })
    const reloaded = getItemById(row.id)
    expect(reloaded?.request_schema).toContain('/v2')
    expect(reloaded?.assertions).toContain('status_equals')
  })
})

describe('deleteItem', () => {
  it('removes the row and returns true', () => {
    const row = createItem({
      suite_id: 'suite-1',
      protocol: 'http',
      name: 'X',
      request_schema: '{}',
    })
    expect(deleteItem(row.id)).toBe(true)
    expect(getItemById(row.id)).toBeUndefined()
  })

  it('returns false for an unknown id', () => {
    expect(deleteItem('missing')).toBe(false)
  })
})

describe('moveItem', () => {
  it('renumbers siblings without gaps after a reorder', () => {
    const a = createItem({
      suite_id: 'suite-1',
      protocol: 'http',
      name: 'A',
      request_schema: '{}',
    })
    createItem({
      suite_id: 'suite-1',
      protocol: 'http',
      name: 'B',
      request_schema: '{}',
    })
    const c = createItem({
      suite_id: 'suite-1',
      protocol: 'http',
      name: 'C',
      request_schema: '{}',
    })
    // Move C to position 0 (insert before A).
    moveItem({
      id: c.id,
      targetSuiteId: 'suite-1',
      targetFolderId: null,
      insertBeforeId: a.id,
    })
    const ordered = listItemsBySuite('suite-1')
    expect(ordered.map((r) => r.name)).toEqual(['C', 'A', 'B'])
    expect(ordered.map((r) => r.sort_order)).toEqual([0, 1, 2])
  })

  it('moves an item into a folder', () => {
    const folder = createFolder({ suite_id: 'suite-1', name: 'pet' })
    const item = createItem({
      suite_id: 'suite-1',
      protocol: 'http',
      name: 'A',
      request_schema: '{}',
    })
    const moved = moveItem({
      id: item.id,
      targetSuiteId: 'suite-1',
      targetFolderId: folder.id,
      insertBeforeId: null,
    })
    expect(moved?.folder_id).toBe(folder.id)
  })

  it('appends at the end when insertBeforeId is null', () => {
    const a = createItem({
      suite_id: 'suite-1',
      protocol: 'http',
      name: 'A',
      request_schema: '{}',
    })
    createItem({
      suite_id: 'suite-1',
      protocol: 'http',
      name: 'B',
      request_schema: '{}',
    })
    moveItem({
      id: a.id,
      targetSuiteId: 'suite-1',
      targetFolderId: null,
      insertBeforeId: null,
    })
    const ordered = listItemsBySuite('suite-1')
    expect(ordered.map((r) => r.name)).toEqual(['B', 'A'])
  })
})

describe('bulkInsertItems', () => {
  it('inserts every row in a single transaction', () => {
    const rows = bulkInsertItems([
      { suite_id: 'suite-1', protocol: 'http', name: 'A', request_schema: '{}' },
      { suite_id: 'suite-1', protocol: 'http', name: 'B', request_schema: '{}' },
      { suite_id: 'suite-1', protocol: 'http', name: 'C', request_schema: '{}' },
    ])
    expect(rows).toHaveLength(3)
    expect(listItemsBySuite('suite-1').map((r) => r.name)).toEqual(['A', 'B', 'C'])
  })

  it('returns empty for an empty input without touching the DB', () => {
    expect(bulkInsertItems([])).toEqual([])
    expect(listItemsBySuite('suite-1')).toEqual([])
  })
})

describe('cascading deletes', () => {
  it('removes items when their parent suite is deleted', () => {
    createItem({
      suite_id: 'suite-1',
      protocol: 'http',
      name: 'A',
      request_schema: '{}',
    })
    memDb.prepare('DELETE FROM test_suites WHERE id = ?').run('suite-1')
    expect(listItemsBySuite('suite-1')).toEqual([])
  })

  it('removes items when their parent folder is deleted', () => {
    const folder = createFolder({ suite_id: 'suite-1', name: 'pet' })
    const item = createItem({
      suite_id: 'suite-1',
      folder_id: folder.id,
      protocol: 'http',
      name: 'A',
      request_schema: '{}',
    })
    deleteFolder(folder.id)
    expect(getItemById(item.id)).toBeUndefined()
  })
})

describe('folder operations', () => {
  it('creates folders with monotonically increasing sort_order', () => {
    const f1 = createFolder({ suite_id: 'suite-1', name: 'one' })
    const f2 = createFolder({ suite_id: 'suite-1', name: 'two' })
    expect(f1.sort_order).toBe(0)
    expect(f2.sort_order).toBe(1)
  })

  it('renames a folder and persists the change', () => {
    const f = createFolder({ suite_id: 'suite-1', name: 'old' })
    renameFolder(f.id, 'new')
    expect(listFoldersBySuite('suite-1')[0].name).toBe('new')
  })

  it('rejects moving a folder into one of its descendants', () => {
    const parent = createFolder({ suite_id: 'suite-1', name: 'parent' })
    const child = createFolder({ suite_id: 'suite-1', parent_id: parent.id, name: 'child' })
    // `isDescendantOf(child, parent)` should be true; the IPC layer uses this
    // to block illegal drops. Repo-level moveFolder doesn't enforce the cycle
    // guard itself.
    expect(isDescendantOf(child.id, parent.id)).toBe(true)
    expect(isDescendantOf(parent.id, child.id)).toBe(false)
  })

  it('moveFolder updates parent_id and renumbers siblings', () => {
    const a = createFolder({ suite_id: 'suite-1', name: 'A' })
    createFolder({ suite_id: 'suite-1', name: 'B' })
    const c = createFolder({ suite_id: 'suite-1', name: 'C' })
    moveFolder({
      id: c.id,
      targetSuiteId: 'suite-1',
      targetParentId: null,
      insertBeforeId: a.id,
    })
    const ordered = listFoldersBySuite('suite-1')
    expect(ordered.map((r) => r.name)).toEqual(['C', 'A', 'B'])
  })
})
