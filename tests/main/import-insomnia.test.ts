/**
 * Insomnia v4 import + reverse-export coverage.
 *
 * The handler module pulls in `electron` (for ipcMain/dialog) and the project
 * `getDb()` accessor. We stub `electron` so `app.getPath('userData')` returns a
 * real tempdir, then run the canonical `initDatabase()` to get a schema-loaded
 * better-sqlite3 instance. After that the import/export functions can be
 * exercised end-to-end against an isolated DB.
 */

import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest'
import { mkdtempSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

const tmpDir = mkdtempSync(path.join(os.tmpdir(), 'testnizer-insomnia-'))

vi.mock('electron', () => ({
  app: { getPath: (_: string): string => tmpDir },
  ipcMain: { handle: (): void => {} },
  dialog: {},
  safeStorage: { isEncryptionAvailable: (): boolean => false },
}))

import { initDatabase, getDb } from '../../src/main/db/database'
import {
  importInsomnia,
  exportAsInsomnia,
  normalizeInsomniaScript,
  mapInsomniaBodyToUi,
  mapInsomniaAuthToUi,
} from '../../src/main/ipc/import-export.handler'

let projectId: string

beforeAll(() => {
  initDatabase()
})

beforeEach(() => {
  // Each test gets a fresh project (and its descendants are wiped via cascade
  // when we re-create the project).
  const db = getDb()
  projectId = randomUUID()
  const wsRow = db.prepare('SELECT id FROM workspaces LIMIT 1').get() as { id: string }
  const now = Date.now()
  db.prepare(
    `INSERT INTO projects (id, workspace_id, name, description, type, sort_order, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(projectId, wsRow.id, 'TestPrj', null, 'http', 0, now, now)
})

// ─── Happy-path Insomnia v4 import ────────────────────────

const v4Doc = {
  _type: 'export',
  __export_format: 4,
  __export_date: '2026-04-02T10:00:00.000Z',
  __export_source: 'insomnia.desktop.app:v8.6.0',
  resources: [
    { _id: 'wrk_1', _type: 'workspace', name: 'WS' },
    { _id: 'fld_outer', _type: 'request_group', parentId: 'wrk_1', name: 'Outer' },
    { _id: 'fld_inner', _type: 'request_group', parentId: 'fld_outer', name: 'Inner' },
    {
      _id: 'req_get',
      _type: 'request',
      parentId: 'fld_inner',
      name: 'Get item',
      method: 'GET',
      url: 'https://api.example.com/items/{{ _.id }}',
      headers: [{ name: 'Accept', value: 'application/json' }],
      parameters: [{ name: 'verbose', value: 'true' }],
    },
    {
      _id: 'req_create',
      _type: 'request',
      parentId: 'fld_outer',
      name: 'Create item',
      method: 'POST',
      url: 'https://api.example.com/items',
      body: { mimeType: 'application/json', text: '{"name":"alice"}' },
      headers: [{ name: 'Content-Type', value: 'application/json' }],
      authentication: { type: 'basic', username: 'admin', password: 'secret' },
    },
    {
      _id: 'req_upload',
      _type: 'request',
      parentId: 'fld_outer',
      name: 'Upload',
      method: 'POST',
      url: 'https://api.example.com/upload',
      body: {
        mimeType: 'multipart/form-data',
        params: [
          { name: 'caption', value: 'demo', type: 'text' },
          { name: 'file', value: '', type: 'file', fileName: '/var/data/report.pdf' },
          { name: 'off', value: 'x', disabled: true },
        ],
      },
    },
    {
      _id: 'req_form',
      _type: 'request',
      parentId: 'fld_outer',
      name: 'Login form',
      method: 'POST',
      url: 'https://api.example.com/login',
      body: {
        mimeType: 'application/x-www-form-urlencoded',
        params: [
          { name: 'user', value: 'a' },
          { name: 'pass', value: 'b' },
        ],
      },
    },
    {
      _id: 'req_bin',
      _type: 'request',
      parentId: 'fld_outer',
      name: 'Octet',
      method: 'POST',
      url: 'https://api.example.com/bin',
      body: { mimeType: 'application/octet-stream', text: 'binary-stub' },
    },
    {
      _id: 'req_bearer',
      _type: 'request',
      parentId: 'fld_outer',
      name: 'Bearer',
      method: 'GET',
      url: 'https://api.example.com/me',
      authentication: { type: 'bearer', token: 'abc' },
    },
    {
      _id: 'req_apikey',
      _type: 'request',
      parentId: 'fld_outer',
      name: 'Apikey query',
      method: 'GET',
      url: 'https://api.example.com/k',
      authentication: { type: 'apikey', key: 'X-K', value: 'kv', addTo: 'queryParams' },
    },
    {
      _id: 'req_script',
      _type: 'request',
      parentId: 'fld_outer',
      name: 'Scripted',
      method: 'GET',
      url: 'https://api.example.com/s',
      preRequestScript:
        "insomnia.environment.set('a', '1'); insomnia.test('ok', () => insomnia.expect(1).to.eql(1));",
      afterResponseScript: "insomnia.expect(insomnia.response.code).to.eql(200);",
    },
    {
      _id: 'env_dev',
      _type: 'environment',
      parentId: 'wrk_1',
      name: 'Dev',
      data: [
        { name: 'baseUrl', value: 'https://api.example.com' },
        { name: 'apiKey', value: 'topsecret' },
      ],
    },
  ],
}

describe('importInsomnia v4 — folders, body, auth, scripts, envs', () => {
  it('imports nested request_groups as nested folders', async () => {
    const r = await importInsomnia(projectId, JSON.stringify(v4Doc))
    expect(r.success).toBe(true)
    expect(r.folderCount).toBe(2)

    const db = getDb()
    const folders = db
      .prepare('SELECT name, parent_id FROM folders WHERE project_id = ?')
      .all(projectId) as Array<{ name: string; parent_id: string | null }>
    const outer = folders.find((f) => f.name === 'Outer')!
    const inner = folders.find((f) => f.name === 'Inner')!
    expect(outer.parent_id).toBeNull()
    expect(inner.parent_id).toBe(
      (db.prepare('SELECT id FROM folders WHERE name = ?').get('Outer') as { id: string }).id,
    )
  })

  it('imports JSON, form-data (with file), urlencoded, and binary-fallback bodies', async () => {
    await importInsomnia(projectId, JSON.stringify(v4Doc))
    const db = getDb()
    const eps = db
      .prepare('SELECT name, request_schema FROM endpoints WHERE project_id = ?')
      .all(projectId) as Array<{ name: string; request_schema: string }>
    const byName: Record<string, { body?: unknown }> = {}
    for (const ep of eps) byName[ep.name] = JSON.parse(ep.request_schema)

    expect(byName['Create item'].body).toMatchObject({ type: 'json', content: '{"name":"alice"}' })

    const upload = byName['Upload'].body as { type: string; formData: Array<Record<string, unknown>> }
    expect(upload.type).toBe('form-data')
    const fileField = upload.formData.find((f) => f.key === 'file')!
    expect(fileField.type).toBe('file')
    expect(fileField.filePath).toBe('/var/data/report.pdf')
    expect(fileField.value).toBe('report.pdf')
    const off = upload.formData.find((f) => f.key === 'off')!
    expect(off.enabled).toBe(false)

    expect((byName['Login form'].body as { type: string }).type).toBe('urlencoded')

    // application/octet-stream is unknown to the mapper; it falls back to text
    // when text is set, never crashes.
    expect((byName['Octet'].body as { type: string }).type).toBe('text')
  })

  it('maps bearer, basic, and apiKey auth (header/query)', async () => {
    await importInsomnia(projectId, JSON.stringify(v4Doc))
    const db = getDb()
    const rows = db
      .prepare('SELECT name, request_schema FROM endpoints WHERE project_id = ?')
      .all(projectId) as Array<{ name: string; request_schema: string }>
    const byName: Record<string, { auth?: Record<string, unknown> }> = {}
    for (const r of rows) byName[r.name] = JSON.parse(r.request_schema)

    expect(byName['Create item'].auth).toEqual({
      type: 'basic',
      basic: { username: 'admin', password: 'secret' },
    })
    expect(byName['Bearer'].auth).toEqual({
      type: 'bearer',
      bearer: { token: 'abc', prefix: 'Bearer' },
    })
    expect(byName['Apikey query'].auth).toEqual({
      type: 'api-key',
      apiKey: { key: 'X-K', value: 'kv', in: 'query' },
    })
  })

  it('rewrites pre/post scripts insomnia.* → pm.* and stores them', async () => {
    await importInsomnia(projectId, JSON.stringify(v4Doc))
    const db = getDb()
    const row = db
      .prepare('SELECT request_schema FROM endpoints WHERE project_id = ? AND name = ?')
      .get(projectId, 'Scripted') as { request_schema: string }
    const schema = JSON.parse(row.request_schema)
    expect(schema.preScript).toContain("pm.environment.set('a', '1')")
    expect(schema.preScript).toContain("pm.test('ok'")
    expect(schema.preScript).not.toContain('insomnia.')
    expect(schema.postScript).toContain('pm.expect(pm.response.code)')
    expect(schema.postScript).not.toContain('insomnia.')
  })

  it('extracts environment vars (legacy data:[{name,value}] form)', async () => {
    const r = await importInsomnia(projectId, JSON.stringify(v4Doc))
    expect(r.suggestedEnvVars).toMatchObject({
      baseUrl: 'https://api.example.com',
      apiKey: 'topsecret',
    })
  })
})

// ─── Round-trip: import → export → re-import ───────────────

describe('Insomnia v4 round-trip', () => {
  it('preserves folders, methods, urls, auth, body, file fields', async () => {
    await importInsomnia(projectId, JSON.stringify(v4Doc))

    const exported = exportAsInsomnia(projectId)
    const re = JSON.parse(exported) as { resources: Array<Record<string, unknown>> }
    expect(re.resources.find((r) => r._type === 'workspace')).toBeDefined()
    expect(re.resources.filter((r) => r._type === 'request_group')).toHaveLength(2)
    expect(re.resources.filter((r) => r._type === 'request').length).toBeGreaterThanOrEqual(7)

    // Re-import into a brand new project — names + structure must survive.
    const newPrj = randomUUID()
    const db = getDb()
    const wsRow = db.prepare('SELECT id FROM workspaces LIMIT 1').get() as { id: string }
    const now = Date.now()
    db.prepare(
      `INSERT INTO projects (id, workspace_id, name, description, type, sort_order, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(newPrj, wsRow.id, 'RT', null, 'http', 0, now, now)

    const r2 = await importInsomnia(newPrj, exported)
    expect(r2.success).toBe(true)
    expect(r2.folderCount).toBe(2)

    const eps = db
      .prepare('SELECT name, method, request_schema FROM endpoints WHERE project_id = ?')
      .all(newPrj) as Array<{ name: string; method: string; request_schema: string }>
    const byName: Record<string, { method: string; schema: Record<string, unknown> }> = {}
    for (const e of eps)
      byName[e.name] = { method: e.method, schema: JSON.parse(e.request_schema) }

    expect(byName['Bearer'].method).toBe('GET')
    expect(byName['Bearer'].schema.auth).toEqual({
      type: 'bearer',
      bearer: { token: 'abc', prefix: 'Bearer' },
    })
    expect((byName['Create item'].schema.body as { type: string }).type).toBe('json')

    // The file-field must round-trip: after re-import the formData entry
    // still carries type=file + filePath. (Pre-fix this collapsed to text.)
    const upload = byName['Upload'].schema.body as {
      formData: Array<{ key: string; type?: string; filePath?: string }>
    }
    const file = upload.formData.find((f) => f.key === 'file')!
    expect(file.type).toBe('file')
    expect(file.filePath).toBe('/var/data/report.pdf')
  })
})

// ─── Edge cases — bad shapes shouldn't crash ───────────────

describe('importInsomnia v4 edge cases', () => {
  it('handles missing parentId on a request (puts it at root)', async () => {
    const doc = {
      _type: 'export',
      __export_format: 4,
      resources: [
        { _id: 'wrk', _type: 'workspace', name: 'WS' },
        {
          _id: 'r1',
          _type: 'request',
          name: 'Orphan',
          method: 'GET',
          url: 'https://x.test',
        },
      ],
    }
    const r = await importInsomnia(projectId, JSON.stringify(doc))
    expect(r.success).toBe(true)
    expect(r.endpointCount).toBe(1)
    const db = getDb()
    const row = db
      .prepare('SELECT folder_id FROM endpoints WHERE project_id = ?')
      .get(projectId) as { folder_id: string | null }
    expect(row.folder_id).toBeNull()
  })

  it('synthesizes a name when request.name is missing', async () => {
    const doc = {
      _type: 'export',
      __export_format: 4,
      resources: [
        { _id: 'wrk', _type: 'workspace', name: 'WS' },
        { _id: 'r1', _type: 'request', method: 'GET', url: 'https://x.test/a' },
      ],
    }
    await importInsomnia(projectId, JSON.stringify(doc))
    const db = getDb()
    const row = db.prepare('SELECT name FROM endpoints WHERE project_id = ?').get(projectId) as {
      name: string
    }
    expect(row.name.length).toBeGreaterThan(0)
    expect(row.name.toUpperCase()).toContain('GET')
  })

  it('does not crash on null/undefined entries in resources', async () => {
    const doc = {
      _type: 'export',
      __export_format: 4,
      resources: [
        null,
        undefined,
        { _id: 'wrk', _type: 'workspace', name: 'WS' },
        { _id: 'r1', _type: 'request', name: 'OK', method: 'GET', url: 'https://x.test' },
      ],
    }
    const r = await importInsomnia(projectId, JSON.stringify(doc))
    expect(r.success).toBe(true)
    expect(r.endpointCount).toBe(1)
  })

  it('does not crash on request_group with missing _id', async () => {
    const doc = {
      _type: 'export',
      __export_format: 4,
      resources: [
        { _id: 'wrk', _type: 'workspace', name: 'WS' },
        { _type: 'request_group', name: 'NoId' },
        { _id: 'r1', _type: 'request', name: 'OK', method: 'GET', url: 'https://x.test' },
      ],
    }
    const r = await importInsomnia(projectId, JSON.stringify(doc))
    expect(r.success).toBe(true)
    // Folder lacking _id is skipped gracefully.
    expect(r.folderCount).toBe(0)
    expect(r.endpointCount).toBe(1)
  })

  it('imports environment with secret-keyed object data shape', async () => {
    const doc = {
      _type: 'export',
      __export_format: 4,
      resources: [
        { _id: 'wrk', _type: 'workspace', name: 'WS' },
        {
          _id: 'env1',
          _type: 'environment',
          parentId: 'wrk',
          name: 'Prod',
          data: { token: 'sk-xxxxx', refresh: 'sk-yyy' },
        },
      ],
    }
    const r = await importInsomnia(projectId, JSON.stringify(doc))
    expect(r.success).toBe(true)
    expect(r.suggestedEnvVars).toMatchObject({ token: 'sk-xxxxx', refresh: 'sk-yyy' })
  })

  it('rejects non-JSON, non-YAML content with a friendly error', async () => {
    const r = await importInsomnia(projectId, '\x00\x01\x02not-a-doc{[}')
    expect(r.success).toBe(false)
    expect(r.error ?? '').toMatch(/insomnia|json|yaml/i)
  })
})

// ─── v5 environment YAML (v1.3.1 M12 — routed to the wrong importer) ──

describe('importInsomnia — wrong-file-type guard', () => {
  // v1.4.6: importInsomnia now rejects Insomnia v5 environment exports
  // outright with a generic "wrong file type" error. Env-only files go
  // through the dedicated `import:insomniaEnvironment` IPC, called from
  // the EnvironmentModal. APIs Import stays collection-only.
  it('rejects an Insomnia v5 environment YAML with a generic error', async () => {
    const yaml = [
      'type: environment.insomnia.rest/5.0',
      'name: mehmet',
      'data:',
      '  test: asdasdasd',
    ].join('\n')
    const r = await importInsomnia(projectId, yaml)
    expect(r.success).toBe(false)
    expect(r.error).toMatch(/not an Insomnia request collection/i)
    // No env row was created — APIs Import shouldn't touch environments.
    const env = getDb()
      .prepare('SELECT id FROM environments WHERE project_id = ?')
      .all(projectId) as Array<{ id: string }>
    expect(env).toHaveLength(0)
  })
})

// ─── Script shim coverage on the wider Insomnia surface ────

describe('normalizeInsomniaScript covers the full insomnia.* surface', () => {
  it('rewrites cookies/vault/sendRequest/info via the catch-all', () => {
    const out = normalizeInsomniaScript(
      "insomnia.cookies.jar(); insomnia.vault.get('k'); insomnia.sendRequest('u'); insomnia.info.requestName;",
    )
    expect(out).toContain('pm.cookies.jar()')
    expect(out).toContain("pm.vault.get('k')")
    expect(out).toContain("pm.sendRequest('u')")
    expect(out).toContain('pm.info.requestName')
    expect(out).not.toContain('insomnia.')
  })
})

// ─── Pure-helper sanity — assert mappers stay null/void aware ──

describe('helper round-trip via mappers', () => {
  it('apikey + addTo=header default', () => {
    expect(mapInsomniaAuthToUi({ type: 'apikey', key: 'k', value: 'v' })).toEqual({
      type: 'api-key',
      apiKey: { key: 'k', value: 'v', in: 'header' },
    })
  })
  it('unknown auth returns null (no leaking {type:none})', () => {
    expect(mapInsomniaAuthToUi({ type: 'awsv4' })).toBeNull()
  })
  it('binary mime falls back to none/text without throwing', () => {
    expect(mapInsomniaBodyToUi({ mimeType: 'application/octet-stream' })).toEqual({ type: 'none' })
  })
})
