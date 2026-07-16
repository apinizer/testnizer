/**
 * Apinizer ↔ Testnizer test interop — `x-apinizer` extension read/write.
 *
 * Verifies the fidelity layer described in
 * md_files/testnizer-interop/{00-shared-contract,testnizer-side-plan}.md:
 *
 *  - IMPORT (`importPostman`): an Apinizer collection carrying `x-apinizer`
 *    yields native Testnizer assertions (4 kinds) + recovered raw-body sub-type
 *    + timeout. A collection WITHOUT the key still imports as plain Postman.
 *  - EXPORT (`buildPostmanCollection` via project/suite export): Testnizer
 *    assertions round-trip into `x-apinizer.assertions[]`; Testnizer-only
 *    assertion types are dropped from the extension (kept in Testnizer's own
 *    channel). Pure requests (no assertions) get no `x-apinizer` at all.
 *  - ROUND-TRIP: Apinizer fixture → import → export preserves the 4 kinds.
 *
 * Driven against a real schema-loaded better-sqlite3 instance (same harness as
 * export-suite.test.ts) so every production migration/column is present.
 */

import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest'
import { mkdtempSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

const tmpDir = mkdtempSync(path.join(os.tmpdir(), 'testnizer-apinizer-'))

vi.mock('electron', () => ({
  app: { getPath: (_: string): string => tmpDir },
  ipcMain: { handle: (): void => {} },
  dialog: {},
  safeStorage: { isEncryptionAvailable: (): boolean => false },
}))

import { initDatabase, getDb } from '../../src/main/db/database'
import {
  importPostman,
  exportAsPostman,
  exportSuiteAsPostman,
} from '../../src/main/ipc/import-export.handler'

// ─── Postman v2.1 shapes (loose — tests only touch a subset) ─────────────
interface PmAssertion {
  kind: string
  expected?: string | number
  path?: string
}
interface PmItem {
  name: string
  request?: Record<string, unknown>
  item?: PmItem[]
  'x-apinizer'?: {
    schemaVersion?: string
    source?: string
    bodyRowType?: string
    timeoutSeconds?: number
    testType?: string
    apiType?: string
    assertions?: PmAssertion[]
  }
}
interface PmCollection {
  info: { name: string; schema: string }
  item: PmItem[]
}

interface UiAssertion {
  type: string
  expected?: string | number
  jsonPath?: string
  xPath?: string
  name: string
  enabled: boolean
}
interface UiSchema {
  body?: { type?: string; content?: string }
  assertions?: UiAssertion[]
  timeoutSeconds?: number
}

let projectId: string
let workspaceId: string

beforeAll(() => {
  initDatabase()
})

beforeEach(() => {
  const db = getDb()
  projectId = randomUUID()
  workspaceId = (db.prepare('SELECT id FROM workspaces LIMIT 1').get() as { id: string }).id
  const now = Date.now()
  db.prepare(
    `INSERT INTO projects (id, workspace_id, name, description, type, sort_order, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'http', 0, ?, ?)`,
  ).run(projectId, workspaceId, 'ApinizerPrj', 'interop project', now, now)
})

/** Read back every endpoint imported into the project, newest sort first. */
function endpointSchemas(): Array<{ name: string; method: string; schema: UiSchema }> {
  const db = getDb()
  const rows = db
    .prepare(
      'SELECT name, method, request_schema FROM endpoints WHERE project_id = ? ORDER BY sort_order',
    )
    .all(projectId) as Array<{ name: string; method: string; request_schema: string }>
  return rows.map((r) => ({
    name: r.name,
    method: r.method,
    schema: JSON.parse(r.request_schema) as UiSchema,
  }))
}

/** Build a single-item Apinizer collection with an item-level x-apinizer. */
function apinizerCollection(item: PmItem): string {
  return JSON.stringify({
    info: {
      name: 'Apinizer Export',
      schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
      'x-apinizer': { schemaVersion: '1.0', kind: 'test-collection' },
    },
    item: [item],
  })
}

// ─── IMPORT: x-apinizer → native assertions ──────────────────────────────

describe('importPostman — x-apinizer read (Apinizer → Testnizer)', () => {
  it('maps all four assertion kinds to native TestAssertion types', async () => {
    const content = apinizerCollection({
      name: 'Create User',
      request: {
        method: 'POST',
        url: 'https://api.example.com/users',
        body: { mode: 'raw', raw: '{"name":"a"}' }, // no options.raw.language
      },
      'x-apinizer': {
        schemaVersion: '1.0',
        source: 'apinizer',
        bodyRowType: 'JSON',
        timeoutSeconds: 45,
        assertions: [
          { kind: 'STATUS_CODE', expected: 201 },
          { kind: 'BODY', expected: '{"ok":true}' },
          { kind: 'JSONPATH', path: '$.user.id', expected: '123' },
          { kind: 'XPATH', path: '//id', expected: '5' },
        ],
      },
    })

    const res = await importPostman(projectId, content)
    expect(res.success).toBe(true)

    const [ep] = endpointSchemas()
    const a = ep.schema.assertions ?? []
    expect(a.map((x) => x.type)).toEqual([
      'status_equals',
      'body_equals_json',
      'body_jsonpath',
      'body_xpath',
    ])
    expect(a[0]).toMatchObject({ type: 'status_equals', expected: 201, enabled: true })
    expect(a[1]).toMatchObject({ type: 'body_equals_json', expected: '{"ok":true}' })
    expect(a[2]).toMatchObject({ type: 'body_jsonpath', jsonPath: '$.user.id', expected: '123' })
    expect(a[3]).toMatchObject({ type: 'body_xpath', xPath: '//id', expected: '5' })
    // every synthesised assertion carries a human-readable name
    expect(a.every((x) => typeof x.name === 'string' && x.name.length > 0)).toBe(true)
  })

  it('recovers the raw-body sub-type from bodyRowType when Postman omits the language', async () => {
    const content = apinizerCollection({
      name: 'SOAP call',
      request: {
        method: 'POST',
        url: 'https://api.example.com/soap',
        body: { mode: 'raw', raw: '<x/>' }, // Postman would default to text
      },
      'x-apinizer': { schemaVersion: '1.0', bodyRowType: 'XML' },
    })

    await importPostman(projectId, content)
    const [ep] = endpointSchemas()
    expect(ep.schema.body?.type).toBe('xml')
  })

  it('maps a non-JSON BODY assertion to body_contains (best-effort)', async () => {
    const content = apinizerCollection({
      name: 'Text body',
      request: { method: 'GET', url: 'https://api.example.com/ping' },
      'x-apinizer': {
        schemaVersion: '1.0',
        assertions: [{ kind: 'BODY', expected: 'pong' }],
      },
    })

    await importPostman(projectId, content)
    const [ep] = endpointSchemas()
    expect(ep.schema.assertions?.[0]).toMatchObject({ type: 'body_contains', expected: 'pong' })
  })

  it('carries timeoutSeconds into request_schema', async () => {
    const content = apinizerCollection({
      name: 'Slow',
      request: { method: 'GET', url: 'https://api.example.com/slow' },
      'x-apinizer': { schemaVersion: '1.0', timeoutSeconds: 30 },
    })
    await importPostman(projectId, content)
    const [ep] = endpointSchemas()
    expect(ep.schema.timeoutSeconds).toBe(30)
  })

  it('ignores an unknown MAJOR schemaVersion and falls back to plain Postman (with a warning)', async () => {
    const content = apinizerCollection({
      name: 'Future',
      request: { method: 'GET', url: 'https://api.example.com/f' },
      'x-apinizer': {
        schemaVersion: '2.0',
        assertions: [{ kind: 'STATUS_CODE', expected: 200 }],
      },
    })
    const res = await importPostman(projectId, content)
    expect(res.success).toBe(true)
    const [ep] = endpointSchemas()
    expect(ep.schema.assertions).toBeUndefined()
    expect((res.warnings ?? []).some((w) => /schemaVersion "2\.0"/.test(w))).toBe(true)
  })

  it('regression: a pure Postman item (no x-apinizer) imports with no assertions key', async () => {
    const content = JSON.stringify({
      info: {
        name: 'Plain',
        schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
      },
      item: [{ name: 'Health', request: { method: 'GET', url: 'https://api.example.com/health' } }],
    })
    const res = await importPostman(projectId, content)
    expect(res.success).toBe(true)
    const [ep] = endpointSchemas()
    expect(ep.schema.assertions).toBeUndefined()
    expect(ep.schema.timeoutSeconds).toBeUndefined()
  })
})

// ─── EXPORT: native assertions → x-apinizer ──────────────────────────────

/** Seed one project endpoint whose request_schema carries assertions. */
function insertEndpoint(schema: Record<string, unknown>): void {
  const db = getDb()
  const now = Date.now()
  db.prepare(
    `INSERT INTO endpoints (id, project_id, folder_id, name, description, protocol, method, path, status, request_schema, sort_order, created_at, updated_at)
     VALUES (?, ?, NULL, ?, NULL, 'http', ?, ?, 'developing', ?, 0, ?, ?)`,
  ).run(
    randomUUID(),
    projectId,
    (schema.name as string) ?? 'EP',
    (schema.method as string) ?? 'GET',
    (schema.url as string) ?? '/',
    JSON.stringify(schema),
    now,
    now,
  )
}

describe('exportAsPostman — x-apinizer write (Testnizer → Apinizer)', () => {
  it('emits x-apinizer.assertions for the four carryable kinds and drops the rest', () => {
    insertEndpoint({
      name: 'Orders',
      method: 'POST',
      url: 'https://api.example.com/orders',
      body: { type: 'json', content: '{}' },
      timeoutSeconds: 20,
      assertions: [
        { id: '1', name: 's', type: 'status_equals', enabled: true, expected: 200 },
        {
          id: '2',
          name: 'jp',
          type: 'body_jsonpath',
          enabled: true,
          jsonPath: '$.id',
          expected: '9',
        },
        { id: '3', name: 'xp', type: 'body_xpath', enabled: true, xPath: '//id', expected: '3' },
        { id: '4', name: 'bc', type: 'body_contains', enabled: true, expected: 'ok' },
        // Testnizer-only — must NOT appear in x-apinizer:
        {
          id: '5',
          name: 'rng',
          type: 'status_in_range',
          enabled: true,
          rangeMin: 200,
          rangeMax: 299,
        },
        { id: '6', name: 'hdr', type: 'header_exists', enabled: true, headerName: 'X-Id' },
        { id: '7', name: 'rt', type: 'response_time_under', enabled: true, expected: 500 },
        { id: '8', name: 'sc', type: 'pm_script', enabled: true },
      ],
    })

    const col = JSON.parse(exportAsPostman(projectId)) as PmCollection
    const item = col.item.find((i) => i.name === 'Orders')!
    const xa = item['x-apinizer']!
    expect(xa.schemaVersion).toBe('1.0')
    expect(xa.source).toBe('testnizer')
    expect(xa.bodyRowType).toBe('JSON')
    expect(xa.timeoutSeconds).toBe(20)
    // http endpoint → REST-family test-console kind + api type.
    expect(xa.testType).toBe('RESOURCE')
    expect(xa.apiType).toBe('REST')
    expect(xa.assertions).toEqual([
      { kind: 'STATUS_CODE', expected: 200 },
      { kind: 'JSONPATH', path: '$.id', expected: '9' },
      { kind: 'XPATH', path: '//id', expected: '3' },
      { kind: 'BODY', expected: 'ok' },
    ])
  })

  it('derives WSDL/SOAP testType+apiType for a SOAP protocol endpoint', () => {
    const db = getDb()
    const now = Date.now()
    db.prepare(
      `INSERT INTO endpoints (id, project_id, folder_id, name, description, protocol, method, path, status, request_schema, sort_order, created_at, updated_at)
       VALUES (?, ?, NULL, 'Soap', NULL, 'soap', 'POST', ?, 'developing', ?, 0, ?, ?)`,
    ).run(
      randomUUID(),
      projectId,
      'https://api.example.com/soap',
      JSON.stringify({
        url: 'https://api.example.com/soap',
        body: { type: 'xml', content: '<x/>' },
        assertions: [{ id: '1', name: 's', type: 'status_equals', enabled: true, expected: 200 }],
      }),
      now,
      now,
    )
    const col = JSON.parse(exportAsPostman(projectId)) as PmCollection
    const xa = col.item.find((i) => i.name === 'Soap')!['x-apinizer']!
    expect(xa.testType).toBe('WSDL')
    expect(xa.apiType).toBe('SOAP')
    expect(xa.bodyRowType).toBe('XML')
  })

  it('omits x-apinizer entirely for a request with no carryable fidelity', () => {
    insertEndpoint({
      name: 'Plain',
      method: 'GET',
      url: 'https://api.example.com/plain',
      body: { type: 'json', content: '{}' },
    })
    const col = JSON.parse(exportAsPostman(projectId)) as PmCollection
    const item = col.item.find((i) => i.name === 'Plain')!
    expect(item['x-apinizer']).toBeUndefined()
  })
})

// ─── EXPORT: suite items (assertions live in their own column) ────────────

describe('exportSuiteAsPostman — x-apinizer from the suite item assertions column', () => {
  it('reads assertions from test_suite_items.assertions', () => {
    const db = getDb()
    const now = Date.now()
    const suiteId = randomUUID()
    db.prepare(
      `INSERT INTO test_suites (id, project_id, name, description, sort_order, created_at, updated_at)
       VALUES (?, ?, 'S', NULL, 0, ?, ?)`,
    ).run(suiteId, projectId, now, now)
    db.prepare(
      `INSERT INTO test_suite_items (id, suite_id, folder_id, protocol, name, method, url, request_schema, assertions, source_endpoint_id, sort_order, created_at, updated_at)
       VALUES (?, ?, NULL, 'http', 'Login', 'POST', ?, ?, ?, NULL, 0, ?, ?)`,
    ).run(
      randomUUID(),
      suiteId,
      'https://api.example.com/login',
      JSON.stringify({
        url: 'https://api.example.com/login',
        body: { type: 'json', content: '{}' },
      }),
      JSON.stringify([
        { id: '1', name: 's', type: 'status_equals', enabled: true, expected: 204 },
        {
          id: '2',
          name: 'jp',
          type: 'body_jsonpath',
          enabled: true,
          jsonPath: '$.token',
          expected: 'abc',
        },
      ]),
      now,
      now,
    )

    const col = JSON.parse(exportSuiteAsPostman(suiteId)) as PmCollection
    const item = col.item.find((i) => i.name === 'Login')!
    expect(item['x-apinizer']?.assertions).toEqual([
      { kind: 'STATUS_CODE', expected: 204 },
      { kind: 'JSONPATH', path: '$.token', expected: 'abc' },
    ])
    // Suite item protocol is threaded → derived types come through too.
    expect(item['x-apinizer']?.testType).toBe('RESOURCE')
    expect(item['x-apinizer']?.apiType).toBe('REST')
  })
})

// ─── ROUND-TRIP: Apinizer fixture → import → export ──────────────────────

describe('round-trip — x-apinizer survives import then export', () => {
  it('preserves the four assertion kinds + bodyRowType + timeout', async () => {
    const content = apinizerCollection({
      name: 'Round',
      request: {
        method: 'POST',
        url: 'https://api.example.com/round',
        body: { mode: 'raw', raw: '{"a":1}' },
      },
      'x-apinizer': {
        schemaVersion: '1.0',
        source: 'apinizer',
        bodyRowType: 'JSON',
        timeoutSeconds: 15,
        assertions: [
          { kind: 'STATUS_CODE', expected: 200 },
          { kind: 'JSONPATH', path: '$.id', expected: '7' },
          { kind: 'XPATH', path: '//id', expected: '2' },
          { kind: 'BODY', expected: '{"done":true}' },
        ],
      },
    })
    await importPostman(projectId, content)

    const col = JSON.parse(exportAsPostman(projectId)) as PmCollection
    const item = col.item.find((i) => i.name === 'Round')!
    const xa = item['x-apinizer']!
    expect(xa.bodyRowType).toBe('JSON')
    expect(xa.timeoutSeconds).toBe(15)
    // Re-exported as a standalone (proxy-free) http test → derived types.
    expect(xa.testType).toBe('RESOURCE')
    expect(xa.apiType).toBe('REST')
    // Import maps BODY(json) → body_equals_json → export maps back to BODY.
    expect(xa.assertions).toEqual([
      { kind: 'STATUS_CODE', expected: 200 },
      { kind: 'JSONPATH', path: '$.id', expected: '7' },
      { kind: 'XPATH', path: '//id', expected: '2' },
      { kind: 'BODY', expected: '{"done":true}' },
    ])
  })
})
