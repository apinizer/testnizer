/**
 * Tests for multi-format test suite import.
 *
 * The save handler's `importTestSuiteFromFile` now auto-detects between
 * Testnizer-native, Postman v2.1, and Insomnia v4 exports. This file
 * exercises each path against an in-memory better-sqlite3 instance.
 *
 * `getDb()` from `src/main/db/database` is module-scoped, so we mock the
 * module to hand out our test DB instead of opening one against
 * `app.getPath('userData')` (which would crash without Electron).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import Database from 'better-sqlite3'
import { randomUUID } from 'node:crypto'

let testDb: Database.Database

vi.mock('../../src/main/db/database', () => ({
  getDb: () => testDb,
}))

// Import AFTER vi.mock so the handler picks up our mocked getDb.
const { detectTestSuiteImportFormat, importTestSuiteFromFile, exportTestSuiteData } =
  await import('../../src/main/ipc/save.handler')

function createSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE projects (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      type TEXT NOT NULL DEFAULT 'http',
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE folders (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      parent_id TEXT,
      name TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      auth TEXT,
      pre_script TEXT,
      post_script TEXT
    );
    CREATE TABLE endpoints (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      folder_id TEXT,
      name TEXT NOT NULL,
      description TEXT,
      protocol TEXT NOT NULL DEFAULT 'http',
      method TEXT,
      path TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'developing',
      request_schema TEXT,
      response_schemas TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE endpoint_cases (
      id TEXT PRIMARY KEY,
      endpoint_id TEXT NOT NULL,
      name TEXT NOT NULL,
      params TEXT,
      headers TEXT,
      body TEXT,
      auth TEXT,
      assertions TEXT,
      is_default INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    );
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
      created_at INTEGER NOT NULL
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
      updated_at INTEGER NOT NULL
    );
  `)
}

const PROJECT_ID = 'p1'

beforeEach(() => {
  testDb = new Database(':memory:')
  createSchema(testDb)
  const now = Date.now()
  testDb
    .prepare(
      `INSERT INTO projects (id, workspace_id, name, type, sort_order, created_at, updated_at)
       VALUES (?, ?, ?, 'http', 0, ?, ?)`,
    )
    .run(PROJECT_ID, 'ws1', 'Test Project', now, now)
})

// ─── detectTestSuiteImportFormat ─────────────────────────────

describe('detectTestSuiteImportFormat', () => {
  it('recognises Testnizer-native exports', () => {
    expect(
      detectTestSuiteImportFormat({ kind: 'testSuite', version: '1.0.0', suite: { name: 'x' } }),
    ).toBe('testnizer')
  })

  it('recognises Postman v2.1 collections', () => {
    expect(
      detectTestSuiteImportFormat({
        info: {
          name: 'My Collection',
          schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
        },
        item: [],
      }),
    ).toBe('postman')
  })

  it('recognises Insomnia v4 exports', () => {
    expect(
      detectTestSuiteImportFormat({ _type: 'export', __export_format: 4, resources: [] }),
    ).toBe('insomnia')
  })

  it('recognises Insomnia v5 exports', () => {
    expect(
      detectTestSuiteImportFormat({ type: 'collection.insomnia.rest/5.0', collection: [] }),
    ).toBe('insomnia')
  })

  it('returns unknown for unrecognised input', () => {
    expect(detectTestSuiteImportFormat({})).toBe('unknown')
    expect(detectTestSuiteImportFormat(null)).toBe('unknown')
    expect(detectTestSuiteImportFormat('not-an-object')).toBe('unknown')
  })
})

// ─── Testnizer native round-trip ─────────────────────────────

describe('importTestSuiteFromFile — Testnizer native', () => {
  it('round-trips a native export back into a fresh suite (v1.3+ snapshot model)', async () => {
    // Seed: one suite with two self-contained items. No endpoints / no
    // junction — that schema was dropped.
    const now = Date.now()
    const suiteId = randomUUID()
    const item1 = randomUUID()
    const item2 = randomUUID()
    testDb
      .prepare(
        `INSERT INTO test_suites (id, project_id, name, sort_order, created_at, updated_at)
         VALUES (?, ?, 'Source Suite', 0, ?, ?)`,
      )
      .run(suiteId, PROJECT_ID, now, now)
    testDb
      .prepare(
        `INSERT INTO test_suite_items
           (id, suite_id, folder_id, protocol, name, method, url,
            request_schema, assertions, source_endpoint_id,
            sort_order, created_at, updated_at)
         VALUES (?, ?, NULL, 'http', ?, ?, '/users', '{}', NULL, NULL, ?, ?, ?)`,
      )
      .run(item1, suiteId, 'List users', 'GET', 0, now, now)
    testDb
      .prepare(
        `INSERT INTO test_suite_items
           (id, suite_id, folder_id, protocol, name, method, url,
            request_schema, assertions, source_endpoint_id,
            sort_order, created_at, updated_at)
         VALUES (?, ?, NULL, 'http', ?, ?, '/users', '{}', NULL, NULL, ?, ?, ?)`,
      )
      .run(item2, suiteId, 'Create user', 'POST', 1, now, now)

    // Export, then import as a brand-new suite.
    const exported = exportTestSuiteData(suiteId)
    const out = await importTestSuiteFromFile(JSON.stringify(exported), PROJECT_ID)

    expect(out.format).toBe('testnizer')
    expect(out.itemsImported).toBe(2)
    expect(out.suiteId).not.toBe(suiteId)

    const items = testDb
      .prepare(
        'SELECT id, name, method FROM test_suite_items WHERE suite_id = ? ORDER BY sort_order',
      )
      .all(out.suiteId) as { id: string; name: string; method: string }[]
    expect(items).toHaveLength(2)
    expect(items.map((i) => i.name)).toEqual(['List users', 'Create user'])
    // Items are remapped (fresh IDs), not pointing at the originals.
    for (const i of items) {
      expect(i.id).not.toBe(item1)
      expect(i.id).not.toBe(item2)
    }
  })

  it('preserves nested folders and remaps folder_id on items', async () => {
    // Seed: one suite with a top-level folder, a child folder, and items at
    // each level. Round-trip and check the tree shape survives.
    const now = Date.now()
    const suiteId = randomUUID()
    const parentFolder = randomUUID()
    const childFolder = randomUUID()
    const rootItem = randomUUID()
    const parentItem = randomUUID()
    const childItem = randomUUID()

    testDb
      .prepare(
        `INSERT INTO test_suites (id, project_id, name, sort_order, created_at, updated_at)
         VALUES (?, ?, 'Nested Suite', 0, ?, ?)`,
      )
      .run(suiteId, PROJECT_ID, now, now)
    testDb
      .prepare(
        `INSERT INTO test_suite_folders (id, suite_id, parent_id, name, sort_order, created_at)
         VALUES (?, ?, NULL, 'parent', 0, ?)`,
      )
      .run(parentFolder, suiteId, now)
    testDb
      .prepare(
        `INSERT INTO test_suite_folders (id, suite_id, parent_id, name, sort_order, created_at)
         VALUES (?, ?, ?, 'child', 0, ?)`,
      )
      .run(childFolder, suiteId, parentFolder, now)
    const insertItem = testDb.prepare(
      `INSERT INTO test_suite_items
         (id, suite_id, folder_id, protocol, name, method, url,
          request_schema, assertions, source_endpoint_id,
          sort_order, created_at, updated_at)
       VALUES (?, ?, ?, 'http', ?, 'GET', '/x', '{}', NULL, NULL, 0, ?, ?)`,
    )
    insertItem.run(rootItem, suiteId, null, 'root-level', now, now)
    insertItem.run(parentItem, suiteId, parentFolder, 'in-parent', now, now)
    insertItem.run(childItem, suiteId, childFolder, 'in-child', now, now)

    const exported = exportTestSuiteData(suiteId)
    const out = await importTestSuiteFromFile(JSON.stringify(exported), PROJECT_ID)
    expect(out.itemsImported).toBe(3)

    const folders = testDb
      .prepare(
        'SELECT id, parent_id, name FROM test_suite_folders WHERE suite_id = ? ORDER BY name',
      )
      .all(out.suiteId) as { id: string; parent_id: string | null; name: string }[]
    expect(folders.map((f) => f.name).sort()).toEqual(['child', 'parent'])

    const parentRow = folders.find((f) => f.name === 'parent')!
    const childRow = folders.find((f) => f.name === 'child')!
    // child.parent_id must remap to the NEW parent id, not the source's.
    expect(childRow.parent_id).toBe(parentRow.id)
    expect(parentRow.parent_id).toBeNull()

    const importedItems = testDb
      .prepare('SELECT name, folder_id FROM test_suite_items WHERE suite_id = ?')
      .all(out.suiteId) as { name: string; folder_id: string | null }[]
    const byName = Object.fromEntries(importedItems.map((i) => [i.name, i.folder_id]))
    expect(byName['root-level']).toBeNull()
    expect(byName['in-parent']).toBe(parentRow.id)
    expect(byName['in-child']).toBe(childRow.id)
  })
})

// ─── Postman v2.1 ───────────────────────────────────────────

describe('importTestSuiteFromFile — Postman v2.1', () => {
  it('creates a suite plus endpoints from a Postman collection', async () => {
    const collection = {
      info: {
        name: 'PetStore',
        _postman_id: '123',
        schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
      },
      item: [
        {
          name: 'List pets',
          request: {
            method: 'GET',
            url: {
              raw: 'https://api.example.com/pets',
              host: ['api', 'example', 'com'],
              path: ['pets'],
            },
            header: [],
          },
        },
        {
          name: 'Create pet',
          request: {
            method: 'POST',
            url: {
              raw: 'https://api.example.com/pets',
              host: ['api', 'example', 'com'],
              path: ['pets'],
            },
            header: [{ key: 'Content-Type', value: 'application/json' }],
            body: { mode: 'raw', raw: '{"name":"rex"}', options: { raw: { language: 'json' } } },
          },
        },
        {
          name: 'Group',
          item: [
            {
              name: 'Get pet',
              request: {
                method: 'GET',
                url: {
                  raw: 'https://api.example.com/pets/1',
                  host: ['api', 'example', 'com'],
                  path: ['pets', '1'],
                },
              },
            },
          ],
        },
      ],
    }

    const out = await importTestSuiteFromFile(JSON.stringify(collection), PROJECT_ID)
    expect(out.format).toBe('postman')
    // 2 top-level requests + 1 nested = 3 suite items materialised.
    expect(out.itemsImported).toBe(3)

    // v1.3+: the snapshot lives in test_suite_items and the transient
    // endpoint rows are deleted on the way out — the suite owns its data.
    const items = testDb
      .prepare('SELECT name, method FROM test_suite_items WHERE suite_id = ?')
      .all(out.suiteId) as { name: string; method: string }[]
    expect(items.map((r) => r.name).sort()).toEqual(['Create pet', 'Get pet', 'List pets'])

    // No leftover endpoints in the APIs tree — the importer rolls them up
    // into the suite to avoid cross-tree duplication.
    const leftoverEndpoints = testDb
      .prepare('SELECT COUNT(*) AS n FROM endpoints WHERE project_id = ?')
      .get(PROJECT_ID) as { n: number }
    expect(leftoverEndpoints.n).toBe(0)

    // Suite name is derived from collection.info.name.
    const suiteRow = testDb
      .prepare('SELECT name FROM test_suites WHERE id = ?')
      .get(out.suiteId) as { name: string }
    expect(suiteRow.name).toContain('PetStore')
  })

  it('carries folder-level scripts and auth into test_suite_folders (cascade parity with Insomnia)', async () => {
    // The "Setup folder → token pre-request script → Bearer inherit" pattern —
    // the Postman sibling of the Insomnia v5 cascade test below. importPostman
    // now persists the folder's event[]/auth onto the folders table, and the
    // suite snapshot copies them into test_suite_folders so the runner's
    // cascade actually runs the token step. Before the fix these were NULL and
    // a real Postman customer's suite would 401 on the first protected request.
    const collection = {
      info: {
        name: 'TokenFlow',
        schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
      },
      item: [
        {
          name: 'Setup',
          auth: { type: 'bearer', bearer: [{ key: 'token', value: '{{accessToken}}' }] },
          event: [
            {
              listen: 'prerequest',
              script: { exec: ["pm.environment.set('accessToken', 'tok')"] },
            },
            { listen: 'test', script: { exec: ['pm.test("ok", () => {})'] } },
          ],
          item: [
            {
              name: 'Login',
              request: { method: 'POST', url: { raw: 'https://api.example.com/login' } },
            },
          ],
        },
      ],
    }

    const out = await importTestSuiteFromFile(JSON.stringify(collection), PROJECT_ID)
    expect(out.format).toBe('postman')

    const folder = testDb
      .prepare(
        'SELECT auth, pre_script, post_script FROM test_suite_folders WHERE suite_id = ? AND name = ?',
      )
      .get(out.suiteId, 'Setup') as {
      auth: string | null
      pre_script: string | null
      post_script: string | null
    }
    expect(folder.pre_script).toContain("pm.environment.set('accessToken'")
    expect(folder.post_script).toContain('pm.test')
    expect(JSON.parse(folder.auth!).type).toBe('bearer')
  })
})

// ─── Insomnia v4 ────────────────────────────────────────────

describe('importTestSuiteFromFile — Insomnia v4', () => {
  it('creates a suite from an Insomnia v4 export', async () => {
    const doc = {
      _type: 'export',
      __export_format: 4,
      resources: [
        {
          _id: 'req_1',
          _type: 'request',
          parentId: null,
          name: 'List users',
          method: 'GET',
          url: 'https://api.example.com/users',
          headers: [],
          parameters: [],
        },
        {
          _id: 'req_2',
          _type: 'request',
          parentId: null,
          name: 'Create user',
          method: 'POST',
          url: 'https://api.example.com/users',
          headers: [{ name: 'Content-Type', value: 'application/json' }],
          parameters: [],
          body: { mimeType: 'application/json', text: '{"name":"a"}' },
        },
      ],
    }

    const out = await importTestSuiteFromFile(JSON.stringify(doc), PROJECT_ID, 'My Insomnia Tests')
    expect(out.format).toBe('insomnia')
    expect(out.itemsImported).toBe(2)

    const suiteRow = testDb
      .prepare('SELECT name FROM test_suites WHERE id = ?')
      .get(out.suiteId) as { name: string }
    expect(suiteRow.name).toBe('My Insomnia Tests')

    const items = testDb
      .prepare('SELECT method FROM test_suite_items WHERE suite_id = ? ORDER BY sort_order')
      .all(out.suiteId) as { method: string }[]
    expect(items.map((r) => r.method)).toEqual(['GET', 'POST'])

    // The transient APIs-tree endpoint rows used during snapshotting are
    // cleaned up — the suite is the only authoritative location now.
    const leftoverEndpoints = testDb
      .prepare('SELECT COUNT(*) AS n FROM endpoints WHERE project_id = ?')
      .get(PROJECT_ID) as { n: number }
    expect(leftoverEndpoints.n).toBe(0)
  })
})

// ─── Insomnia v5 (YAML) ─────────────────────────────────────

describe('importTestSuiteFromFile — Insomnia v5 YAML', () => {
  it('imports an Insomnia v5 export shipped as YAML (not JSON)', async () => {
    // Insomnia v5's default export is YAML — the suite importer must accept
    // the same shape the APIs-tree importer already handles. JSON.parse fails
    // on YAML so we fall through to js-yaml.
    const yamlDoc = [
      'type: collection.insomnia.rest/5.0',
      'name: Yaml Suite',
      'collection:',
      '  - name: Ping',
      '    url: https://api.example.com/ping',
      '    method: GET',
    ].join('\n')

    const out = await importTestSuiteFromFile(yamlDoc, PROJECT_ID)
    expect(out.format).toBe('insomnia')
    expect(out.itemsImported).toBeGreaterThan(0)
  })

  it('preserves the nested folder tree, folder scripts, ordering, and cleans up the APIs tree', async () => {
    // A pre-existing APIs-tree folder + endpoint in the SAME project. The suite
    // import must NOT touch these (R1: scope strictly to the imported subtree).
    const now = Date.now()
    testDb
      .prepare(
        `INSERT INTO folders (id, project_id, parent_id, name, sort_order) VALUES ('keepf', ?, NULL, 'KEEP', 0)`,
      )
      .run(PROJECT_ID)
    testDb
      .prepare(
        `INSERT INTO endpoints
           (id, project_id, folder_id, name, description, protocol, method, path, status,
            request_schema, response_schemas, sort_order, created_at, updated_at)
         VALUES ('keepe', ?, 'keepf', 'Keeper', NULL, 'http', 'GET', '/keep', 'developing', '{}', NULL, 0, ?, ?)`,
      )
      .run(PROJECT_ID, now, now)

    // Insomnia v5 doc as JSON (importTestSuiteFromFile tries JSON.parse first).
    // Two root folders deliberately OUT of array order (Flow before Setup) with
    // sortKeys that put Setup first — proves we sort by sortKey, not array order.
    // "01 Setup" carries a folder-level preRequest script and a nested subfolder.
    const doc = {
      type: 'collection.insomnia.rest/5.0',
      name: 'APIOPS Mini',
      collection: [
        {
          name: '02 Flow',
          meta: { sortKey: -100 },
          children: [{ name: 'Do Thing', url: 'https://api.example.com/thing', method: 'GET' }],
        },
        {
          name: '01 Setup',
          meta: { sortKey: -200 },
          scripts: { preRequest: 'insomnia.environment.set("runId", "abc123")' },
          children: [
            {
              name: '01a Init',
              meta: { sortKey: -10 },
              children: [
                { name: 'Init runId', url: 'https://api.example.com/init', method: 'POST' },
              ],
            },
          ],
        },
      ],
    }

    const out = await importTestSuiteFromFile(JSON.stringify(doc), PROJECT_ID)
    expect(out.format).toBe('insomnia')
    expect(out.itemsImported).toBe(2)

    // ── Folder tree preserved into test_suite_folders ──
    const folders = testDb
      .prepare(
        'SELECT id, parent_id, name, sort_order, pre_script FROM test_suite_folders WHERE suite_id = ?',
      )
      .all(out.suiteId) as {
      id: string
      parent_id: string | null
      name: string
      sort_order: number
      pre_script: string | null
    }[]
    expect(folders.map((f) => f.name).sort()).toEqual(['01 Setup', '01a Init', '02 Flow'])
    const setup = folders.find((f) => f.name === '01 Setup')!
    const init = folders.find((f) => f.name === '01a Init')!
    const flow = folders.find((f) => f.name === '02 Flow')!
    // depth-2 nesting: Init's parent remaps to the NEW Setup id.
    expect(init.parent_id).toBe(setup.id)
    expect(setup.parent_id).toBeNull()
    expect(flow.parent_id).toBeNull()
    // Setup sorts before Flow (sortKey -200 < -100), even though Flow was first
    // in the array.
    expect(setup.sort_order).toBeLessThan(flow.sort_order)
    // B-scripts: folder-level preRequest survived the import.
    expect(setup.pre_script).toContain('runId')

    // ── Items carry the correct (non-null) remapped folder_id ──
    const items = testDb
      .prepare('SELECT name, folder_id FROM test_suite_items WHERE suite_id = ?')
      .all(out.suiteId) as { name: string; folder_id: string | null }[]
    const byName = Object.fromEntries(items.map((i) => [i.name, i.folder_id]))
    expect(byName['Do Thing']).toBe(flow.id)
    expect(byName['Init runId']).toBe(init.id) // depth-2 item

    // ── APIs tree cleaned up: imported endpoints + folders gone ──
    const leakedFolders = testDb
      .prepare(`SELECT count(*) AS n FROM folders WHERE name IN ('01 Setup','02 Flow','01a Init')`)
      .get() as { n: number }
    expect(leakedFolders.n).toBe(0)
    const leakedEndpoints = testDb
      .prepare(`SELECT count(*) AS n FROM endpoints WHERE name IN ('Do Thing','Init runId')`)
      .get() as { n: number }
    expect(leakedEndpoints.n).toBe(0)

    // ── R1: the pre-existing APIs folder + endpoint survive untouched ──
    expect(
      (testDb.prepare(`SELECT count(*) AS n FROM folders WHERE id='keepf'`).get() as { n: number })
        .n,
    ).toBe(1)
    expect(
      (
        testDb.prepare(`SELECT count(*) AS n FROM endpoints WHERE id='keepe'`).get() as {
          n: number
        }
      ).n,
    ).toBe(1)
  })
})

// ─── Bad input ──────────────────────────────────────────────

describe('importTestSuiteFromFile — error paths', () => {
  it('throws when input is neither valid JSON nor YAML', async () => {
    // Use a string that breaks both parsers — bare braces survive YAML's
    // lenient scalar parser, so we feed it something obviously malformed.
    await expect(importTestSuiteFromFile('{ broken: [unclosed', PROJECT_ID)).rejects.toThrow(
      /Could not parse file as JSON or YAML/,
    )
  })

  it('throws on unknown format (valid JSON but wrong shape)', async () => {
    await expect(
      importTestSuiteFromFile(JSON.stringify({ random: 'shape' }), PROJECT_ID),
    ).rejects.toThrow(/Unknown test suite format/)
  })

  it('throws on a pre-v2 (legacy junction) Testnizer suite export', async () => {
    // Legacy shape carried `endpoints` + `suiteEndpoints` arrays — the
    // junction table is gone, so the importer refuses to silently produce
    // an empty suite. The user must re-export from the current version.
    const legacy = {
      version: '1.0.0',
      exportedAt: 0,
      kind: 'testSuite',
      suite: { name: 'old' },
      endpoints: [{ id: 'x', name: 'old', protocol: 'http' }],
      endpointCases: [],
      suiteEndpoints: [{ id: 'l', suite_id: 's', endpoint_id: 'x', sort_order: 0 }],
    }
    await expect(importTestSuiteFromFile(JSON.stringify(legacy), PROJECT_ID)).rejects.toThrow(
      /Unsupported Testnizer suite export/,
    )
  })
})
