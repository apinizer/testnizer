/**
 * Issue #276 (part 1) — every single-file Postman artifact routes through the
 * one `import:postman` entry point without a "which version?" question:
 * collection v1 (converted), v2.0, v2.1, environment, globals, legacy data
 * dump. A v3 JSON collection is imported (issue #276 part 2,
 * tests/main/import-postman-v3.test.ts); a single file out of a v3 folder is
 * refused with a pointer to "Import folder…".
 *
 * Oracle for the v1 converter: Postman's own transformer fixture (Apache-2.0,
 * tests/fixtures/postman/transformer/README.md) ships the SAME collection as
 * v1 and as the v2.0 / v2.1 its converter produced — importing our conversion
 * of the v1 file must give the same endpoints and examples as importing
 * Postman's v2.0 output (and v2.0 must equal v2.1).
 *
 * Fail-before: v1 and the legacy dump were rejected, globals were rejected by
 * both the importer and the renderer detector, a v2 collection without
 * `_postman_id` / schema was not recognised by the renderer guard, and v3
 * files fell through to generic JSON.
 */
import { describe, it, expect, beforeAll, vi } from 'vitest'
import { mkdtempSync, readFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const tmpDir = mkdtempSync(path.join(os.tmpdir(), 'testnizer-pm276b-'))
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
    isEncryptionAvailable: (): boolean => true,
    encryptString: (s: string): Buffer => Buffer.from(`k1|${s}`, 'utf-8').reverse(),
    decryptString: (b: Buffer): string => {
      const text = Buffer.from(b).reverse().toString('utf-8')
      return text.slice(text.indexOf('|') + 1)
    },
  },
}))
vi.mock('../../src/main/protocols/grpc.engine', () => ({ loadProto: () => Promise.resolve({}) }))

import { initDatabase, getDb } from '../../src/main/db/database'
import { registerImportExportHandlers } from '../../src/main/ipc/import-export.handler'
import { importLegacyDump } from '../../src/main/import/postman/dump'
import { classifyPostmanDocument, classifyPostmanText } from '../../src/shared/postman-detect'
import { detectImportFormat } from '../../src/renderer/lib/import-format-detect'

const FIX = path.join(__dirname, '..', 'fixtures', 'postman', 'transformer')
const read = (f: string): string => readFileSync(path.join(FIX, f), 'utf-8')
const V1 = read('postman-echo.v1.json')
const V2 = read('postman-echo.v2.json')
const V21 = read('postman-echo.v21.json')

let workspaceId = ''
let seq = 0
function newProject(): string {
  const id = `pm276b-${++seq}`
  const now = Date.now()
  getDb()
    .prepare(
      `INSERT INTO projects (id, workspace_id, name, description, type, sort_order, created_at, updated_at)
       VALUES (?, ?, ?, NULL, 'http', 0, ?, ?)`,
    )
    .run(id, workspaceId, id, now, now)
  return id
}

interface ImportData {
  success?: boolean
  error?: string
  endpointCount?: number
  folderCount?: number
  exampleCount?: number
  environmentName?: string
  warnings?: string[]
}
async function importText(
  projectId: string,
  content: string,
  folderId: string | null = null,
): Promise<ImportData> {
  const res = (await ipcHandlers.get('import:postman')!({}, { projectId, content, folderId })) as {
    success: boolean
    data?: ImportData
  }
  expect(res.success).toBe(true)
  return res.data ?? {}
}

/**
 * A comparable projection of what a project holds after an import.
 * `withExampleRequests: false` leaves out the examples' request side: the
 * fixture's v2.0 file carries an EMPTY `originalRequest` (`{header: []}`)
 * where our v1 converter resolves the example's saved request (url, headers)
 * — richer, not different data.
 */
function snapshot(pid: string, withExampleRequests = true): unknown {
  const db = getDb()
  const folders = db
    .prepare(
      'SELECT id, parent_id, name, auth, pre_script, post_script FROM folders WHERE project_id = ? ORDER BY sort_order',
    )
    .all(pid) as Array<{
    id: string
    parent_id: string | null
    name: string
    auth: string | null
    pre_script: string | null
    post_script: string | null
  }>
  const fname = new Map(folders.map((f) => [f.id, f.name]))
  const strip = (v: unknown): unknown =>
    JSON.parse(JSON.stringify(v), (k, val) => (k === 'id' ? undefined : val))
  const eps = (
    db
      .prepare('SELECT * FROM endpoints WHERE project_id = ? ORDER BY sort_order')
      .all(pid) as Array<{
      id: string
      name: string
      folder_id: string | null
      method: string
      path: string
      description: string | null
      request_schema: string
    }>
  ).map((e) => ({
    name: e.name,
    folder: e.folder_id ? fname.get(e.folder_id) : null,
    method: e.method,
    path: e.path,
    description: e.description,
    schema: strip(JSON.parse(e.request_schema)),
    examples: (
      db
        .prepare(
          'SELECT name, status_code, response_json, request_json FROM saved_responses WHERE owner_id = ? ORDER BY created_at',
        )
        .all(e.id) as Array<{
        name: string
        status_code: number
        response_json: string
        request_json: string
      }>
    ).map((x) => ({
      ...x,
      request_json: withExampleRequests ? strip(JSON.parse(x.request_json)) : undefined,
    })),
  }))
  return {
    folders: folders.map((f) => ({
      name: f.name,
      parent: f.parent_id ? fname.get(f.parent_id) : null,
      auth: f.auth,
      pre: f.pre_script,
      post: f.post_script,
    })),
    eps,
  }
}

beforeAll(() => {
  initDatabase()
  registerImportExportHandlers()
  workspaceId = (getDb().prepare('SELECT id FROM workspaces LIMIT 1').get() as { id: string }).id
})

describe('issue #276 — detection (one shared classifier, rules B1–B6)', () => {
  const docs: Array<[string, unknown, string | null, string?]> = [
    [
      'v2.1 by schema (getpostman host)',
      {
        info: {
          name: 'a',
          schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
        },
        item: [],
      },
      'v2-collection',
      '2.1.0',
    ],
    [
      'v2.1 by schema (postman.com draft-07 host)',
      {
        info: {
          name: 'a',
          schema: 'https://schema.postman.com/collection/json/v2.1.0/draft-07/collection.json',
        },
        item: [],
      },
      'v2-collection',
      '2.1.0',
    ],
    [
      'v2.0 by schema',
      {
        info: {
          name: 'a',
          schema: 'https://schema.getpostman.com/json/collection/v2.0.0/collection.json',
        },
        item: [],
      },
      'v2-collection',
      '2.0.0',
    ],
    [
      'v2.0 by auth shape, no schema / _postman_id',
      {
        info: { name: 'a' },
        item: [{ name: 'r', request: { auth: { type: 'basic', basic: { username: 'u' } } } }],
      },
      'v2-collection',
      '2.0.0',
    ],
    [
      'v2.1 by auth shape',
      {
        info: { name: 'a' },
        auth: { type: 'bearer', bearer: [{ key: 'token', value: 't' }] },
        item: [],
      },
      'v2-collection',
      '2.1.0',
    ],
    [
      'v1',
      { id: 'x', name: 'old', order: [], folders: [], requests: [] },
      'v1-collection',
      '1.0.0',
    ],
    ['legacy dump', { version: 1, collections: [], environments: [], globals: [] }, 'legacy-dump'],
    [
      'environment',
      { name: 'e', values: [], _postman_variable_scope: 'environment' },
      'environment',
    ],
    ['globals', { name: 'Globals', values: [], _postman_variable_scope: 'globals' }, 'globals'],
    ['v3 monolith', { $kind: 'collection', name: 'c', items: [] }, 'v3-collection', '3.0.0'],
    ['v3 definition', { $kind: 'collection', name: 'c' }, 'v3-definition'],
    ['v3 request file', { $kind: 'http-request', url: 'x' }, 'v3-request'],
    ['v3 example', { $kind: 'http-example' }, 'v3-resource'],
    ['OpenAPI is not Postman', { openapi: '3.0.0', info: { title: 't' }, paths: {} }, null],
    ['Insomnia is not Postman', { _type: 'export', resources: [] }, null],
  ]
  for (const [label, doc, kind, version] of docs) {
    it(label, () => {
      const d = classifyPostmanDocument(doc)
      expect(d?.kind ?? null).toBe(kind)
      if (version) expect(d?.version).toBe(version)
      // The renderer guard routes every Postman artifact to the Postman card.
      if (kind) expect(detectImportFormat(JSON.stringify(doc))).toBe('postman')
    })
  }

  it('recognises v3 YAML by its $kind line (renderer, no YAML parser)', () => {
    const yaml = '$kind: http-request\nname: Get\nurl: https://x\n'
    expect(classifyPostmanText(yaml)?.kind).toBe('v3-request')
    expect(detectImportFormat(yaml, 'Get.request.yaml')).toBe('postman')
  })

  it('the transformer fixtures classify as v1 / v2.0 / v2.1', () => {
    expect(classifyPostmanText(V1)).toMatchObject({ kind: 'v1-collection' })
    expect(classifyPostmanText(V2)).toMatchObject({ kind: 'v2-collection', version: '2.0.0' })
    expect(classifyPostmanText(V21)).toMatchObject({ kind: 'v2-collection', version: '2.1.0' })
  })
})

describe('issue #276 — v1 / v2.0 / v2.1 collections', () => {
  it("v1 is converted and imports exactly like Postman's own v2.0 conversion of it", async () => {
    const p1 = newProject()
    const r1 = await importText(p1, V1)
    expect(r1.success).toBe(true)
    expect(r1.endpointCount).toBe(23)
    expect(r1.exampleCount).toBe(11)
    expect(r1.warnings?.[0]).toMatch(/Converted from Postman collection v1/)

    const p2 = newProject()
    const r2 = await importText(p2, V2)
    expect(r2.endpointCount).toBe(23)
    expect(r2.exampleCount).toBe(11)
    expect(snapshot(p1, false)).toEqual(snapshot(p2, false))
    // …and the example's request side is the saved request, not empty.
    const ex = getDb()
      .prepare(
        `SELECT s.request_json FROM saved_responses s JOIN endpoints e ON e.id = s.owner_id
          WHERE e.project_id = ? AND e.name = 'Set Cookies'`,
      )
      .get(p1) as { request_json: string }
    expect(JSON.parse(ex.request_json).configured.url).toBe(
      'https://echo.postman.com/cookies/set?foo1=bar1&foo2=bar2',
    )
  })

  it('v2.0 (object auth) and v2.1 (array auth) of the same collection import identically', async () => {
    const p2 = newProject()
    await importText(p2, V2)
    const p21 = newProject()
    await importText(p21, V21)
    expect(snapshot(p21)).toEqual(snapshot(p2))
  })

  it('a single file out of a v3 folder is refused with a pointer to "Import folder…", nothing written', async () => {
    const pid = newProject()
    const def = await importText(pid, JSON.stringify({ $kind: 'collection', name: 'c' }))
    expect(def.success).toBe(false)
    expect(def.error).toMatch(/one file of a Postman v3 collection folder/)
    expect(def.error).toMatch(/Import folder/)
    const yaml = await importText(
      pid,
      '$kind: http-request\nname: Get\nmethod: GET\nurl: https://x\n',
    )
    expect(yaml.error).toMatch(/Import folder/)
    expect(
      (
        getDb().prepare('SELECT COUNT(*) AS n FROM endpoints WHERE project_id = ?').get(pid) as {
          n: number
        }
      ).n,
    ).toBe(0)
  })
})

describe('issue #276 — environment, globals, legacy dump', () => {
  it('a globals export becomes the "Globals" environment through the APIs import (was: rejected)', async () => {
    const pid = newProject()
    const res = await importText(
      pid,
      JSON.stringify({
        name: 'My Workspace Globals',
        _postman_variable_scope: 'globals',
        values: [
          { key: 'g1', value: 'one', enabled: true },
          { key: 'gs', value: 'GLOBAL-SECRET', type: 'secret', enabled: true },
          { key: 'off', value: 'x', enabled: false },
        ],
      }),
    )
    expect(res).toMatchObject({ success: true, environmentName: 'Globals', endpointCount: 0 })
    expect(
      res.warnings?.some((w) => /imported as a project environment named "Globals"/.test(w)),
    ).toBe(true)
    const env = getDb()
      .prepare(`SELECT id FROM environments WHERE project_id = ? AND name = 'Globals'`)
      .get(pid) as { id: string }
    const rows = getDb()
      .prepare(
        'SELECT key, value, enabled, secret FROM environment_variables WHERE environment_id = ? ORDER BY rowid',
      )
      .all(env.id) as Array<{ key: string; value: string; enabled: number; secret: number }>
    expect(rows.map((r) => [r.key, r.enabled, r.secret])).toEqual([
      ['g1', 1, 0],
      ['gs', 1, 1],
      ['off', 0, 0],
    ])
    expect(rows[1].value).toMatch(/^enc:v1:/)
    // No folder for an environment file.
    expect(
      (
        getDb().prepare('SELECT COUNT(*) AS n FROM folders WHERE project_id = ?').get(pid) as {
          n: number
        }
      ).n,
    ).toBe(0)
  })

  it('the Environments modal channel accepts globals too', async () => {
    const pid = newProject()
    const res = (await ipcHandlers.get('import:postmanEnvironment')!(
      {},
      {
        projectId: pid,
        content: JSON.stringify({
          name: 'G',
          _postman_variable_scope: 'globals',
          values: [{ key: 'a', value: 'b' }],
        }),
      },
    )) as { success: boolean; data?: ImportData }
    expect(res.data).toMatchObject({ success: true, environmentName: 'Globals' })
  })

  const dump = {
    version: 1,
    collections: [
      {
        id: 'c1',
        name: 'Legacy One',
        order: ['r1'],
        folders: [],
        requests: [
          {
            id: 'r1',
            name: 'Ping',
            method: 'GET',
            url: 'https://h/ping',
            headers: 'Accept: */*\n',
            collectionId: 'c1',
          },
        ],
      },
      {
        id: 'c2',
        name: 'Legacy Two',
        order: [],
        folders: [{ id: 'f1', name: 'Things', order: ['r2'] }],
        requests: [
          {
            id: 'r2',
            name: 'Make',
            method: 'POST',
            url: 'https://h/things',
            dataMode: 'raw',
            rawModeData: '{"a":1}',
            currentHelper: 'basicAuth',
            helperAttributes: { username: 'u', password: 'p' },
            folder: 'f1',
          },
        ],
      },
    ],
    environments: [
      { id: 'e1', name: 'Legacy Env', values: [{ key: 'h', value: 'https://h', enabled: true }] },
    ],
    headerPresets: [{ id: 'hp', name: 'json', headers: [] }],
    globals: [{ key: 'gg', value: '1', enabled: true }],
  }

  it('imports every collection (own folder each), every environment and the globals', async () => {
    const pid = newProject()
    const res = await importText(pid, JSON.stringify(dump))
    expect(res).toMatchObject({ success: true, endpointCount: 2 })
    const folders = getDb()
      .prepare('SELECT name, parent_id FROM folders WHERE project_id = ? ORDER BY sort_order')
      .all(pid) as Array<{ name: string }>
    expect(folders.map((f) => f.name)).toEqual(['Legacy One', 'Legacy Two', 'Things'])
    const eps = getDb()
      .prepare(
        'SELECT name, request_schema FROM endpoints WHERE project_id = ? ORDER BY sort_order',
      )
      .all(pid) as Array<{ name: string; request_schema: string }>
    expect(eps.map((e) => e.name)).toEqual(['Ping', 'Make'])
    expect(JSON.parse(eps[1].request_schema)).toMatchObject({
      method: 'POST',
      body: { type: 'text', content: '{"a":1}' },
      auth: { type: 'basic', basic: { username: 'u', password: 'p' } },
    })
    const envs = getDb()
      .prepare('SELECT name FROM environments WHERE project_id = ? ORDER BY name')
      .all(pid) as Array<{ name: string }>
    expect(envs.map((e) => e.name)).toEqual(['Globals', 'Legacy Env'])
    expect(res.warnings?.some((w) => /header preset/.test(w))).toBe(true)
  })

  it('is one transaction: a broken collection leaves nothing behind', () => {
    const pid = newProject()
    const broken = {
      ...dump,
      collections: [
        dump.collections[0],
        {
          id: 'c3',
          name: 'Bad',
          order: ['r3'],
          folders: [],
          get requests(): unknown[] {
            throw new Error('broken dump')
          },
        },
      ],
    }
    expect(() => importLegacyDump(pid, broken as never, null, { apisTree: true })).toThrow(
      /broken dump/,
    )
    for (const t of ['endpoints', 'folders', 'environments'])
      expect(
        (
          getDb().prepare(`SELECT COUNT(*) AS n FROM ${t} WHERE project_id = ?`).get(pid) as {
            n: number
          }
        ).n,
      ).toBe(0)
  })
})
