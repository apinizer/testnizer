/**
 * MST-310 (unit) — Insomnia v4 export shape.
 *
 * Drives `exportAsInsomnia` against a real schema-loaded better-sqlite3 instance
 * (same harness as `import-insomnia.test.ts`: electron mocked to a tmpdir, then
 * `initDatabase()` + `getDb()`). Endpoints + folders are inserted *directly*
 * (no importer) so the assertions pin the exporter's output shape rather than a
 * round-trip — complementary to the loose round-trip check already living in
 * `import-insomnia.test.ts`.
 */

import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest'
import { mkdtempSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

const tmpDir = mkdtempSync(path.join(os.tmpdir(), 'testnizer-export-insomnia-'))

vi.mock('electron', () => ({
  app: { getPath: (_: string): string => tmpDir },
  ipcMain: { handle: (): void => {} },
  dialog: {},
  safeStorage: { isEncryptionAvailable: (): boolean => false },
}))

import { initDatabase, getDb } from '../../src/main/db/database'
import { exportAsInsomnia } from '../../src/main/ipc/import-export.handler'

let projectId: string

beforeAll(() => {
  initDatabase()
})

beforeEach(() => {
  const db = getDb()
  projectId = randomUUID()
  const wsRow = db.prepare('SELECT id FROM workspaces LIMIT 1').get() as { id: string }
  const now = Date.now()
  db.prepare(
    `INSERT INTO projects (id, workspace_id, name, description, type, sort_order, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(projectId, wsRow.id, 'ExportPrj', 'export fixture project', 'http', 0, now, now)
})

function insertFolder(parentId: string | null, name: string, sortOrder = 0): string {
  const db = getDb()
  const id = randomUUID()
  db.prepare(
    `INSERT INTO folders (id, project_id, parent_id, name, sort_order)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(id, projectId, parentId, name, sortOrder)
  return id
}

function insertEndpoint(opts: {
  folderId?: string | null
  name: string
  method: string
  schema: Record<string, unknown>
  description?: string | null
  sortOrder?: number
}): string {
  const db = getDb()
  const id = randomUUID()
  const now = Date.now()
  db.prepare(
    `INSERT INTO endpoints
       (id, project_id, folder_id, name, description, protocol, method, path, status, request_schema, response_schemas, sort_order, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'http', ?, ?, 'developing', ?, NULL, ?, ?, ?)`,
  ).run(
    id,
    projectId,
    opts.folderId ?? null,
    opts.name,
    opts.description ?? null,
    opts.method,
    (opts.schema.url as string) ?? '/',
    JSON.stringify(opts.schema),
    opts.sortOrder ?? 0,
    now,
    now,
  )
  return id
}

interface InsomniaRes {
  _id: string
  _type: string
  parentId?: string
  name?: string
  description?: string
  method?: string
  url?: string
  headers?: Array<{ name: string; value: string; disabled?: boolean }>
  parameters?: Array<{ name: string; value: string; disabled?: boolean }>
  body?: { mimeType?: string; text?: string; params?: Array<{ name: string; value: string }> }
  authentication?: { type?: string; username?: string; password?: string; token?: string }
}

interface InsomniaDoc {
  __export_format?: number
  __export_date?: string
  __export_source?: string
  _type?: string
  resources?: InsomniaRes[]
}

describe('exportAsInsomnia — envelope', () => {
  it('emits the v4 export wrapper with a workspace root resource', () => {
    const doc = JSON.parse(exportAsInsomnia(projectId)) as InsomniaDoc
    expect(doc._type).toBe('export')
    expect(doc.__export_format).toBe(4)
    expect(doc.__export_source).toBe('testnizer')
    expect(typeof doc.__export_date).toBe('string')
    expect(Array.isArray(doc.resources)).toBe(true)

    const workspace = doc.resources!.find((r) => r._type === 'workspace')
    expect(workspace).toBeDefined()
    expect(workspace?._id).toBe(`wrk_${projectId}`)
    expect(workspace?.name).toBe('ExportPrj')
    expect(workspace?.description).toBe('export fixture project')
  })

  it('throws when the project does not exist', () => {
    expect(() => exportAsInsomnia('does-not-exist')).toThrow(/not found/i)
  })
})

describe('exportAsInsomnia — request resources', () => {
  it('maps method, url, headers, and query parameters onto request resources', () => {
    const epId = insertEndpoint({
      name: 'List items',
      method: 'get',
      schema: {
        url: 'https://api.example.com/items',
        method: 'GET',
        headers: [
          { id: 'h1', key: 'Accept', value: 'application/json', enabled: true },
          { id: 'h2', key: 'X-Disabled', value: 'nope', enabled: false },
        ],
        params: [
          { id: 'p1', key: 'page', value: '2', enabled: true },
          { id: 'p2', key: 'off', value: 'x', enabled: false },
        ],
      },
    })

    const doc = JSON.parse(exportAsInsomnia(projectId)) as InsomniaDoc
    const req = doc.resources!.find((r) => r._id === `req_${epId}`)!
    expect(req._type).toBe('request')
    // method is upper-cased from the endpoints.method column.
    expect(req.method).toBe('GET')
    expect(req.url).toBe('https://api.example.com/items')
    // Endpoints with no folder hang off the workspace root.
    expect(req.parentId).toBe(`wrk_${projectId}`)

    // Headers: enabled passthrough, disabled flagged.
    const accept = req.headers!.find((h) => h.name === 'Accept')
    expect(accept?.value).toBe('application/json')
    expect(accept?.disabled).toBeUndefined()
    const disabled = req.headers!.find((h) => h.name === 'X-Disabled')
    expect(disabled?.disabled).toBe(true)

    // Query params map to `parameters[]` with the same disabled semantics.
    const page = req.parameters!.find((p) => p.name === 'page')
    expect(page?.value).toBe('2')
    const off = req.parameters!.find((p) => p.name === 'off')
    expect(off?.disabled).toBe(true)
  })

  it('maps a JSON body to mimeType application/json + text', () => {
    const epId = insertEndpoint({
      name: 'Create item',
      method: 'post',
      schema: {
        url: 'https://api.example.com/items',
        method: 'POST',
        body: { type: 'json', content: '{"name":"alice"}' },
      },
    })

    const doc = JSON.parse(exportAsInsomnia(projectId)) as InsomniaDoc
    const req = doc.resources!.find((r) => r._id === `req_${epId}`)!
    expect(req.method).toBe('POST')
    expect(req.body?.mimeType).toBe('application/json')
    expect(req.body?.text).toBe('{"name":"alice"}')
  })

  it('maps a form-data body to multipart params', () => {
    const epId = insertEndpoint({
      name: 'Upload form',
      method: 'post',
      schema: {
        url: 'https://api.example.com/upload',
        method: 'POST',
        body: {
          type: 'form-data',
          formData: [
            { id: 'f1', key: 'field', value: 'val', enabled: true, type: 'text' },
          ],
        },
      },
    })

    const doc = JSON.parse(exportAsInsomnia(projectId)) as InsomniaDoc
    const req = doc.resources!.find((r) => r._id === `req_${epId}`)!
    expect(req.body?.mimeType).toBe('multipart/form-data')
    expect(req.body?.params?.[0]).toMatchObject({ name: 'field', value: 'val' })
  })

  it('maps basic + bearer auth onto Insomnia authentication blocks', () => {
    const basicId = insertEndpoint({
      name: 'Basic call',
      method: 'get',
      schema: {
        url: 'https://api.example.com/basic',
        method: 'GET',
        auth: { type: 'basic', basic: { username: 'admin', password: 'secret' } },
      },
    })
    const bearerId = insertEndpoint({
      name: 'Bearer call',
      method: 'get',
      schema: {
        url: 'https://api.example.com/bearer',
        method: 'GET',
        auth: { type: 'bearer', bearer: { token: 'tok-123', prefix: 'Bearer' } },
      },
    })

    const doc = JSON.parse(exportAsInsomnia(projectId)) as InsomniaDoc
    const basicReq = doc.resources!.find((r) => r._id === `req_${basicId}`)!
    expect(basicReq.authentication).toMatchObject({
      type: 'basic',
      username: 'admin',
      password: 'secret',
    })
    const bearerReq = doc.resources!.find((r) => r._id === `req_${bearerId}`)!
    expect(bearerReq.authentication).toMatchObject({ type: 'bearer', token: 'tok-123' })

    // type:none auth must not emit an authentication block.
    const noneId = insertEndpoint({
      name: 'No auth call',
      method: 'get',
      schema: { url: 'https://api.example.com/none', method: 'GET', auth: { type: 'none' } },
    })
    const doc2 = JSON.parse(exportAsInsomnia(projectId)) as InsomniaDoc
    const noneReq = doc2.resources!.find((r) => r._id === `req_${noneId}`)!
    expect(noneReq.authentication).toBeUndefined()
  })
})

describe('exportAsInsomnia — folder hierarchy', () => {
  it('emits request_group resources and nests requests under their folder', () => {
    const outer = insertFolder(null, 'Outer', 0)
    const inner = insertFolder(outer, 'Inner', 1)
    const epId = insertEndpoint({
      folderId: inner,
      name: 'Nested call',
      method: 'get',
      schema: { url: 'https://api.example.com/nested', method: 'GET' },
    })

    const doc = JSON.parse(exportAsInsomnia(projectId)) as InsomniaDoc
    const groups = doc.resources!.filter((r) => r._type === 'request_group')
    expect(groups).toHaveLength(2)

    const outerRes = groups.find((g) => g._id === `fld_${outer}`)!
    expect(outerRes.name).toBe('Outer')
    // Top-level folder parents to the workspace.
    expect(outerRes.parentId).toBe(`wrk_${projectId}`)

    const innerRes = groups.find((g) => g._id === `fld_${inner}`)!
    expect(innerRes.name).toBe('Inner')
    // Nested folder parents to its parent folder, not the workspace.
    expect(innerRes.parentId).toBe(`fld_${outer}`)

    const req = doc.resources!.find((r) => r._id === `req_${epId}`)!
    expect(req.parentId).toBe(`fld_${inner}`)
  })
})
