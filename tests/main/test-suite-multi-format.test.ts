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
const {
  detectTestSuiteImportFormat,
  importTestSuiteFromFile,
  exportTestSuiteData,
} = await import('../../src/main/ipc/save.handler')

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
      sort_order INTEGER NOT NULL DEFAULT 0
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
    CREATE TABLE test_suite_endpoints (
      id TEXT PRIMARY KEY,
      suite_id TEXT NOT NULL,
      endpoint_id TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0
    );
    CREATE UNIQUE INDEX idx_tse_unique ON test_suite_endpoints(suite_id, endpoint_id);
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
  it('round-trips a native export back into a fresh suite', async () => {
    // Seed: one suite with two endpoints.
    const now = Date.now()
    const suiteId = randomUUID()
    const ep1 = randomUUID()
    const ep2 = randomUUID()
    testDb
      .prepare(
        `INSERT INTO test_suites (id, project_id, name, sort_order, created_at, updated_at)
         VALUES (?, ?, 'Source Suite', 0, ?, ?)`,
      )
      .run(suiteId, PROJECT_ID, now, now)
    for (const [id, name, method] of [
      [ep1, 'List users', 'GET'],
      [ep2, 'Create user', 'POST'],
    ] as const) {
      testDb
        .prepare(
          `INSERT INTO endpoints (id, project_id, folder_id, name, protocol, method, path, status, sort_order, created_at, updated_at)
           VALUES (?, ?, NULL, ?, 'http', ?, '/users', 'developing', 0, ?, ?)`,
        )
        .run(id, PROJECT_ID, name, method, now, now)
    }
    testDb
      .prepare(
        `INSERT INTO test_suite_endpoints (id, suite_id, endpoint_id, sort_order)
         VALUES (?, ?, ?, ?)`,
      )
      .run(randomUUID(), suiteId, ep1, 0)
    testDb
      .prepare(
        `INSERT INTO test_suite_endpoints (id, suite_id, endpoint_id, sort_order)
         VALUES (?, ?, ?, ?)`,
      )
      .run(randomUUID(), suiteId, ep2, 1)

    // Export, then import as a brand-new suite.
    const exported = exportTestSuiteData(suiteId)
    const out = await importTestSuiteFromFile(JSON.stringify(exported), PROJECT_ID)

    expect(out.format).toBe('testnizer')
    expect(out.endpointsImported).toBe(2)
    expect(out.suiteId).not.toBe(suiteId)

    const links = testDb
      .prepare('SELECT endpoint_id FROM test_suite_endpoints WHERE suite_id = ? ORDER BY sort_order')
      .all(out.suiteId) as { endpoint_id: string }[]
    expect(links).toHaveLength(2)
    // Endpoints are remapped (fresh IDs), not pointing at the originals.
    for (const l of links) {
      expect(l.endpoint_id).not.toBe(ep1)
      expect(l.endpoint_id).not.toBe(ep2)
    }
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
            url: { raw: 'https://api.example.com/pets', host: ['api', 'example', 'com'], path: ['pets'] },
            header: [],
          },
        },
        {
          name: 'Create pet',
          request: {
            method: 'POST',
            url: { raw: 'https://api.example.com/pets', host: ['api', 'example', 'com'], path: ['pets'] },
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
                url: { raw: 'https://api.example.com/pets/1', host: ['api', 'example', 'com'], path: ['pets', '1'] },
              },
            },
          ],
        },
      ],
    }

    const out = await importTestSuiteFromFile(JSON.stringify(collection), PROJECT_ID)
    expect(out.format).toBe('postman')
    // 2 top-level requests + 1 nested = 3 endpoints linked to the suite
    expect(out.endpointsImported).toBe(3)

    const links = testDb
      .prepare('SELECT endpoint_id FROM test_suite_endpoints WHERE suite_id = ?')
      .all(out.suiteId) as { endpoint_id: string }[]
    expect(links).toHaveLength(3)

    // Endpoints actually exist under the project.
    const epRows = testDb
      .prepare('SELECT name, method FROM endpoints WHERE project_id = ?')
      .all(PROJECT_ID) as { name: string; method: string }[]
    expect(epRows.map((r) => r.name).sort()).toEqual(['Create pet', 'Get pet', 'List pets'])

    // Suite name is derived from collection.info.name.
    const suiteRow = testDb
      .prepare('SELECT name FROM test_suites WHERE id = ?')
      .get(out.suiteId) as { name: string }
    expect(suiteRow.name).toContain('PetStore')
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
    expect(out.endpointsImported).toBe(2)

    const suiteRow = testDb
      .prepare('SELECT name FROM test_suites WHERE id = ?')
      .get(out.suiteId) as { name: string }
    expect(suiteRow.name).toBe('My Insomnia Tests')

    const links = testDb
      .prepare('SELECT endpoint_id FROM test_suite_endpoints WHERE suite_id = ? ORDER BY sort_order')
      .all(out.suiteId) as { endpoint_id: string }[]
    expect(links).toHaveLength(2)

    const methods = links
      .map((l) => testDb.prepare('SELECT method FROM endpoints WHERE id = ?').get(l.endpoint_id) as { method: string })
      .map((r) => r.method)
    expect(methods).toEqual(['GET', 'POST'])
  })
})

// ─── Bad input ──────────────────────────────────────────────

describe('importTestSuiteFromFile — error paths', () => {
  it('throws on non-JSON input', async () => {
    await expect(importTestSuiteFromFile('this is not json{', PROJECT_ID)).rejects.toThrow(
      /Could not parse file as JSON/,
    )
  })

  it('throws on unknown format (valid JSON but wrong shape)', async () => {
    await expect(
      importTestSuiteFromFile(JSON.stringify({ random: 'shape' }), PROJECT_ID),
    ).rejects.toThrow(/Unknown test suite format/)
  })
})
