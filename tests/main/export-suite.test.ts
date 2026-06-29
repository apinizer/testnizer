/**
 * T-24 (unit) — Test-suite export to Postman v2.1 and Insomnia v4.
 *
 * Drives `exportSuiteAsPostman` / `exportSuiteAsInsomnia` against a real
 * schema-loaded better-sqlite3 instance (same harness as the other export
 * tests). A suite with a nested folder tree, cascade folder auth + scripts,
 * and inline item snapshots is inserted directly so the assertions pin the
 * exporter's output shape: the suite must survive the trip into both tools
 * (folder tree + per-item request + folder-level auth/scripts + collection
 * variables drawn from the owning project's active environment).
 */

import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest'
import { mkdtempSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

const tmpDir = mkdtempSync(path.join(os.tmpdir(), 'testnizer-export-suite-'))

vi.mock('electron', () => ({
  app: { getPath: (_: string): string => tmpDir },
  ipcMain: { handle: (): void => {} },
  dialog: {},
  safeStorage: { isEncryptionAvailable: (): boolean => false },
}))

import { initDatabase, getDb } from '../../src/main/db/database'
import {
  exportSuiteAsPostman,
  exportSuiteAsInsomnia,
  importPostman,
  importInsomnia,
} from '../../src/main/ipc/import-export.handler'

let projectId: string
let suiteId: string

beforeAll(() => {
  initDatabase()
})

function insertSuite(name: string): string {
  const db = getDb()
  const id = randomUUID()
  const now = Date.now()
  db.prepare(
    `INSERT INTO test_suites (id, project_id, name, description, sort_order, created_at, updated_at)
     VALUES (?, ?, ?, ?, 0, ?, ?)`,
  ).run(id, projectId, name, 'suite fixture', now, now)
  return id
}

function insertSuiteFolder(opts: {
  parentId?: string | null
  name: string
  sortOrder?: number
  auth?: string | null
  preScript?: string | null
  postScript?: string | null
}): string {
  const db = getDb()
  const id = randomUUID()
  db.prepare(
    `INSERT INTO test_suite_folders (id, suite_id, parent_id, name, sort_order, auth, pre_script, post_script, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    suiteId,
    opts.parentId ?? null,
    opts.name,
    opts.sortOrder ?? 0,
    opts.auth ?? null,
    opts.preScript ?? null,
    opts.postScript ?? null,
    Date.now(),
  )
  return id
}

function insertSuiteItem(opts: {
  folderId?: string | null
  name: string
  method: string
  schema: Record<string, unknown>
  sortOrder?: number
}): string {
  const db = getDb()
  const id = randomUUID()
  const now = Date.now()
  db.prepare(
    `INSERT INTO test_suite_items (id, suite_id, folder_id, protocol, name, method, url, request_schema, assertions, source_endpoint_id, sort_order, created_at, updated_at)
     VALUES (?, ?, ?, 'http', ?, ?, ?, ?, NULL, NULL, ?, ?, ?)`,
  ).run(
    id,
    suiteId,
    opts.folderId ?? null,
    opts.name,
    opts.method,
    (opts.schema.url as string) ?? '/',
    JSON.stringify(opts.schema),
    opts.sortOrder ?? 0,
    now,
    now,
  )
  return id
}

beforeEach(() => {
  const db = getDb()
  projectId = randomUUID()
  const wsRow = db.prepare('SELECT id FROM workspaces LIMIT 1').get() as { id: string }
  const now = Date.now()
  db.prepare(
    `INSERT INTO projects (id, workspace_id, name, description, type, sort_order, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(projectId, wsRow.id, 'SuitePrj', 'suite export project', 'http', 0, now, now)

  // Active environment so the Postman export carries collection variables.
  // `environments` is keyed by workspace_id (NOT NULL) with project_id added by
  // a later migration — both must be set for the project-scoped lookup to hit.
  const envId = randomUUID()
  db.prepare(
    `INSERT INTO environments (id, workspace_id, project_id, name, is_active, created_at, updated_at)
     VALUES (?, ?, ?, ?, 1, ?, ?)`,
  ).run(envId, wsRow.id, projectId, 'Base', now, now)
  db.prepare(
    `INSERT INTO environment_variables (id, environment_id, key, value, initial_value, enabled)
     VALUES (?, ?, ?, ?, ?, 1)`,
  ).run(randomUUID(), envId, 'baseUrl', 'https://api.example.com', 'https://api.example.com')

  suiteId = insertSuite('Checkout Suite')

  // Folder tree: Setup (root) → Orders (nested). Setup carries cascade auth +
  // a pre-request script; Orders carries a post-response script.
  const setup = insertSuiteFolder({
    name: 'Setup',
    sortOrder: 0,
    auth: JSON.stringify({ type: 'bearer', bearer: { token: '{{accessToken}}' } }),
    preScript: "pm.environment.set('ran', '1')",
  })
  const orders = insertSuiteFolder({
    parentId: setup,
    name: 'Orders',
    sortOrder: 1,
    postScript: "pm.test('ok', () => pm.response.to.have.status(200))",
  })

  // A root item + items inside each folder, each with a full inline snapshot.
  insertSuiteItem({
    name: 'Health',
    method: 'GET',
    sortOrder: 0,
    schema: { url: '{{baseUrl}}/health', headers: [{ key: 'X-Trace', value: '1', enabled: true }] },
  })
  insertSuiteItem({
    folderId: setup,
    name: 'Login',
    method: 'POST',
    sortOrder: 1,
    schema: {
      url: '{{baseUrl}}/login',
      headers: [{ key: 'Content-Type', value: 'application/json', enabled: true }],
      body: { type: 'json', content: '{"user":"a"}' },
      auth: { type: 'basic', basic: { username: 'a', password: 'b' } },
      preScript: "pm.environment.set('t', '1')",
    },
  })
  insertSuiteItem({
    folderId: orders,
    name: 'Create order',
    method: 'POST',
    sortOrder: 2,
    schema: { url: '{{baseUrl}}/orders', body: { type: 'json', content: '{"sku":"x"}' } },
  })
})

// ─── Postman v2.1 ──────────────────────────────────────────────

interface PmItem {
  name?: string
  item?: PmItem[]
  request?: {
    method?: string
    url?: unknown
    header?: Array<{ key: string; value: string }>
    body?: { mode?: string; raw?: string }
    auth?: { type?: string }
  }
  auth?: { type?: string }
  event?: Array<{ listen: string; script: { exec: string[] } }>
}
interface PmCollection {
  info?: { name?: string; schema?: string }
  item?: PmItem[]
  variable?: Array<{ key: string; value: string }>
}

describe('exportSuiteAsPostman', () => {
  it('throws when the suite does not exist', () => {
    expect(() => exportSuiteAsPostman('nope')).toThrow(/not found/i)
  })

  it('emits a v2.1 collection named after the suite with project env variables', () => {
    const col = JSON.parse(exportSuiteAsPostman(suiteId)) as PmCollection
    expect(col.info?.name).toBe('Checkout Suite')
    expect(col.info?.schema).toContain('v2.1.0')
    expect(col.variable?.find((v) => v.key === 'baseUrl')?.value).toBe('https://api.example.com')
  })

  it('preserves the nested folder tree', () => {
    const col = JSON.parse(exportSuiteAsPostman(suiteId)) as PmCollection
    const root = col.item ?? []
    // Root has: Health item + Setup folder.
    const setup = root.find((i) => i.name === 'Setup')
    expect(setup).toBeTruthy()
    expect(setup!.item?.some((i) => i.name === 'Login')).toBe(true)
    // Orders is nested INSIDE Setup.
    const orders = setup!.item?.find((i) => i.name === 'Orders')
    expect(orders).toBeTruthy()
    expect(orders!.item?.some((i) => i.name === 'Create order')).toBe(true)
  })

  it('round-trips folder-level cascade auth and scripts onto folder nodes', () => {
    const col = JSON.parse(exportSuiteAsPostman(suiteId)) as PmCollection
    const setup = (col.item ?? []).find((i) => i.name === 'Setup')!
    expect(setup.auth?.type).toBe('bearer')
    expect(setup.event?.some((e) => e.listen === 'prerequest')).toBe(true)
    const orders = setup.item?.find((i) => i.name === 'Orders')!
    expect(orders.event?.some((e) => e.listen === 'test')).toBe(true)
  })

  it('carries each item request snapshot (method, headers, body, auth)', () => {
    const col = JSON.parse(exportSuiteAsPostman(suiteId)) as PmCollection
    const setup = (col.item ?? []).find((i) => i.name === 'Setup')!
    const login = setup.item?.find((i) => i.name === 'Login')!
    expect(login.request?.method).toBe('POST')
    expect(login.request?.body?.raw).toContain('"user"')
    expect(login.request?.auth?.type).toBe('basic')
    expect(login.request?.header?.some((h) => h.key === 'Content-Type')).toBe(true)
  })
})

// ─── Insomnia v4 ───────────────────────────────────────────────

interface InsoRes {
  _id: string
  _type: string
  parentId?: string
  name?: string
  method?: string
  url?: string
}
interface InsoDoc {
  __export_format?: number
  _type?: string
  resources?: InsoRes[]
}

describe('exportSuiteAsInsomnia', () => {
  it('throws when the suite does not exist', () => {
    expect(() => exportSuiteAsInsomnia('nope')).toThrow(/not found/i)
  })

  it('emits a v4 export envelope with a workspace root', () => {
    const doc = JSON.parse(exportSuiteAsInsomnia(suiteId)) as InsoDoc
    expect(doc.__export_format).toBe(4)
    expect(doc._type).toBe('export')
    const ws = doc.resources?.find((r) => r._type === 'workspace')
    expect(ws?.name).toBe('Checkout Suite')
  })

  it('rebuilds the nested folder tree via request_group parentId', () => {
    const doc = JSON.parse(exportSuiteAsInsomnia(suiteId)) as InsoDoc
    const groups = (doc.resources ?? []).filter((r) => r._type === 'request_group')
    const setup = groups.find((g) => g.name === 'Setup')!
    const orders = groups.find((g) => g.name === 'Orders')!
    const ws = doc.resources!.find((r) => r._type === 'workspace')!
    expect(setup.parentId).toBe(ws._id)
    // Orders hangs off Setup, not the workspace root.
    expect(orders.parentId).toBe(setup._id)
  })

  it('emits one request resource per suite item under the right parent', () => {
    const doc = JSON.parse(exportSuiteAsInsomnia(suiteId)) as InsoDoc
    const reqs = (doc.resources ?? []).filter((r) => r._type === 'request')
    expect(reqs.map((r) => r.name).sort()).toEqual(['Create order', 'Health', 'Login'])
    const create = reqs.find((r) => r.name === 'Create order')!
    expect(create.method).toBe('POST')
    expect(create.url).toBe('{{baseUrl}}/orders')
  })
})

// ─── Round-trip: export then re-import through our own importers ─

function freshProject(name: string): string {
  const db = getDb()
  const id = randomUUID()
  const wsRow = db.prepare('SELECT id FROM workspaces LIMIT 1').get() as { id: string }
  const now = Date.now()
  db.prepare(
    `INSERT INTO projects (id, workspace_id, name, description, type, sort_order, created_at, updated_at)
     VALUES (?, ?, ?, NULL, 'http', 0, ?, ?)`,
  ).run(id, wsRow.id, name, now, now)
  return id
}

describe('suite export → re-import round-trip', () => {
  it('Postman export re-imports with the nested folder tree and every request intact', async () => {
    const json = exportSuiteAsPostman(suiteId)
    const dest = freshProject('PostmanDest')
    const r = await importPostman(dest, json, null)
    expect(r.success).toBe(true)

    const db = getDb()
    const eps = db.prepare('SELECT name FROM endpoints WHERE project_id = ?').all(dest) as Array<{
      name: string
    }>
    expect(eps.map((e) => e.name).sort()).toEqual(['Create order', 'Health', 'Login'])

    const folders = db
      .prepare(
        'SELECT id, name, parent_id, auth, pre_script, post_script FROM folders WHERE project_id = ?',
      )
      .all(dest) as Array<{
      id: string
      name: string
      parent_id: string | null
      auth: string | null
      pre_script: string | null
      post_script: string | null
    }>
    expect(folders.map((f) => f.name).sort()).toEqual(['Orders', 'Setup'])
    // The Orders-nested-under-Setup tree survives the round-trip.
    const setup = folders.find((f) => f.name === 'Setup')!
    const orders = folders.find((f) => f.name === 'Orders')!
    expect(orders.parent_id).toBe(setup.id)
    // Folder cascade metadata survives the FULL round-trip: export wrote it to
    // Postman folder event[]/auth, import read it back into the folders table.
    // This is the parity that was silently broken before the importPostman fix.
    expect(setup.pre_script).toContain("pm.environment.set('ran'")
    expect(JSON.parse(setup.auth!).type).toBe('bearer')
    expect(orders.post_script).toContain('pm.test')
  })

  it('Insomnia export re-imports with the nested folder tree and every request intact', async () => {
    const json = exportSuiteAsInsomnia(suiteId)
    const dest = freshProject('InsomniaDest')
    const r = await importInsomnia(dest, json, null)
    expect(r.success).toBe(true)

    const db = getDb()
    const eps = db.prepare('SELECT name FROM endpoints WHERE project_id = ?').all(dest) as Array<{
      name: string
    }>
    expect(eps.map((e) => e.name).sort()).toEqual(['Create order', 'Health', 'Login'])

    const folders = db
      .prepare('SELECT id, name, parent_id FROM folders WHERE project_id = ?')
      .all(dest) as Array<{ id: string; name: string; parent_id: string | null }>
    expect(folders.map((f) => f.name).sort()).toEqual(['Orders', 'Setup'])
    const setup = folders.find((f) => f.name === 'Setup')!
    const orders = folders.find((f) => f.name === 'Orders')!
    expect(orders.parent_id).toBe(setup.id)
  })
})
