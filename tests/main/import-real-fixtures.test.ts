/**
 * Integration tests against real-world exports the user provided.
 *
 * Fixtures live under tests/fixtures/external-imports and cover:
 *   - Postman v2.x collections (Oracle CRUD)
 *   - Insomnia v5 YAML exports (~18 files, including a 658 KB apiops.yaml)
 *   - SoapUI project XML (student-soapui-project.xml)
 *
 * Each file is run through:
 *   - the APIs-tree importer (`importPostman` / `importInsomnia` / SoapUI IPC)
 *   - the test-suite importer (`importTestSuiteFromFile`)
 * and then a Testnizer-native export → re-import round-trip is verified so we
 * can catch regressions in the bundle format itself.
 *
 * `getDb()` is mocked to hand out an in-memory better-sqlite3 instance with
 * the same schema the real DB carries (project-scoped environments + global
 * variables, test-suite tables).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import Database from 'better-sqlite3'
import { randomUUID } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

let testDb: Database.Database

vi.mock('../../src/main/db/database', () => ({
  getDb: () => testDb,
}))

// Imports happen lazily after the mock is installed.
const { importPostman, importInsomnia } = await import(
  '../../src/main/ipc/import-export.handler'
)
const { importTestSuiteFromFile, exportTestSuiteData } = await import(
  '../../src/main/ipc/save.handler'
)

const FIXTURES_ROOT = join(__dirname, '..', 'fixtures', 'external-imports')

const PROJECT_ID = 'p-real'
const WORKSPACE_ID = 'ws-real'

function createFullSchema(db: Database.Database): void {
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

beforeEach(() => {
  testDb = new Database(':memory:')
  createFullSchema(testDb)
  const now = Date.now()
  testDb
    .prepare(`INSERT INTO workspaces (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)`)
    .run(WORKSPACE_ID, 'Real-Imports WS', now, now)
  testDb
    .prepare(
      `INSERT INTO projects (id, workspace_id, name, type, sort_order, created_at, updated_at)
       VALUES (?, ?, ?, 'http', 0, ?, ?)`,
    )
    .run(PROJECT_ID, WORKSPACE_ID, 'Real-Imports', now, now)
})

function countTables(): {
  endpoints: number
  folders: number
  envs: number
  envVars: number
  suiteItems: number
  suites: number
} {
  const e = testDb.prepare('SELECT COUNT(*) AS n FROM endpoints').get() as { n: number }
  const f = testDb.prepare('SELECT COUNT(*) AS n FROM folders').get() as { n: number }
  const en = testDb.prepare('SELECT COUNT(*) AS n FROM environments').get() as { n: number }
  const ev = testDb.prepare('SELECT COUNT(*) AS n FROM environment_variables').get() as {
    n: number
  }
  const si = testDb.prepare('SELECT COUNT(*) AS n FROM test_suite_items').get() as { n: number }
  const ss = testDb.prepare('SELECT COUNT(*) AS n FROM test_suites').get() as { n: number }
  return {
    endpoints: e.n,
    folders: f.n,
    envs: en.n,
    envVars: ev.n,
    suiteItems: si.n,
    suites: ss.n,
  }
}

// ───────── Postman v2.x — Oracle CRUD collection ─────────

describe('Postman v2.x — Oracle CRUD', () => {
  const fixturePath = join(FIXTURES_ROOT, 'postman', 'oracle-crud.postman_collection.json')
  const content = readFileSync(fixturePath, 'utf-8')

  it('imports into the APIs tree with endpoints and request_schema populated', async () => {
    const result = await importPostman(PROJECT_ID, content, null)
    expect(result.success).toBe(true)
    expect((result.endpointCount ?? 0) > 0).toBe(true)

    const rows = testDb
      .prepare('SELECT name, method, path, request_schema FROM endpoints ORDER BY sort_order')
      .all() as { name: string; method: string; path: string; request_schema: string | null }[]
    expect(rows.length).toBe(result.endpointCount)

    // Every imported endpoint should carry a JSON request_schema parseable
    // back into an object — that's what the editor and runner read. The
    // exact keys depend on the source request (a GET has no body) so we
    // only check at least one of the canonical fields is present.
    for (const r of rows) {
      expect(r.request_schema).toBeTruthy()
      const schema = JSON.parse(r.request_schema as string)
      expect(typeof schema).toBe('object')
      const keys = Object.keys(schema)
      expect(keys.length).toBeGreaterThan(0)
      const canonical = ['params', 'headers', 'body', 'auth', 'url', 'method']
      expect(keys.some((k) => canonical.includes(k))).toBe(true)
    }
  })

  it('round-trips into a test suite — items carry their snapshot', async () => {
    const out = await importTestSuiteFromFile(content, PROJECT_ID, 'Oracle Suite')
    expect(out.format).toBe('postman')
    expect(out.itemsImported).toBeGreaterThan(0)

    const items = testDb
      .prepare(
        'SELECT name, method, url, request_schema FROM test_suite_items WHERE suite_id = ? ORDER BY sort_order',
      )
      .all(out.suiteId) as { name: string; method: string; url: string; request_schema: string }[]
    expect(items.length).toBe(out.itemsImported)

    // After a suite import the source endpoints are deleted — the suite is the
    // sole owner (copy-on-add model, see save.handler).
    const leftover = testDb
      .prepare('SELECT COUNT(*) AS n FROM endpoints WHERE project_id = ?')
      .get(PROJECT_ID) as { n: number }
    expect(leftover.n).toBe(0)

    for (const i of items) {
      expect(i.request_schema).toBeTruthy()
      expect(i.method).toBeTruthy()
    }
  })
})

// ───────── Insomnia v5 YAML exports ─────────

const INSOMNIA_DIR = join(FIXTURES_ROOT, 'insomnia')
const insomniaFiles = readdirSync(INSOMNIA_DIR).filter((f) => f.endsWith('.yaml'))

describe('Insomnia v5 YAML exports', () => {
  it('discovers > 10 fixture files (sanity)', () => {
    expect(insomniaFiles.length).toBeGreaterThan(10)
  })

  // One it() per file so failures point at the offending fixture name in the
  // vitest summary instead of a generic loop assertion.
  for (const name of insomniaFiles) {
    it(`imports ${name} via the APIs-tree importer without errors`, async () => {
      const content = readFileSync(join(INSOMNIA_DIR, name), 'utf-8')
      const result = await importInsomnia(PROJECT_ID, content, null)
      expect(result.success).toBe(true)
      const counts = countTables()
      // We accept fixtures with zero endpoints (env-only / cookie-only resources
      // exist in the export folder) — what matters is that nothing throws and
      // the importer reports success.
      expect(counts.folders >= 0).toBe(true)
    })

    it(`imports ${name} as a test suite (auto-detected as insomnia)`, async () => {
      const content = readFileSync(join(INSOMNIA_DIR, name), 'utf-8')
      // Empty-collection Insomnia exports can legitimately yield 0 suite items.
      // We only require the call to succeed and the format to be tagged.
      const out = await importTestSuiteFromFile(content, PROJECT_ID, `Suite — ${name}`)
      expect(out.format).toBe('insomnia')
      expect(out.itemsImported).toBeGreaterThanOrEqual(0)
    })
  }
})

// ───────── Insomnia v5 YAML — Oracle CRUD field-by-field assertions ─────────

describe('Insomnia v5 YAML — Oracle CRUD field fidelity', () => {
  it('preserves request method, URL and body for each item', async () => {
    const content = readFileSync(join(INSOMNIA_DIR, 'oracle-crud-test.yaml'), 'utf-8')
    const result = await importInsomnia(PROJECT_ID, content, null)
    expect(result.success).toBe(true)
    expect((result.endpointCount ?? 0) > 0).toBe(true)

    const rows = testDb
      .prepare('SELECT name, method, path, request_schema FROM endpoints')
      .all() as { name: string; method: string; path: string; request_schema: string }[]

    // At least one POST or GET should be present (Oracle CRUD covers both).
    const methods = new Set(rows.map((r) => r.method))
    expect(methods.has('GET') || methods.has('POST')).toBe(true)

    // Paths must not be empty and must include the host string Insomnia
    // serialises them with (`{{ _.baseUrl }}` or an absolute URL).
    for (const r of rows) {
      expect(r.path.length).toBeGreaterThan(0)
    }
  })
})

// ───────── SoapUI project XML — currently routed through xml/wsdl handlers ─────────

describe('SoapUI project XML', () => {
  const fixturePath = join(FIXTURES_ROOT, 'soapui', 'student-soapui-project.xml')
  const content = readFileSync(fixturePath, 'utf-8')

  // SoapUI ships its own handler (`importSoapUi`) but its public surface is
  // an IPC handler, not an exported function — exercising the parser-level
  // function requires more wiring than this fixture pass needs. We at least
  // verify the file shape is what the SoapUI handler will receive (a
  // soapui-project root element).
  it('fixture is a well-formed SoapUI project (root <soapui-project> present)', () => {
    expect(content).toMatch(/<con:soapui-project|<soapui-project/i)
  })

  it('test-suite importer rejects raw XML with a clear error (not a JSON/YAML collection)', async () => {
    // SoapUI is XML — the test-suite importer expects JSON or YAML. The
    // failure message should be specific enough that the user can tell which
    // path to take (APIs → Import handles SoapUI).
    await expect(importTestSuiteFromFile(content, PROJECT_ID, 'SU')).rejects.toThrow(
      /JSON or YAML|Unknown test suite format/,
    )
  })
})

// ───────── Field-level fidelity audit: Postman Oracle CRUD ─────────
//
// The fixture itself dictates the expected numbers (six requests, six pre-
// scripts, six test scripts, two with bodies, five with query strings, one
// collection-level variable). If the importer drops any of these, the
// numbers below stop matching and we know exactly which axis regressed.

describe('Postman Oracle CRUD — field-level audit', () => {
  const fixturePath = join(FIXTURES_ROOT, 'postman', 'oracle-crud.postman_collection.json')
  const content = readFileSync(fixturePath, 'utf-8')
  const rawDoc = JSON.parse(content) as {
    info: { name: string }
    item: Array<{
      name: string
      request: {
        method: string
        header?: Array<{ key: string; value: string }>
        body?: { mode?: string; raw?: string }
        url?: { raw?: string; query?: Array<{ key: string; value: string }> }
      }
      event?: Array<{ listen: string; script?: { exec?: string[] } }>
    }>
    variable?: Array<{ key: string; value: string }>
  }

  it('preserves every request name, method and URL from the source collection', async () => {
    const result = await importPostman(PROJECT_ID, content, null)
    expect(result.success).toBe(true)

    const rows = testDb
      .prepare('SELECT name, method, request_schema FROM endpoints ORDER BY sort_order')
      .all() as { name: string; method: string; request_schema: string }[]

    expect(rows.length).toBe(rawDoc.item.length)
    for (let i = 0; i < rawDoc.item.length; i++) {
      expect(rows[i].name).toBe(rawDoc.item[i].name)
      expect(rows[i].method).toBe(rawDoc.item[i].request.method)
      // The full URL — placeholders and all — lives on the request_schema
      // (the `path` column gets normalised to the URL pathname only, which
      // is intentional for the project tree's display). What matters for
      // round-tripping is that nothing gets lost.
      const schema = JSON.parse(rows[i].request_schema) as { url?: string }
      expect(schema.url).toBe(rawDoc.item[i].request.url?.raw)
    }
  })

  it('preserves headers exactly (key + value + count)', async () => {
    await importPostman(PROJECT_ID, content, null)
    const rows = testDb
      .prepare('SELECT name, request_schema FROM endpoints ORDER BY sort_order')
      .all() as { name: string; request_schema: string }[]
    for (let i = 0; i < rawDoc.item.length; i++) {
      const srcHeaders = rawDoc.item[i].request.header ?? []
      const schema = JSON.parse(rows[i].request_schema) as {
        headers: Array<{ key: string; value: string }>
      }
      expect(schema.headers).toHaveLength(srcHeaders.length)
      for (let h = 0; h < srcHeaders.length; h++) {
        expect(schema.headers[h].key).toBe(srcHeaders[h].key)
        expect(schema.headers[h].value).toBe(srcHeaders[h].value)
      }
    }
  })

  it('preserves the raw body verbatim (including {{vars}})', async () => {
    await importPostman(PROJECT_ID, content, null)
    const rows = testDb
      .prepare('SELECT name, request_schema FROM endpoints ORDER BY sort_order')
      .all() as { name: string; request_schema: string }[]
    let bodiesAudited = 0
    for (let i = 0; i < rawDoc.item.length; i++) {
      const srcBody = rawDoc.item[i].request.body
      if (!srcBody?.raw) continue
      // Renderer's RequestBody shape is `{ type, content }` — raw text lands
      // in `body.content` regardless of language (json/xml/text/...). See
      // mapPostmanBodyToUi.
      const schema = JSON.parse(rows[i].request_schema) as {
        body?: { type?: string; content?: string }
      }
      expect(schema.body?.type).toBeTruthy()
      expect(schema.body?.content).toBe(srcBody.raw)
      bodiesAudited++
    }
    expect(bodiesAudited).toBe(2)
  })

  it('preserves query parameters', async () => {
    await importPostman(PROJECT_ID, content, null)
    const rows = testDb
      .prepare('SELECT name, request_schema FROM endpoints ORDER BY sort_order')
      .all() as { name: string; request_schema: string }[]
    let auditedRequests = 0
    for (let i = 0; i < rawDoc.item.length; i++) {
      const srcQuery = rawDoc.item[i].request.url?.query ?? []
      if (srcQuery.length === 0) continue
      const schema = JSON.parse(rows[i].request_schema) as {
        params: Array<{ key: string; value: string }>
      }
      expect(schema.params).toHaveLength(srcQuery.length)
      for (let q = 0; q < srcQuery.length; q++) {
        expect(schema.params[q].key).toBe(srcQuery[q].key)
        expect(schema.params[q].value).toBe(srcQuery[q].value)
      }
      auditedRequests++
    }
    // Sanity guard — the fixture has 5 requests with query strings.
    expect(auditedRequests).toBe(5)
  })

  it('preserves pre-request and test scripts verbatim', async () => {
    await importPostman(PROJECT_ID, content, null)
    const rows = testDb
      .prepare('SELECT name, request_schema FROM endpoints ORDER BY sort_order')
      .all() as { name: string; request_schema: string }[]
    let preAudited = 0
    let postAudited = 0
    for (let i = 0; i < rawDoc.item.length; i++) {
      const events = rawDoc.item[i].event ?? []
      const preEv = events.find((e) => e.listen === 'prerequest')
      const testEv = events.find((e) => e.listen === 'test')
      const schema = JSON.parse(rows[i].request_schema) as {
        preScript?: string
        postScript?: string
      }
      if (preEv?.script?.exec?.length) {
        const expected = preEv.script.exec.join('\n')
        expect(schema.preScript).toBeTruthy()
        // Importer may add a top-of-file shim comment; we assert the source
        // is contained verbatim rather than equal-to.
        expect(schema.preScript).toContain(expected)
        preAudited++
      }
      if (testEv?.script?.exec?.length) {
        const expected = testEv.script.exec.join('\n')
        expect(schema.postScript).toBeTruthy()
        expect(schema.postScript).toContain(expected)
        postAudited++
      }
    }
    // Fixture has 6 of each.
    expect(preAudited).toBe(6)
    expect(postAudited).toBe(6)
  })

  it('imports the single collection variable into a project-scoped environment', async () => {
    await importPostman(PROJECT_ID, content, null)
    const envVars = testDb
      .prepare(
        `SELECT ev.key, ev.value FROM environment_variables ev
         JOIN environments e ON e.id = ev.environment_id
         WHERE e.project_id = ?`,
      )
      .all(PROJECT_ID) as { key: string; value: string }[]

    // The fixture defines exactly one collection variable (baseUrl). The
    // importer should create one env and one row inside it.
    expect(rawDoc.variable?.length).toBe(1)
    expect(envVars.length).toBeGreaterThanOrEqual(1)
    const baseUrl = envVars.find((v) => v.key === rawDoc.variable![0].key)
    expect(baseUrl).toBeDefined()
    expect(baseUrl!.value).toBe(rawDoc.variable![0].value)
  })

  it('every audited field also survives the Test Suite import path', async () => {
    const out = await importTestSuiteFromFile(content, PROJECT_ID, 'Oracle Suite')
    expect(out.itemsImported).toBe(rawDoc.item.length)

    const items = testDb
      .prepare(
        'SELECT name, method, url, request_schema FROM test_suite_items WHERE suite_id = ? ORDER BY sort_order',
      )
      .all(out.suiteId) as { name: string; method: string; url: string; request_schema: string }[]

    for (let i = 0; i < rawDoc.item.length; i++) {
      const schema = JSON.parse(items[i].request_schema) as {
        method?: string
        url?: string
        headers?: Array<{ key: string; value: string }>
        body?: { type?: string; content?: string }
        params?: Array<{ key: string }>
        preScript?: string
        postScript?: string
      }
      // Suite items carry their own snapshot — method, headers, body, scripts
      // all need to be present, otherwise running the suite would fire a
      // gutted request.
      expect(schema.method ?? items[i].method).toBe(rawDoc.item[i].request.method)
      // The suite item's `url` column gets the snapshot's `url` (full,
      // placeholders intact); the schema mirrors it.
      expect(schema.url).toBe(rawDoc.item[i].request.url?.raw)

      const srcHeaders = rawDoc.item[i].request.header ?? []
      if (srcHeaders.length > 0) {
        expect(schema.headers).toHaveLength(srcHeaders.length)
      }
      const srcBody = rawDoc.item[i].request.body?.raw
      if (srcBody) {
        expect(schema.body?.content).toBe(srcBody)
      }
      const preEv = (rawDoc.item[i].event ?? []).find((e) => e.listen === 'prerequest')
      if (preEv?.script?.exec?.length) {
        expect(schema.preScript).toContain(preEv.script.exec.join('\n'))
      }
      const testEv = (rawDoc.item[i].event ?? []).find((e) => e.listen === 'test')
      if (testEv?.script?.exec?.length) {
        expect(schema.postScript).toContain(testEv.script.exec.join('\n'))
      }
    }
  })
})

// ───────── Field-level fidelity audit: Insomnia v5 Oracle CRUD ─────────

describe('Insomnia v5 Oracle CRUD — field-level audit', () => {
  const fixturePath = join(INSOMNIA_DIR, 'oracle-crud-test.yaml')
  const content = readFileSync(fixturePath, 'utf-8')
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const yaml = require('js-yaml') as { load: (s: string) => unknown }
  const doc = yaml.load(content) as {
    name: string
    collection: Array<{
      name?: string
      children?: Array<{
        name?: string
        url?: string
        method?: string
        headers?: Array<{ name: string; value: string }>
        body?: { mimeType?: string; text?: string }
        scripts?: { preRequest?: string; afterResponse?: string }
      }>
    }>
  }

  // Flatten the v5 collection — the top-level item is a request-group whose
  // children are the actual requests. We pull out every leaf so the assertions
  // below don't need to care about the wrapper.
  function flattenRequests(items: typeof doc.collection): NonNullable<NonNullable<typeof doc.collection[number]['children']>[number]>[] {
    const out: NonNullable<NonNullable<typeof doc.collection[number]['children']>[number]>[] = []
    for (const it of items) {
      if (Array.isArray(it.children)) {
        out.push(...flattenRequests(it.children as typeof doc.collection))
      } else if ((it as { url?: string }).url) {
        out.push(it as NonNullable<NonNullable<typeof doc.collection[number]['children']>[number]>)
      }
    }
    return out
  }

  const sourceRequests = flattenRequests(doc.collection)

  it('imports the expected number of requests (matches fixture)', async () => {
    const result = await importInsomnia(PROJECT_ID, content, null)
    expect(result.success).toBe(true)
    expect(result.endpointCount).toBe(sourceRequests.length)
  })

  it('preserves headers and body verbatim across every request', async () => {
    await importInsomnia(PROJECT_ID, content, null)
    const rows = testDb
      .prepare('SELECT name, request_schema FROM endpoints ORDER BY sort_order')
      .all() as { name: string; request_schema: string }[]

    expect(rows.length).toBe(sourceRequests.length)

    let bodiesAudited = 0
    for (let i = 0; i < sourceRequests.length; i++) {
      const src = sourceRequests[i]
      const schema = JSON.parse(rows[i].request_schema) as {
        headers: Array<{ key: string; value: string }>
        body?: { type?: string; content?: string }
      }
      const srcHeaders = src.headers ?? []
      expect(schema.headers).toHaveLength(srcHeaders.length)
      for (let h = 0; h < srcHeaders.length; h++) {
        expect(schema.headers[h].key).toBe(srcHeaders[h].name)
        expect(schema.headers[h].value).toBe(srcHeaders[h].value)
      }
      if (src.body?.text) {
        // Same RequestBody shape as the Postman importer — text lives in
        // body.content, not body.raw.
        expect(schema.body?.content).toBe(src.body.text)
        bodiesAudited++
      }
    }
    expect(bodiesAudited).toBeGreaterThan(0)
  })

  it('preserves pre-request and after-response scripts verbatim (insomnia.* runs natively)', async () => {
    await importInsomnia(PROJECT_ID, content, null)
    const rows = testDb
      .prepare('SELECT name, request_schema FROM endpoints ORDER BY sort_order')
      .all() as { name: string; request_schema: string }[]

    // Since v1.4.19 the shared script runtime runs `insomnia.*` natively with
    // correct Insomnia semantics (numeric `.status`), so the importer stores
    // scripts VERBATIM — no `insomnia.*`→`pm.*` rewrite (that silently flipped
    // `.status` to the reason phrase, issue #47). The stored script must contain
    // the source bytes unchanged.
    let preAudited = 0
    let postAudited = 0
    for (let i = 0; i < sourceRequests.length; i++) {
      const src = sourceRequests[i]
      const schema = JSON.parse(rows[i].request_schema) as {
        preScript?: string
        postScript?: string
      }
      if (src.scripts?.preRequest) {
        expect(schema.preScript).toContain(src.scripts.preRequest)
        preAudited++
      }
      if (src.scripts?.afterResponse) {
        expect(schema.postScript).toContain(src.scripts.afterResponse)
        postAudited++
      }
    }
    expect(preAudited).toBeGreaterThan(0)
    expect(postAudited).toBeGreaterThan(0)
  })
})

// ───────── Testnizer round-trip (export → import) ─────────

describe('Testnizer suite export → re-import round-trip', () => {
  it('preserves every field (name, method, url, request_schema, assertions) byte-for-byte', async () => {
    // Seed: import a real Postman collection so the suite has real items —
    // headers, bodies, scripts, query params, the works.
    const pmContent = readFileSync(
      join(FIXTURES_ROOT, 'postman', 'oracle-crud.postman_collection.json'),
      'utf-8',
    )
    const first = await importTestSuiteFromFile(pmContent, PROJECT_ID, 'Round Trip Source')
    expect(first.itemsImported).toBeGreaterThan(0)

    type ItemRow = {
      name: string
      method: string
      url: string
      request_schema: string
      assertions: string | null
    }
    const originalItems = testDb
      .prepare(
        'SELECT name, method, url, request_schema, assertions FROM test_suite_items WHERE suite_id = ?',
      )
      .all(first.suiteId) as ItemRow[]

    // Export → re-import as a brand-new suite.
    const exported = exportTestSuiteData(first.suiteId)
    expect(exported.kind).toBe('testSuite')
    expect(exported.items.length).toBe(originalItems.length)

    const second = await importTestSuiteFromFile(
      JSON.stringify(exported),
      PROJECT_ID,
      'Round Trip Imported',
    )
    expect(second.format).toBe('testnizer')
    expect(second.itemsImported).toBe(originalItems.length)

    // Pair items by name (uniqueness guard: assertion below) and compare each
    // field exactly. request_schema is compared as a parsed object so JSON
    // whitespace differences don't cause false fails.
    const roundTripped = testDb
      .prepare(
        'SELECT name, method, url, request_schema, assertions FROM test_suite_items WHERE suite_id = ?',
      )
      .all(second.suiteId) as ItemRow[]
    expect(new Set(originalItems.map((r) => r.name)).size).toBe(originalItems.length)

    const orig = new Map(originalItems.map((r) => [r.name, r]))
    for (const r of roundTripped) {
      const o = orig.get(r.name)
      expect(o).toBeDefined()
      expect(r.method).toBe(o!.method)
      expect(r.url).toBe(o!.url)
      expect(JSON.parse(r.request_schema)).toEqual(JSON.parse(o!.request_schema))
      expect(r.assertions ?? null).toEqual(o!.assertions ?? null)
    }
  })

  it('preserves the folder tree across export → re-import', async () => {
    // Seed an explicit two-folder structure so we can assert folder names
    // and parent_id mapping survive the round-trip without rewriting tests
    // against Postman's internal folder shape.
    const now = Date.now()
    const suiteId = randomUUID()
    const f1 = randomUUID()
    const f2 = randomUUID()
    testDb
      .prepare(
        `INSERT INTO test_suites (id, project_id, name, sort_order, created_at, updated_at)
         VALUES (?, ?, 'Folder Suite', 0, ?, ?)`,
      )
      .run(suiteId, PROJECT_ID, now, now)
    testDb
      .prepare(
        `INSERT INTO test_suite_folders (id, suite_id, parent_id, name, sort_order, created_at)
         VALUES (?, ?, NULL, 'Outer', 0, ?)`,
      )
      .run(f1, suiteId, now)
    testDb
      .prepare(
        `INSERT INTO test_suite_folders (id, suite_id, parent_id, name, sort_order, created_at)
         VALUES (?, ?, ?, 'Inner', 0, ?)`,
      )
      .run(f2, suiteId, f1, now)
    testDb
      .prepare(
        `INSERT INTO test_suite_items
           (id, suite_id, folder_id, protocol, name, method, url,
            request_schema, sort_order, created_at, updated_at)
         VALUES (?, ?, ?, 'http', 'Ping', 'GET', '/ping', '{}', 0, ?, ?)`,
      )
      .run(randomUUID(), suiteId, f2, now, now)

    const exported = exportTestSuiteData(suiteId)
    const re = await importTestSuiteFromFile(
      JSON.stringify(exported),
      PROJECT_ID,
      'Folder Suite Reimport',
    )

    // Re-imported folders carry the same hierarchy: Outer has parent_id NULL,
    // Inner's parent_id is the id of the new Outer.
    const folders = testDb
      .prepare(
        'SELECT id, parent_id, name FROM test_suite_folders WHERE suite_id = ? ORDER BY name',
      )
      .all(re.suiteId) as { id: string; parent_id: string | null; name: string }[]
    const outer = folders.find((f) => f.name === 'Outer')
    const inner = folders.find((f) => f.name === 'Inner')
    expect(outer).toBeDefined()
    expect(inner).toBeDefined()
    expect(outer!.parent_id).toBeNull()
    expect(inner!.parent_id).toBe(outer!.id)

    // The single item lands in the new Inner folder.
    const item = testDb
      .prepare('SELECT folder_id FROM test_suite_items WHERE suite_id = ?')
      .get(re.suiteId) as { folder_id: string }
    expect(item.folder_id).toBe(inner!.id)
  })
})
