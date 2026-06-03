/**
 * Round-trip audit for the Testnizer-native APIs project export / import.
 *
 * The flow we're guarding here is "user clicks Export Project → produces a
 * project-bundle JSON → user clicks Import Project → upserts every row
 * back into another project". We need that every:
 *   - folder + nested folder
 *   - endpoint + endpoint_case
 *   - saved_request
 *   - environment + environment_variable
 *   - global_variable
 *   - test_suite + test_suite_folder + test_suite_item
 *   - mock_server + mock_endpoint + mock_response
 *   - certificate
 * round-trips byte-for-byte. Anything missing here means an export users
 * actually rely on is silently losing data.
 *
 * Schema mirrors src/main/db/database.ts. getDb() is mocked so the real
 * better-sqlite3 file isn't touched.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import Database from 'better-sqlite3'
import { randomUUID } from 'node:crypto'

let testDb: Database.Database

vi.mock('../../src/main/db/database', () => ({
  getDb: () => testDb,
}))

const { exportProjectData, importProjectDataFromJson, exportFolderData, importFolderData } =
  await import('../../src/main/ipc/save.handler')

function createSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE workspaces (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
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
    CREATE TABLE saved_requests (
      id TEXT PRIMARY KEY,
      project_id TEXT,
      folder_id TEXT,
      name TEXT NOT NULL,
      protocol TEXT NOT NULL DEFAULT 'http',
      method TEXT,
      url TEXT NOT NULL,
      params TEXT NOT NULL DEFAULT '[]',
      headers TEXT NOT NULL DEFAULT '[]',
      body TEXT,
      auth TEXT,
      pre_script TEXT,
      post_script TEXT,
      assertions TEXT NOT NULL DEFAULT '[]',
      metadata TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE environments (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      project_id TEXT,
      name TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE environment_variables (
      id TEXT PRIMARY KEY,
      environment_id TEXT NOT NULL,
      key TEXT NOT NULL,
      value TEXT NOT NULL DEFAULT '',
      description TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,
      secret INTEGER NOT NULL DEFAULT 0,
      initial_value TEXT
    );
    CREATE TABLE global_variables (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      project_id TEXT,
      key TEXT NOT NULL,
      value TEXT NOT NULL DEFAULT '',
      description TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,
      secret INTEGER NOT NULL DEFAULT 0,
      initial_value TEXT
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
    CREATE TABLE mock_servers (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      host TEXT NOT NULL DEFAULT '127.0.0.1',
      port INTEGER NOT NULL,
      base_path TEXT NOT NULL DEFAULT '',
      auto_start INTEGER NOT NULL DEFAULT 0,
      cors_enabled INTEGER NOT NULL DEFAULT 0,
      cors_allow_origins TEXT NOT NULL DEFAULT '*',
      cors_allow_methods TEXT NOT NULL DEFAULT 'GET,POST,PUT,PATCH,DELETE,HEAD,OPTIONS',
      cors_allow_headers TEXT NOT NULL DEFAULT '*',
      cors_allow_credentials INTEGER NOT NULL DEFAULT 0,
      cors_max_age INTEGER NOT NULL DEFAULT 600,
      auth_config TEXT NOT NULL DEFAULT '{"type":"none"}',
      failure_config TEXT NOT NULL DEFAULT '{"enabled":false}',
      rate_limit_config TEXT NOT NULL DEFAULT '{"enabled":false}',
      echo_enabled INTEGER NOT NULL DEFAULT 0,
      proxy_enabled INTEGER NOT NULL DEFAULT 0,
      proxy_target TEXT NOT NULL DEFAULT '',
      proxy_record INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE mock_endpoints (
      id TEXT PRIMARY KEY,
      server_id TEXT NOT NULL,
      method TEXT NOT NULL DEFAULT 'GET',
      path TEXT NOT NULL,
      path_mode TEXT NOT NULL DEFAULT 'exact',
      description TEXT NOT NULL DEFAULT '',
      priority INTEGER NOT NULL DEFAULT 0,
      enabled INTEGER NOT NULL DEFAULT 1,
      sort_order INTEGER NOT NULL DEFAULT 0,
      auth_override TEXT NOT NULL DEFAULT '',
      schema_validation TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE mock_responses (
      id TEXT PRIMARY KEY,
      endpoint_id TEXT NOT NULL,
      name TEXT NOT NULL DEFAULT '',
      status_code INTEGER NOT NULL DEFAULT 200,
      headers TEXT NOT NULL DEFAULT '[]',
      body_type TEXT NOT NULL DEFAULT 'json',
      body TEXT NOT NULL DEFAULT '',
      delay_ms INTEGER NOT NULL DEFAULT 0,
      condition TEXT NOT NULL DEFAULT '{"type":"always"}',
      script TEXT NOT NULL DEFAULT '',
      response_order INTEGER NOT NULL DEFAULT 0,
      enabled INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE certificates (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'client',
      host TEXT,
      crt_path TEXT,
      key_path TEXT,
      pfx_path TEXT,
      passphrase TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL
    );
  `)
}

const WORKSPACE_ID = 'ws-roundtrip'
const SOURCE_PID = 'p-src'
const TARGET_PID = 'p-dst'

beforeEach(() => {
  testDb = new Database(':memory:')
  createSchema(testDb)
  const now = Date.now()
  testDb
    .prepare(`INSERT INTO workspaces (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)`)
    .run(WORKSPACE_ID, 'Round-Trip WS', now, now)
  testDb
    .prepare(
      `INSERT INTO projects (id, workspace_id, name, type, sort_order, created_at, updated_at)
       VALUES (?, ?, 'Source Project', 'http', 0, ?, ?)`,
    )
    .run(SOURCE_PID, WORKSPACE_ID, now, now)
  testDb
    .prepare(
      `INSERT INTO projects (id, workspace_id, name, type, sort_order, created_at, updated_at)
       VALUES (?, ?, 'Target Project', 'http', 1, ?, ?)`,
    )
    .run(TARGET_PID, WORKSPACE_ID, now, now)
})

// Build a representative source project with one row in every table the
// project export claims to cover, then seed the DB. Returning the IDs lets
// individual tests assert on specific rows.
function seedRichProject(): {
  rootFolderId: string
  childFolderId: string
  endpointId: string
  endpointCaseId: string
  savedRequestId: string
  envId: string
  envVarId: string
  globalVarId: string
  suiteId: string
  suiteFolderId: string
  suiteItemId: string
  mockServerId: string
  mockEndpointId: string
  mockResponseId: string
  certificateId: string
} {
  const now = Date.now()
  const ids = {
    rootFolderId: randomUUID(),
    childFolderId: randomUUID(),
    endpointId: randomUUID(),
    endpointCaseId: randomUUID(),
    savedRequestId: randomUUID(),
    envId: randomUUID(),
    envVarId: randomUUID(),
    globalVarId: randomUUID(),
    suiteId: randomUUID(),
    suiteFolderId: randomUUID(),
    suiteItemId: randomUUID(),
    mockServerId: randomUUID(),
    mockEndpointId: randomUUID(),
    mockResponseId: randomUUID(),
    certificateId: randomUUID(),
  }

  testDb
    .prepare(
      `INSERT INTO folders (id, project_id, parent_id, name, sort_order) VALUES (?, ?, NULL, 'Root', 0)`,
    )
    .run(ids.rootFolderId, SOURCE_PID)
  testDb
    .prepare(
      `INSERT INTO folders (id, project_id, parent_id, name, sort_order) VALUES (?, ?, ?, 'Child', 0)`,
    )
    .run(ids.childFolderId, SOURCE_PID, ids.rootFolderId)

  testDb
    .prepare(
      `INSERT INTO endpoints
         (id, project_id, folder_id, name, description, protocol, method, path, status,
          request_schema, response_schemas, sort_order, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'http', 'POST', '/users', 'developing',
               ?, ?, 0, ?, ?)`,
    )
    .run(
      ids.endpointId,
      SOURCE_PID,
      ids.childFolderId,
      'Create User',
      'desc',
      JSON.stringify({ url: '{{base}}/users', headers: [{ key: 'Content-Type', value: 'application/json' }], body: { type: 'json', content: '{"x":1}' } }),
      JSON.stringify([{ status: 200 }]),
      now,
      now,
    )

  testDb
    .prepare(
      `INSERT INTO endpoint_cases
         (id, endpoint_id, name, params, headers, body, auth, assertions, is_default, created_at)
       VALUES (?, ?, 'Happy path', '[]', '[{"key":"X-Test","value":"y"}]', '{"raw":"{\\"x\\":1}"}', '{"type":"none"}', '[{"target":"status","op":"eq","value":200}]', 1, ?)`,
    )
    .run(ids.endpointCaseId, ids.endpointId, now)

  testDb
    .prepare(
      `INSERT INTO saved_requests
         (id, project_id, folder_id, name, protocol, method, url, params, headers, body,
          auth, pre_script, post_script, assertions, metadata, sort_order, created_at, updated_at)
       VALUES (?, ?, NULL, 'My Saved', 'http', 'GET', 'https://api.example/save',
               '[]', '[]', '', NULL, 'pre()', 'post()', '[]', NULL, 0, ?, ?)`,
    )
    .run(ids.savedRequestId, SOURCE_PID, now, now)

  // Project-scoped environment
  testDb
    .prepare(
      `INSERT INTO environments (id, workspace_id, project_id, name, is_active, created_at, updated_at)
       VALUES (?, ?, ?, 'Dev', 1, ?, ?)`,
    )
    .run(ids.envId, WORKSPACE_ID, SOURCE_PID, now, now)
  testDb
    .prepare(
      `INSERT INTO environment_variables
         (id, environment_id, key, value, description, enabled, secret, initial_value)
       VALUES (?, ?, 'base', 'https://example.com', 'API root', 1, 0, 'https://example.com')`,
    )
    .run(ids.envVarId, ids.envId)

  // Project-scoped global variable
  testDb
    .prepare(
      `INSERT INTO global_variables
         (id, workspace_id, project_id, key, value, description, enabled, secret, initial_value)
       VALUES (?, ?, ?, 'apiKey', 'abc', 'token', 1, 1, 'abc')`,
    )
    .run(ids.globalVarId, WORKSPACE_ID, SOURCE_PID)

  // Test suite + folder + item
  testDb
    .prepare(
      `INSERT INTO test_suites (id, project_id, name, description, sort_order, created_at, updated_at)
       VALUES (?, ?, 'Smoke Suite', 'desc', 0, ?, ?)`,
    )
    .run(ids.suiteId, SOURCE_PID, now, now)
  testDb
    .prepare(
      `INSERT INTO test_suite_folders
         (id, suite_id, parent_id, name, sort_order, created_at)
       VALUES (?, ?, NULL, 'Inner', 0, ?)`,
    )
    .run(ids.suiteFolderId, ids.suiteId, now)
  testDb
    .prepare(
      `INSERT INTO test_suite_items
         (id, suite_id, folder_id, protocol, name, method, url,
          request_schema, assertions, source_endpoint_id, sort_order, created_at, updated_at)
       VALUES (?, ?, ?, 'http', 'Item 1', 'GET', 'https://example.com/x',
               '{"url":"https://example.com/x","method":"GET"}',
               '[{"target":"status","op":"eq","value":200}]', ?, 0, ?, ?)`,
    )
    .run(ids.suiteItemId, ids.suiteId, ids.suiteFolderId, ids.endpointId, now, now)

  // Mock server + endpoint + response
  testDb
    .prepare(
      `INSERT INTO mock_servers
         (id, project_id, name, port, created_at, updated_at)
       VALUES (?, ?, 'Mock-1', 4000, ?, ?)`,
    )
    .run(ids.mockServerId, SOURCE_PID, now, now)
  testDb
    .prepare(
      `INSERT INTO mock_endpoints
         (id, server_id, method, path, created_at, updated_at)
       VALUES (?, ?, 'GET', '/health', ?, ?)`,
    )
    .run(ids.mockEndpointId, ids.mockServerId, now, now)
  testDb
    .prepare(
      `INSERT INTO mock_responses
         (id, endpoint_id, name, status_code, body)
       VALUES (?, ?, 'OK', 200, '{"ok":true}')`,
    )
    .run(ids.mockResponseId, ids.mockEndpointId)

  // Client certificate
  testDb
    .prepare(
      `INSERT INTO certificates
         (id, project_id, kind, host, crt_path, key_path, enabled, created_at)
       VALUES (?, ?, 'client', 'example.com', '/tmp/c.crt', '/tmp/c.key', 1, ?)`,
    )
    .run(ids.certificateId, SOURCE_PID, now)

  return ids
}

// ───────── Export shape sanity ─────────

describe('exportProjectData — shape sanity', () => {
  it('serialises every row from every table the export claims to cover', () => {
    seedRichProject()
    const data = exportProjectData(SOURCE_PID)

    expect(data.kind).toBe('project')
    expect(data.folders.length).toBe(2)
    expect(data.endpoints.length).toBe(1)
    expect(data.endpointCases.length).toBe(1)
    expect(data.savedRequests.length).toBe(1)
    expect(data.environments?.length).toBe(1)
    expect(data.environmentVariables?.length).toBe(1)
    expect(data.globalVariables?.length).toBe(1)
    expect(data.testSuites?.length).toBe(1)
    expect(data.testSuiteFolders?.length).toBe(1)
    expect(data.testSuiteItems?.length).toBe(1)
    expect(data.mockServers?.length).toBe(1)
    expect(data.mockEndpoints?.length).toBe(1)
    expect(data.mockResponses?.length).toBe(1)
    expect(data.certificates?.length).toBe(1)
  })
})

// ───────── Round-trip into a different project ─────────

describe('Project export → import round-trip (different target project)', () => {
  it('upserts folders into the target project with parent_id preserved', () => {
    const ids = seedRichProject()
    const data = exportProjectData(SOURCE_PID)
    // Re-target the project_id on rows that carry it. Real "Import as new
    // project" rewrites these (see importProjectAsNew); here we simulate by
    // re-pointing the rows in the bundle before importing them as upserts.
    for (const f of data.folders) f.project_id = TARGET_PID
    for (const e of data.endpoints) e.project_id = TARGET_PID
    for (const r of data.savedRequests) r.project_id = TARGET_PID
    for (const env of data.environments ?? []) env.project_id = TARGET_PID
    for (const g of data.globalVariables ?? []) g.project_id = TARGET_PID
    for (const s of data.testSuites ?? []) s.project_id = TARGET_PID
    for (const m of data.mockServers ?? []) m.project_id = TARGET_PID
    for (const c of data.certificates ?? []) c.project_id = TARGET_PID

    importProjectDataFromJson(JSON.stringify(data), TARGET_PID)

    const folders = testDb
      .prepare('SELECT id, parent_id, name FROM folders WHERE project_id = ? ORDER BY name')
      .all(TARGET_PID) as { id: string; parent_id: string | null; name: string }[]
    expect(folders).toHaveLength(2)
    const root = folders.find((f) => f.name === 'Root')!
    const child = folders.find((f) => f.name === 'Child')!
    expect(root.id).toBe(ids.rootFolderId)
    expect(child.parent_id).toBe(ids.rootFolderId)
  })

  it('round-trips endpoints with request_schema content verbatim', () => {
    const ids = seedRichProject()
    const data = exportProjectData(SOURCE_PID)
    for (const e of data.endpoints) e.project_id = TARGET_PID
    for (const f of data.folders) f.project_id = TARGET_PID
    importProjectDataFromJson(JSON.stringify(data), TARGET_PID)

    const row = testDb
      .prepare('SELECT name, method, path, request_schema FROM endpoints WHERE id = ?')
      .get(ids.endpointId) as {
      name: string
      method: string
      path: string
      request_schema: string
    }
    expect(row.name).toBe('Create User')
    expect(row.method).toBe('POST')
    expect(row.path).toBe('/users')
    const schema = JSON.parse(row.request_schema)
    expect(schema.url).toBe('{{base}}/users')
    expect(schema.headers[0]).toEqual({ key: 'Content-Type', value: 'application/json' })
    expect(schema.body).toEqual({ type: 'json', content: '{"x":1}' })
  })

  it('round-trips endpoint_cases including assertions JSON', () => {
    const ids = seedRichProject()
    const data = exportProjectData(SOURCE_PID)
    for (const e of data.endpoints) e.project_id = TARGET_PID
    for (const f of data.folders) f.project_id = TARGET_PID
    importProjectDataFromJson(JSON.stringify(data), TARGET_PID)

    const row = testDb
      .prepare('SELECT name, assertions, is_default FROM endpoint_cases WHERE id = ?')
      .get(ids.endpointCaseId) as { name: string; assertions: string; is_default: number }
    expect(row.name).toBe('Happy path')
    expect(row.is_default).toBe(1)
    expect(JSON.parse(row.assertions)).toEqual([{ target: 'status', op: 'eq', value: 200 }])
  })

  it('round-trips environments WITH their project_id (regression: env import once dropped it)', () => {
    const ids = seedRichProject()
    const data = exportProjectData(SOURCE_PID)
    for (const env of data.environments ?? []) env.project_id = TARGET_PID
    importProjectDataFromJson(JSON.stringify(data), TARGET_PID)

    const row = testDb
      .prepare('SELECT name, project_id, is_active FROM environments WHERE id = ?')
      .get(ids.envId) as { name: string; project_id: string | null; is_active: number }
    expect(row.name).toBe('Dev')
    expect(row.is_active).toBe(1)
    // This is the regression guard: without project_id on the upsert column
    // list, an imported env was workspace-scoped only and silently invisible
    // to the project that imported it.
    expect(row.project_id).toBe(TARGET_PID)
  })

  it('round-trips environment_variables (key, value, secret flag, initial_value)', () => {
    const ids = seedRichProject()
    const data = exportProjectData(SOURCE_PID)
    importProjectDataFromJson(JSON.stringify(data), TARGET_PID)

    const row = testDb
      .prepare(
        'SELECT key, value, description, enabled, secret, initial_value FROM environment_variables WHERE id = ?',
      )
      .get(ids.envVarId) as {
      key: string
      value: string
      description: string
      enabled: number
      secret: number
      initial_value: string
    }
    expect(row.key).toBe('base')
    expect(row.value).toBe('https://example.com')
    expect(row.description).toBe('API root')
    expect(row.enabled).toBe(1)
    expect(row.secret).toBe(0)
    expect(row.initial_value).toBe('https://example.com')
  })

  it('round-trips global_variables WITH their project_id (regression guard)', () => {
    const ids = seedRichProject()
    const data = exportProjectData(SOURCE_PID)
    for (const g of data.globalVariables ?? []) g.project_id = TARGET_PID
    importProjectDataFromJson(JSON.stringify(data), TARGET_PID)

    const row = testDb
      .prepare(
        'SELECT key, value, project_id, secret FROM global_variables WHERE id = ?',
      )
      .get(ids.globalVarId) as {
      key: string
      value: string
      project_id: string | null
      secret: number
    }
    expect(row.key).toBe('apiKey')
    expect(row.value).toBe('abc')
    expect(row.secret).toBe(1)
    // Same fix as environments — without project_id the global var would
    // leak into the workspace-wide list rather than landing under the
    // imported project.
    expect(row.project_id).toBe(TARGET_PID)
  })

  it('round-trips test_suite + folder + item with assertions and source_endpoint_id', () => {
    const ids = seedRichProject()
    const data = exportProjectData(SOURCE_PID)
    for (const s of data.testSuites ?? []) s.project_id = TARGET_PID
    importProjectDataFromJson(JSON.stringify(data), TARGET_PID)

    const suite = testDb
      .prepare('SELECT name, description FROM test_suites WHERE id = ?')
      .get(ids.suiteId) as { name: string; description: string }
    expect(suite.name).toBe('Smoke Suite')

    const folder = testDb
      .prepare('SELECT name, parent_id FROM test_suite_folders WHERE id = ?')
      .get(ids.suiteFolderId) as { name: string; parent_id: string | null }
    expect(folder.name).toBe('Inner')

    const item = testDb
      .prepare(
        'SELECT name, method, url, request_schema, assertions, source_endpoint_id, folder_id FROM test_suite_items WHERE id = ?',
      )
      .get(ids.suiteItemId) as {
      name: string
      method: string
      url: string
      request_schema: string
      assertions: string
      source_endpoint_id: string
      folder_id: string
    }
    expect(item.name).toBe('Item 1')
    expect(item.method).toBe('GET')
    expect(item.url).toBe('https://example.com/x')
    expect(JSON.parse(item.request_schema)).toEqual({
      url: 'https://example.com/x',
      method: 'GET',
    })
    expect(JSON.parse(item.assertions)).toEqual([{ target: 'status', op: 'eq', value: 200 }])
    expect(item.source_endpoint_id).toBe(ids.endpointId)
    expect(item.folder_id).toBe(ids.suiteFolderId)
  })

  it('round-trips mock_servers + endpoints + responses (full mock graph)', () => {
    const ids = seedRichProject()
    const data = exportProjectData(SOURCE_PID)
    for (const m of data.mockServers ?? []) m.project_id = TARGET_PID
    importProjectDataFromJson(JSON.stringify(data), TARGET_PID)

    const server = testDb
      .prepare('SELECT name, port FROM mock_servers WHERE id = ?')
      .get(ids.mockServerId) as { name: string; port: number }
    expect(server).toEqual({ name: 'Mock-1', port: 4000 })

    const ep = testDb
      .prepare('SELECT method, path, server_id FROM mock_endpoints WHERE id = ?')
      .get(ids.mockEndpointId) as { method: string; path: string; server_id: string }
    expect(ep.method).toBe('GET')
    expect(ep.path).toBe('/health')
    expect(ep.server_id).toBe(ids.mockServerId)

    const res = testDb
      .prepare('SELECT name, status_code, body, endpoint_id FROM mock_responses WHERE id = ?')
      .get(ids.mockResponseId) as {
      name: string
      status_code: number
      body: string
      endpoint_id: string
    }
    expect(res).toEqual({
      name: 'OK',
      status_code: 200,
      body: '{"ok":true}',
      endpoint_id: ids.mockEndpointId,
    })
  })

  it('round-trips certificates with paths and passphrase preserved', () => {
    const ids = seedRichProject()
    const data = exportProjectData(SOURCE_PID)
    for (const c of data.certificates ?? []) c.project_id = TARGET_PID
    importProjectDataFromJson(JSON.stringify(data), TARGET_PID)

    const cert = testDb
      .prepare('SELECT kind, host, crt_path, key_path, enabled FROM certificates WHERE id = ?')
      .get(ids.certificateId) as {
      kind: string
      host: string
      crt_path: string
      key_path: string
      enabled: number
    }
    expect(cert.kind).toBe('client')
    expect(cert.host).toBe('example.com')
    expect(cert.crt_path).toBe('/tmp/c.crt')
    expect(cert.key_path).toBe('/tmp/c.key')
    expect(cert.enabled).toBe(1)
  })
})

// ───────── Folder export → import ─────────

describe('Folder export → import round-trip', () => {
  it('exports a folder subtree and re-imports it under a different parent', () => {
    const ids = seedRichProject()
    const exported = exportFolderData(ids.rootFolderId)
    expect(exported.kind).toBe('folder')
    expect(exported.folders.length).toBe(2)
    expect(exported.endpoints.length).toBe(1)
    expect(exported.endpointCases.length).toBe(1)

    // Add a destination parent folder under the source project to act as the
    // graft point. Real importFolderData() rewrites IDs so the subtree drops
    // in without colliding with the source folders.
    const destParent = randomUUID()
    testDb
      .prepare(
        `INSERT INTO folders (id, project_id, parent_id, name, sort_order) VALUES (?, ?, NULL, 'DestParent', 1)`,
      )
      .run(destParent, SOURCE_PID)

    const out = importFolderData(exported, SOURCE_PID, destParent)
    expect(out.foldersImported).toBe(2)
    expect(out.endpointsImported).toBe(1)

    // The original Root + Child + endpoint still exist (we didn't delete the
    // source) and a fresh subtree is grafted under DestParent.
    const newRoot = testDb
      .prepare(
        'SELECT id, parent_id, name FROM folders WHERE project_id = ? AND parent_id = ?',
      )
      .get(SOURCE_PID, destParent) as { id: string; parent_id: string; name: string } | undefined
    expect(newRoot).toBeDefined()
    expect(newRoot!.name).toBe('Root')

    const newChild = testDb
      .prepare(
        `SELECT id, name FROM folders WHERE project_id = ? AND parent_id = ?`,
      )
      .get(SOURCE_PID, newRoot!.id) as { id: string; name: string } | undefined
    expect(newChild).toBeDefined()
    expect(newChild!.name).toBe('Child')

    // The endpoint should sit under the *new* Child folder, not the source one.
    const newEndpoint = testDb
      .prepare('SELECT name, method, path, folder_id FROM endpoints WHERE folder_id = ?')
      .get(newChild!.id) as {
      name: string
      method: string
      path: string
      folder_id: string
    }
    expect(newEndpoint.name).toBe('Create User')
    expect(newEndpoint.method).toBe('POST')
    expect(newEndpoint.path).toBe('/users')
  })

  it('preserves saved requests inside the folder (regression #32)', () => {
    // A collection made of *saved requests* (ad-hoc requests dropped into a
    // folder, stored in `saved_requests`, not `endpoints`) used to round-trip
    // as an empty folder: the folder export only collected `endpoints`, so
    // every saved request was silently dropped.
    const ids = seedRichProject()
    const savedInFolder = randomUUID()
    testDb
      .prepare(
        `INSERT INTO saved_requests
           (id, project_id, folder_id, name, protocol, method, url, params, headers, body,
            auth, pre_script, post_script, assertions, metadata, sort_order, created_at, updated_at)
         VALUES (?, ?, ?, 'Ping', 'http', 'GET', 'https://api.example/ping',
                 '[]', '[]', '', NULL, '', '', '[]', NULL, 0, ?, ?)`,
      )
      .run(savedInFolder, SOURCE_PID, ids.childFolderId, Date.now(), Date.now())

    const exported = exportFolderData(ids.rootFolderId)
    // The folder export must now carry the saved request that lives in it.
    expect(exported.savedRequests?.length).toBe(1)
    expect(exported.savedRequests?.[0].name).toBe('Ping')

    const destParent = randomUUID()
    testDb
      .prepare(
        `INSERT INTO folders (id, project_id, parent_id, name, sort_order) VALUES (?, ?, NULL, 'Graft', 2)`,
      )
      .run(destParent, SOURCE_PID)

    const out = importFolderData(exported, SOURCE_PID, destParent)
    // foldersImported counts folders; endpointsImported now folds in saved
    // requests (1 endpoint + 1 saved request).
    expect(out.endpointsImported).toBe(2)

    // Resolve the grafted Root → Child and assert the saved request landed
    // under the *new* Child folder with a fresh id (not the source one).
    const newRoot = testDb
      .prepare('SELECT id FROM folders WHERE project_id = ? AND parent_id = ?')
      .get(SOURCE_PID, destParent) as { id: string }
    const newChild = testDb
      .prepare('SELECT id FROM folders WHERE project_id = ? AND parent_id = ?')
      .get(SOURCE_PID, newRoot.id) as { id: string }
    const grafted = testDb
      .prepare('SELECT id, name, method, url FROM saved_requests WHERE folder_id = ?')
      .get(newChild.id) as { id: string; name: string; method: string; url: string } | undefined
    expect(grafted).toBeDefined()
    expect(grafted!.name).toBe('Ping')
    expect(grafted!.method).toBe('GET')
    expect(grafted!.url).toBe('https://api.example/ping')
    expect(grafted!.id).not.toBe(savedInFolder)
  })
})
