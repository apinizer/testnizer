/**
 * Issue #197 — requests saved with Ctrl+S live in `saved_requests`, but the
 * Postman / Insomnia / OpenAPI exports read only `endpoints`, so a saved
 * request vanished from every collection file without notice.
 *
 * Round trip per format: a saved request (params, headers, body, auth,
 * scripts) in a folder → export → it is in the file under that folder →
 * import into another project → it is there again. A saved MCP request
 * (which none of these formats can carry) is NOT in the file and is reported
 * in `skipped` instead of being dropped silently. Secret variables stay ''
 * (issue #177).
 *
 * Real schema (`initDatabase`) in a temp userData dir; IPC handlers captured
 * from `registerImportExportHandlers` so the channels the renderer calls are
 * exercised, not just the helpers.
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest'
import { mkdtempSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

const tmpDir = mkdtempSync(path.join(os.tmpdir(), 'testnizer-export-saved-'))

type Handler = (event: unknown, ...args: unknown[]) => unknown
const ipcHandlers = new Map<string, Handler>()

vi.mock('electron', () => ({
  app: { getPath: (_: string): string => tmpDir },
  ipcMain: {
    handle: (channel: string, fn: Handler): void => {
      ipcHandlers.set(channel, fn)
    },
  },
  dialog: {},
  safeStorage: { isEncryptionAvailable: (): boolean => false },
}))

vi.mock('../../src/main/protocols/grpc.engine', () => ({
  loadProto: () => Promise.resolve({}),
}))

import { initDatabase, getDb } from '../../src/main/db/database'
import { createSavedRequest } from '../../src/main/db/endpoint.repo'
import {
  registerImportExportHandlers,
  buildPostmanSuiteExport,
  buildInsomniaSuiteExport,
  openApiPathAndQuery,
} from '../../src/main/ipc/import-export.handler'
import type { ExportSkippedItem } from '../../src/shared/collection-export'

interface ExportIpc {
  success: boolean
  data?: string
  skipped?: ExportSkippedItem[]
  error?: string
}

const SECRET = 'tok-s3cret-value'
let workspaceId: string
let projectId: string
let folderId: string

beforeAll(() => {
  initDatabase()
  registerImportExportHandlers()
})

function newProject(name: string): string {
  const db = getDb()
  const now = Date.now()
  const id = randomUUID()
  db.prepare(
    `INSERT INTO projects (id, workspace_id, name, description, type, sort_order, created_at, updated_at)
     VALUES (?, ?, ?, NULL, 'http', 0, ?, ?)`,
  ).run(id, workspaceId, name, now, now)
  return id
}

/** What Ctrl+S writes for a new HTTP request (save-active-request.ts → savedRequest:create). */
function saveHttpRequest(): void {
  createSavedRequest({
    project_id: projectId,
    folder_id: folderId,
    name: 'Create user',
    protocol: 'http',
    method: 'POST',
    // The editor URL carries the query string and `params` lists it too.
    url: '{{baseUrl}}/users?verbose=1',
    params: JSON.stringify([{ id: 'p1', key: 'verbose', value: '1', enabled: true }]),
    headers: JSON.stringify([{ id: 'h1', key: 'X-Trace', value: 'abc', enabled: true }]),
    body: JSON.stringify({ type: 'json', content: '{"name":"Ada"}' }),
    auth: JSON.stringify({ type: 'bearer', bearer: { token: '{{apiToken}}' } }),
    pre_script: "pm.variables.set('who', 'ada')",
    post_script: "pm.test('created', () => pm.response.to.have.status(201))",
    metadata: JSON.stringify({ timeout: 15_000 }),
  })
}

/** What Ctrl+S writes for an MCP request — no collection format can carry it. */
function saveMcpRequest(): void {
  createSavedRequest({
    project_id: projectId,
    folder_id: folderId,
    name: 'Ping MCP',
    protocol: 'mcp',
    method: 'GET',
    url: 'http://localhost:3999/mcp',
    metadata: JSON.stringify({
      mcp: { transport: 'streamable-http', url: 'http://localhost:3999/mcp' },
    }),
  })
}

async function exportVia(channel: string, pid: string): Promise<ExportIpc> {
  const handler = ipcHandlers.get(channel)
  if (!handler) throw new Error(`no handler for ${channel}`)
  return (await handler({}, pid)) as ExportIpc
}

async function importVia(channel: string, pid: string, content: string): Promise<void> {
  const handler = ipcHandlers.get(channel)
  if (!handler) throw new Error(`no handler for ${channel}`)
  const res = (await handler({}, { projectId: pid, content, format: 'openapi' })) as {
    success: boolean
    error?: string
  }
  expect(res.error).toBeUndefined()
  expect(res.success).toBe(true)
}

/** Imported rows of a project with their folder name. */
function importedRows(pid: string): Array<{ name: string; method: string; folder: string | null }> {
  return getDb()
    .prepare(
      `SELECT e.name AS name, e.method AS method, f.name AS folder
       FROM endpoints e LEFT JOIN folders f ON f.id = e.folder_id WHERE e.project_id = ?`,
    )
    .all(pid) as Array<{ name: string; method: string; folder: string | null }>
}

const MCP_SKIPPED: ExportSkippedItem = {
  name: 'Ping MCP',
  protocol: 'mcp',
  reason: 'unsupported-protocol',
}

beforeEach(() => {
  const db = getDb()
  const now = Date.now()
  workspaceId = (db.prepare('SELECT id FROM workspaces LIMIT 1').get() as { id: string }).id
  projectId = newProject('Saved Export')
  folderId = randomUUID()
  db.prepare(
    `INSERT INTO folders (id, project_id, parent_id, name, sort_order) VALUES (?, ?, NULL, 'Users', 0)`,
  ).run(folderId, projectId)

  const envId = randomUUID()
  db.prepare(
    `INSERT INTO environments (id, workspace_id, project_id, name, is_active, created_at, updated_at)
     VALUES (?, ?, ?, 'Dev', 1, ?, ?)`,
  ).run(envId, workspaceId, projectId, now, now)
  const insVar = db.prepare(
    `INSERT INTO environment_variables (id, environment_id, key, value, initial_value, enabled, secret)
     VALUES (?, ?, ?, ?, ?, 1, ?)`,
  )
  insVar.run(
    randomUUID(),
    envId,
    'baseUrl',
    'https://api.example.com',
    'https://api.example.com',
    0,
  )
  insVar.run(randomUUID(), envId, 'apiToken', SECRET, SECRET, 1)

  saveHttpRequest()
  saveMcpRequest()
})

describe('issue #197 — Postman export carries saved requests', () => {
  it('puts the saved request in its folder with params/headers/body/auth/scripts, reports MCP, round-trips', async () => {
    const res = await exportVia('export:postman', projectId)
    expect(res.success).toBe(true)
    const col = JSON.parse(res.data ?? '{}') as {
      item: Array<{
        name: string
        item?: Array<{
          name: string
          request: {
            method: string
            header: Array<{ key: string; value: string }>
            url: { raw?: string; query?: Array<{ key: string; value: string }> }
            body?: { mode: string; raw?: string }
            auth?: { type: string }
          }
          event?: Array<{ listen: string; script: { exec: string[] } }>
          'x-apinizer'?: { timeoutSeconds?: number }
        }>
      }>
      variable?: Array<{ key: string; value: string; type?: string }>
    }
    const folder = col.item.find((i) => i.name === 'Users')
    expect(folder).toBeDefined()
    const item = folder?.item?.find((i) => i.name === 'Create user')
    expect(item).toBeDefined()
    expect(item?.request.method).toBe('POST')
    expect(item?.request.header).toEqual([
      expect.objectContaining({ key: 'X-Trace', value: 'abc' }),
    ])
    expect(item?.request.url.query).toEqual([
      expect.objectContaining({ key: 'verbose', value: '1' }),
    ])
    expect(item?.request.body).toMatchObject({ mode: 'raw', raw: '{"name":"Ada"}' })
    expect(item?.request.auth?.type).toBe('bearer')
    expect(item?.event?.map((e) => e.listen)).toEqual(['prerequest', 'test'])
    expect(item?.['x-apinizer']?.timeoutSeconds).toBe(15)

    // MCP is not in the file — it is reported instead.
    expect(res.data).not.toContain('Ping MCP')
    expect(res.skipped).toEqual([MCP_SKIPPED])

    // Issue #177 — a secret variable keeps its key, never its value.
    expect(res.data).not.toContain(SECRET)
    expect(col.variable?.find((v) => v.key === 'apiToken')).toMatchObject({ value: '' })

    const target = newProject('Postman Target')
    await importVia('import:postman', target, res.data ?? '')
    expect(importedRows(target)).toContainEqual({
      name: 'Create user',
      method: 'POST',
      folder: 'Users',
    })
  })
})

describe('issue #197 — Insomnia export carries saved requests', () => {
  it('puts the saved request under its request_group, reports MCP, round-trips', async () => {
    const res = await exportVia('export:insomnia', projectId)
    expect(res.success).toBe(true)
    const doc = JSON.parse(res.data ?? '{}') as {
      resources: Array<{
        _id: string
        _type: string
        parentId?: string
        name: string
        method?: string
        url?: string
        headers?: Array<{ name: string; value: string }>
        parameters?: Array<{ name: string; value: string }>
        body?: { mimeType?: string; text?: string }
        authentication?: { type: string }
        preRequestScript?: string
        afterResponseScript?: string
      }>
    }
    const group = doc.resources.find((r) => r._type === 'request_group' && r.name === 'Users')
    const req = doc.resources.find((r) => r._type === 'request' && r.name === 'Create user')
    expect(group).toBeDefined()
    expect(req?.parentId).toBe(group?._id)
    expect(req?.method).toBe('POST')
    // Insomnia appends `parameters` itself — the query is not sent twice.
    expect(req?.url).toBe('{{baseUrl}}/users')
    expect(req?.headers).toEqual([{ name: 'X-Trace', value: 'abc' }])
    expect(req?.parameters).toEqual([{ name: 'verbose', value: '1' }])
    expect(req?.body).toMatchObject({ mimeType: 'application/json', text: '{"name":"Ada"}' })
    expect(req?.authentication?.type).toBe('bearer')
    expect(req?.preRequestScript).toContain("pm.variables.set('who'")
    expect(req?.afterResponseScript).toContain("pm.test('created'")

    expect(res.data).not.toContain('Ping MCP')
    expect(res.skipped).toEqual([MCP_SKIPPED])

    const target = newProject('Insomnia Target')
    await importVia('import:insomnia', target, res.data ?? '')
    expect(importedRows(target)).toContainEqual({
      name: 'Create user',
      method: 'POST',
      folder: 'Users',
    })
  })
})

describe('issue #197 — OpenAPI export carries saved requests', () => {
  it('emits the saved request as an operation tagged with its folder, reports MCP, round-trips', async () => {
    const res = await exportVia('export:openApi', projectId)
    expect(res.success).toBe(true)
    const spec = JSON.parse(res.data ?? '{}') as {
      paths: Record<
        string,
        Record<
          string,
          {
            summary: string
            tags?: string[]
            parameters?: Array<{ name: string; in: string }>
            requestBody?: { content: Record<string, unknown> }
          }
        >
      >
    }
    expect(Object.keys(spec.paths)).not.toContain('/users?verbose=1')
    const op = spec.paths['/users']?.post
    expect(op?.summary).toBe('Create user')
    expect(op?.tags).toEqual(['Users'])
    expect(op?.parameters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'verbose', in: 'query' }),
        expect.objectContaining({ name: 'X-Trace', in: 'header' }),
      ]),
    )
    expect(op?.requestBody?.content['application/json']).toBeDefined()

    expect(res.data).not.toContain('Ping MCP')
    expect(res.skipped).toEqual([MCP_SKIPPED])

    const target = newProject('OpenAPI Target')
    await importVia('import:openApi', target, res.data ?? '')
    expect(importedRows(target)).toContainEqual({
      name: 'Create user',
      method: 'POST',
      folder: 'Users',
    })
  })

  it('reports a second item on the same path + method instead of overwriting it', async () => {
    const db = getDb()
    const now = Date.now()
    db.prepare(
      `INSERT INTO endpoints (id, project_id, folder_id, name, protocol, method, path, status,
         request_schema, sort_order, created_at, updated_at)
       VALUES (?, ?, ?, 'Create user (imported)', 'http', 'POST', '{{baseUrl}}/users', 'developing', ?, 0, ?, ?)`,
    ).run(randomUUID(), projectId, folderId, JSON.stringify({ url: '{{baseUrl}}/users' }), now, now)

    const res = await exportVia('export:openApi', projectId)
    const spec = JSON.parse(res.data ?? '{}') as {
      paths: Record<string, Record<string, { summary: string }>>
    }
    expect(spec.paths['/users']?.post?.summary).toBe('Create user (imported)')
    expect(res.skipped).toEqual([
      MCP_SKIPPED,
      { name: 'Create user', protocol: 'http', reason: 'duplicate-operation' },
    ])
  })
})

type OpenApiParam = { name: string; in: string; required?: boolean; schema?: { default?: unknown } }
type OpenApiSpec = { paths: Record<string, Record<string, { parameters?: OpenApiParam[] }>> }

/** Insert an endpoints row (imported / created endpoint, not a Ctrl+S save). */
function insertEndpoint(name: string, method: string, url: string, schema?: unknown): void {
  const now = Date.now()
  getDb()
    .prepare(
      `INSERT INTO endpoints (id, project_id, folder_id, name, protocol, method, path, status,
         request_schema, sort_order, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'http', ?, ?, 'developing', ?, 0, ?, ?)`,
    )
    .run(
      randomUUID(),
      projectId,
      folderId,
      name,
      method,
      url,
      schema === undefined ? null : JSON.stringify(schema),
      now,
      now,
    )
}

describe('issue #197 — OpenAPI export turns {{var}} path segments into path parameters', () => {
  it('saved request {{baseUrl}}/users/{{id}} → /users/{id} with a required path param `id`', async () => {
    createSavedRequest({
      project_id: projectId,
      folder_id: folderId,
      name: 'Get user',
      protocol: 'http',
      method: 'GET',
      url: '{{baseUrl}}/users/{{id}}',
      params: '[]',
    })
    const res = await exportVia('export:openApi', projectId)
    expect(res.success).toBe(true)
    const spec = JSON.parse(res.data ?? '{}') as OpenApiSpec
    expect(Object.keys(spec.paths)).not.toContain('/users/{{id}}')
    const params = spec.paths['/users/{id}']?.get?.parameters ?? []
    expect(params).toContainEqual({
      name: 'id',
      in: 'path',
      required: true,
      schema: { type: 'string' },
    })
    expect(params.map((p) => p.name)).not.toContain('{id')
    // The leading host variable is the server, not a path parameter.
    expect(params.map((p) => p.name)).not.toContain('baseUrl')
  })

  it('endpoint rows get the same treatment — with a full URL and without a request_schema', async () => {
    insertEndpoint('List members', 'GET', '{{baseUrl}}/orgs/{{orgId}}/members')
    insertEndpoint('Get item', 'GET', 'https://api.example.com/items/{{itemId}}', {
      url: 'https://api.example.com/items/{{itemId}}',
    })
    const res = await exportVia('export:openApi', projectId)
    const spec = JSON.parse(res.data ?? '{}') as OpenApiSpec

    const members = spec.paths['/orgs/{orgId}/members']?.get?.parameters ?? []
    expect(members).toContainEqual(
      expect.objectContaining({ name: 'orgId', in: 'path', required: true }),
    )
    const item = spec.paths['/items/{itemId}']?.get?.parameters ?? []
    expect(item).toContainEqual(
      expect.objectContaining({ name: 'itemId', in: 'path', required: true }),
    )
    const allNames = Object.values(spec.paths)
      .flatMap((ops) => Object.values(ops))
      .flatMap((op) => op.parameters ?? [])
      .map((p) => p.name)
    expect(allNames.filter((n) => n.includes('{') || n.includes('}'))).toEqual([])
  })
})

describe('issue #197 — OpenAPI export keeps the URL query string as query parameters', () => {
  it('emits ?q=…&limit=… from the URL when the row has no params rows', async () => {
    createSavedRequest({
      project_id: projectId,
      folder_id: folderId,
      name: 'Search users',
      protocol: 'http',
      method: 'GET',
      url: '{{baseUrl}}/search?q=ada%20lovelace&limit={{pageSize}}',
      params: '[]',
    })
    insertEndpoint('List items', 'GET', 'https://api.example.com/items?page=2&sort=asc', {
      url: 'https://api.example.com/items?page=2&sort=asc',
    })
    const res = await exportVia('export:openApi', projectId)
    const spec = JSON.parse(res.data ?? '{}') as OpenApiSpec

    const search = spec.paths['/search']?.get?.parameters ?? []
    expect(search).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'q',
          in: 'query',
          schema: expect.objectContaining({ default: 'ada lovelace' }),
        }),
        expect.objectContaining({
          name: 'limit',
          in: 'query',
          schema: expect.objectContaining({ default: '{{pageSize}}' }),
        }),
      ]),
    )
    const items = spec.paths['/items']?.get?.parameters ?? []
    expect(items.filter((p) => p.in === 'query').map((p) => p.name)).toEqual(['page', 'sort'])
  })

  it('does not duplicate a key listed both in params and in the URL, and adds URL-only keys', async () => {
    // saveHttpRequest() (beforeEach) has url `{{baseUrl}}/users?verbose=1` AND a `verbose` params row.
    insertEndpoint('Patch user', 'PATCH', '{{baseUrl}}/users?verbose=1&dryRun=true', {
      url: '{{baseUrl}}/users?verbose=1&dryRun=true',
      params: [
        { id: 'p1', key: 'verbose', value: '1', enabled: true },
        { id: 'p2', key: 'debug', value: '1', enabled: false },
      ],
    })
    const res = await exportVia('export:openApi', projectId)
    const spec = JSON.parse(res.data ?? '{}') as OpenApiSpec

    const post = spec.paths['/users']?.post?.parameters ?? []
    expect(post.filter((p) => p.in === 'query').map((p) => p.name)).toEqual(['verbose'])
    const patch = spec.paths['/users']?.patch?.parameters ?? []
    expect(patch.filter((p) => p.in === 'query').map((p) => p.name)).toEqual(['verbose', 'dryRun'])
  })
})

describe('openApiPathAndQuery', () => {
  it.each([
    ['{{baseUrl}}/users/{{id}}', '/users/{id}', []],
    ['{{ baseUrl }}/users/{{ id }}/posts', '/users/{id}/posts', []],
    [
      'https://{{host}}/v1/{id}?a=1&b',
      '/v1/{id}',
      [
        { key: 'a', value: '1' },
        { key: 'b', value: '' },
      ],
    ],
    ['/pets/{petId}?x=%2F#frag', '/pets/{petId}', [{ key: 'x', value: '/' }]],
    ['{{baseUrl}}', '/', []],
    ['', '/', []],
  ])('%s → %s', (input, path, query) => {
    expect(openApiPathAndQuery(input)).toEqual({ path, query })
  })
})

describe('issue #197 — saved GraphQL request keeps its query', () => {
  it('exports the saved query + variables as a Postman graphql body', async () => {
    createSavedRequest({
      project_id: projectId,
      folder_id: null,
      name: 'Countries',
      protocol: 'graphql',
      method: 'POST',
      url: 'https://countries.example.com/graphql',
      body: JSON.stringify({ type: 'graphql', content: '{ countries { code } }' }),
      metadata: JSON.stringify({
        graphql: {
          query: '{ countries { code } }',
          variables: '{"n":1}',
          headers: [
            { id: 'g1', key: 'Authorization', value: 'Bearer {{gqlToken}}', enabled: true },
          ],
        },
      }),
    })
    const res = await exportVia('export:postman', projectId)
    const col = JSON.parse(res.data ?? '{}') as {
      item: Array<{
        name: string
        request?: {
          header: Array<{ key: string; value: string }>
          body?: { mode: string; graphql?: { query: string; variables: string } }
        }
      }>
    }
    const item = col.item.find((i) => i.name === 'Countries')
    expect(item?.request?.body).toEqual({
      mode: 'graphql',
      graphql: { query: '{ countries { code } }', variables: '{"n":1}' },
    })
    // The GraphQL editor's headers live in metadata, not the headers column.
    expect(item?.request?.header).toEqual([
      expect.objectContaining({ key: 'Authorization', value: 'Bearer {{gqlToken}}' }),
    ])
  })
})

describe('issue #197 — saved SOAP request keeps its transport headers', () => {
  it('exports SOAPAction + Content-Type derived from the saved SOAP metadata', async () => {
    createSavedRequest({
      project_id: projectId,
      folder_id: null,
      name: 'GetQuote',
      protocol: 'soap',
      method: 'POST',
      url: 'https://soap.example.com/quotes',
      body: JSON.stringify({ type: 'xml', content: '<soap:Envelope/>' }),
      metadata: JSON.stringify({
        soap: { mode: 'manual', manualSoapAction: 'urn:GetQuote', manualSoapVersion: 'soap11' },
      }),
    })
    const res = await exportVia('export:postman', projectId)
    const col = JSON.parse(res.data ?? '{}') as {
      item: Array<{
        name: string
        request?: { method: string; header: Array<{ key: string; value: string }> }
      }>
    }
    const item = col.item.find((i) => i.name === 'GetQuote')
    expect(item?.request?.method).toBe('POST')
    expect(item?.request?.header).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: 'SOAPAction', value: '"urn:GetQuote"' }),
        expect.objectContaining({ key: 'Content-Type', value: 'text/xml; charset=utf-8' }),
      ]),
    )
    expect(res.skipped).toEqual([MCP_SKIPPED])
  })
})

describe('issue #197 — test suite exports report the items they cannot carry', () => {
  it('leaves the MCP / WebSocket suite items out and names them', () => {
    const db = getDb()
    const now = Date.now()
    const suiteId = randomUUID()
    db.prepare(
      `INSERT INTO test_suites (id, project_id, name, sort_order, created_at, updated_at)
       VALUES (?, ?, 'Suite', 0, ?, ?)`,
    ).run(suiteId, projectId, now, now)
    const ins = db.prepare(
      `INSERT INTO test_suite_items (id, suite_id, folder_id, protocol, name, method, url, request_schema, sort_order, created_at, updated_at)
       VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    ins.run(
      randomUUID(),
      suiteId,
      'http',
      'Health',
      'GET',
      'https://x.test/health',
      '{}',
      0,
      now,
      now,
    )
    ins.run(
      randomUUID(),
      suiteId,
      'mcp',
      'Tools list',
      'GET',
      'http://x.test/mcp',
      '{}',
      1,
      now,
      now,
    )
    ins.run(randomUUID(), suiteId, 'websocket', 'Echo', 'GET', 'wss://x.test/ws', '{}', 2, now, now)

    const expected: ExportSkippedItem[] = [
      { name: 'Tools list', protocol: 'mcp', reason: 'unsupported-protocol' },
      { name: 'Echo', protocol: 'websocket', reason: 'unsupported-protocol' },
    ]
    for (const build of [buildPostmanSuiteExport, buildInsomniaSuiteExport]) {
      const { content, skipped } = build(suiteId)
      expect(content).toContain('Health')
      expect(content).not.toContain('Tools list')
      expect(content).not.toContain('wss://x.test/ws')
      expect(skipped).toEqual(expected)
    }
  })
})
