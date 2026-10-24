/**
 * Issue #277 — Postman v2.1 export additions:
 *  - `info._postman_id` is the project id (stable across exports, so Postman
 *    updates the same collection instead of adding a copy);
 *  - saved examples ride as `response[]`, each with its own `originalRequest`;
 *  - request settings (issue #185) ride as `protocolProfileBehavior`;
 *  - AWS Signature and Hawk auth are exported (they were dropped to "No auth");
 *  - the export re-imports with the examples, settings and auth intact.
 *
 * Fail-before: v2.1 export had no `_postman_id`, no `response[]`, no
 * `protocolProfileBehavior`, and AWS/Hawk became `noauth`.
 */
import { describe, it, expect, beforeAll, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'testnizer-pmv21-277-'))
type Handler = (event: unknown, ...args: unknown[]) => unknown
const ipcHandlers = new Map<string, Handler>()

vi.mock('electron', () => ({
  app: { getPath: (): string => tmpDir },
  ipcMain: {
    handle: (channel: string, fn: Handler): void => {
      ipcHandlers.set(channel, fn)
    },
  },
  dialog: {},
  safeStorage: {
    isEncryptionAvailable: (): boolean => false,
    encryptString: (s: string): Buffer => Buffer.from(s),
    decryptString: (b: Buffer): string => b.toString(),
  },
}))
vi.mock('../../src/main/protocols/grpc.engine', () => ({ loadProto: () => Promise.resolve({}) }))

import { initDatabase, getDb } from '../../src/main/db/database'
import { registerImportExportHandlers } from '../../src/main/ipc/import-export.handler'

type Res = { success: boolean; data?: unknown; error?: string }
async function call(channel: string, ...args: unknown[]): Promise<Res> {
  return (await ipcHandlers.get(channel)!({}, ...args)) as Res
}

let workspaceId = ''
let seq = 0
function newProject(): string {
  const id = `pmv21-277-${++seq}`
  const now = Date.now()
  getDb()
    .prepare(
      `INSERT INTO projects (id, workspace_id, name, description, type, sort_order, created_at, updated_at)
       VALUES (?, ?, 'Shop', NULL, 'http', 0, ?, ?)`,
    )
    .run(id, workspaceId, now, now)
  return id
}

function addEndpoint(
  pid: string,
  name: string,
  schema: Record<string, unknown>,
  order: number,
): string {
  const id = randomUUID()
  const now = Date.now()
  getDb()
    .prepare(
      `INSERT INTO endpoints (id, project_id, folder_id, name, description, protocol, method, path, status, request_schema, response_schemas, sort_order, created_at, updated_at)
       VALUES (?, ?, NULL, ?, NULL, 'http', ?, '/x', 'developing', ?, NULL, ?, ?, ?)`,
    )
    .run(id, pid, name, String(schema.method ?? 'GET'), JSON.stringify(schema), order, now, now)
  return id
}

let exampleClock = Date.now()
function addExample(
  ownerId: string,
  name: string,
  status: number,
  body: string,
  configured: Record<string, unknown>,
): void {
  const now = ++exampleClock
  getDb()
    .prepare(
      `INSERT INTO saved_responses (id, project_id, owner_type, owner_id, name, status_code, method, url, response_json, request_json, created_at)
       VALUES (?, (SELECT project_id FROM endpoints WHERE id = ?), 'endpoint', ?, ?, ?, 'GET', ?, ?, ?, ?)`,
    )
    .run(
      randomUUID(),
      ownerId,
      ownerId,
      name,
      status,
      String(configured.url ?? ''),
      JSON.stringify({
        status,
        statusText: status === 200 ? 'OK' : 'Not Found',
        headers: { 'Content-Type': 'application/json' },
        body,
        timing: { total: 12 },
      }),
      JSON.stringify({ configured }),
      now,
    )
}

type PmItem = {
  name: string
  request: { auth?: { type: string; [k: string]: unknown } }
  response?: Array<{
    name: string
    code: number
    status: string
    body: string
    originalRequest: { url: { raw: string } }
    _postman_previewlanguage: string
    responseTime?: number
  }>
  protocolProfileBehavior?: Record<string, unknown>
}

let pid = ''
let doc: { info: { _postman_id?: string }; item: PmItem[] } = { info: {}, item: [] }

beforeAll(async () => {
  initDatabase()
  registerImportExportHandlers()
  workspaceId = (getDb().prepare('SELECT id FROM workspaces LIMIT 1').get() as { id: string }).id
  pid = newProject()
  const list = addEndpoint(
    pid,
    'List',
    {
      url: 'https://shop.test/items?page=1',
      method: 'GET',
      params: [{ id: 'p', key: 'page', value: '1', enabled: true }],
      headers: [],
      body: { type: 'none' },
      auth: { type: 'inherit' },
      followRedirects: false,
      maxRedirects: 3,
      sslVerification: false,
    },
    0,
  )
  addExample(list, 'Found', 200, '[{"id":1}]', {
    method: 'GET',
    url: 'https://shop.test/items?page=2',
    params: [{ key: 'page', value: '2', enabled: true }],
    headers: [{ key: 'Accept', value: 'application/json', enabled: true }],
  })
  addExample(list, 'Missing', 404, '{"error":"nope"}', {
    method: 'GET',
    url: 'https://shop.test/items?page=99',
    params: [{ key: 'page', value: '99', enabled: true }],
    headers: [],
  })
  addEndpoint(
    pid,
    'AWS',
    {
      url: 'https://s3.test/b',
      method: 'GET',
      auth: {
        type: 'aws-signature',
        awsSignature: {
          accessKey: '{{ak}}',
          secretKey: '{{sk}}',
          region: 'eu-west-1',
          service: 's3',
        },
      },
    },
    1,
  )
  addEndpoint(
    pid,
    'Hawk',
    {
      url: 'https://h.test/',
      method: 'GET',
      auth: { type: 'hawk', hawk: { authId: 'me', authKey: '{{hk}}', algorithm: 'sha1' } },
    },
    2,
  )
  const res = await call('export:postman', pid)
  expect(res.success, res.error).toBe(true)
  doc = JSON.parse(res.data as string)
})

const item = (name: string): PmItem => doc.item.find((i) => i.name === name)!

describe('issue #277 — Postman v2.1 export additions', () => {
  it('info._postman_id is the project id, the same on every export', async () => {
    expect(doc.info._postman_id).toBe(pid)
    const again = JSON.parse((await call('export:postman', pid)).data as string)
    expect(again.info._postman_id).toBe(pid)
  })

  it('saved examples ride as response[] with their own originalRequest', () => {
    const r = item('List').response!
    expect(r.map((x) => [x.name, x.code, x.status])).toEqual([
      ['Found', 200, 'OK'],
      ['Missing', 404, 'Not Found'],
    ])
    expect(r[0].originalRequest.url.raw).toBe('https://shop.test/items?page=2')
    expect(r[1].originalRequest.url.raw).toBe('https://shop.test/items?page=99')
    expect(r[0].body).toBe('[{"id":1}]')
    expect(r[0]._postman_previewlanguage).toBe('json')
    expect(r[0].responseTime).toBe(12)
    expect(item('AWS').response ?? []).toEqual([])
  })

  it('request settings ride as protocolProfileBehavior (only when set)', () => {
    expect(item('List').protocolProfileBehavior).toEqual({
      followRedirects: false,
      maxRedirects: 3,
      strictSSL: false,
    })
    expect(item('AWS').protocolProfileBehavior).toBeUndefined()
  })

  it('AWS Signature and Hawk are exported in Postman shape', () => {
    const aws = item('AWS').request.auth!
    expect(aws.type).toBe('awsv4')
    expect(aws.awsv4).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: 'accessKey', value: '{{ak}}' }),
        expect.objectContaining({ key: 'region', value: 'eu-west-1' }),
        expect.objectContaining({ key: 'service', value: 's3' }),
      ]),
    )
    const hawk = item('Hawk').request.auth!
    expect(hawk.type).toBe('hawk')
    expect(hawk.hawk).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: 'authId', value: 'me' }),
        expect.objectContaining({ key: 'algorithm', value: 'sha1' }),
      ]),
    )
  })

  it('re-imports with examples, settings and auth intact', async () => {
    const back = newProject()
    const res = await call('import:postman', {
      projectId: back,
      content: JSON.stringify(doc),
      folderId: null,
    })
    expect((res.data as { success: boolean }).success).toBe(true)
    const db = getDb()
    const rows = db
      .prepare(
        'SELECT id, name, request_schema FROM endpoints WHERE project_id = ? ORDER BY sort_order',
      )
      .all(back) as Array<{ id: string; name: string; request_schema: string }>
    const byName = new Map(
      rows.map((r) => [r.name, { id: r.id, schema: JSON.parse(r.request_schema) }]),
    )
    const list = byName.get('List')!
    expect(list.schema).toMatchObject({
      followRedirects: false,
      maxRedirects: 3,
      sslVerification: false,
    })
    const ex = db
      .prepare(
        'SELECT name, status_code, request_json FROM saved_responses WHERE owner_id = ? ORDER BY created_at',
      )
      .all(list.id) as Array<{ name: string; status_code: number; request_json: string }>
    expect(ex.map((e) => [e.name, e.status_code])).toEqual([
      ['Found', 200],
      ['Missing', 404],
    ])
    expect(JSON.parse(ex[0].request_json).configured.url).toBe('https://shop.test/items?page=2')
    expect(byName.get('AWS')!.schema.auth).toEqual({
      type: 'aws-signature',
      awsSignature: {
        accessKey: '{{ak}}',
        secretKey: '{{sk}}',
        region: 'eu-west-1',
        service: 's3',
      },
    })
    expect(byName.get('Hawk')!.schema.auth).toEqual({
      type: 'hawk',
      hawk: { authId: 'me', authKey: '{{hk}}', algorithm: 'sha1' },
    })
  })
})
