/**
 * Issue #277 — Postman v3 export: a project (and a test suite) as one v3 JSON
 * file and as a Native Git folder.
 *
 *  - The JSON validates against Postman's published v3.0.0 JSON Schema
 *    (vendored, Apache-2.0: tests/fixtures/postman/v3-schema/README.md).
 *  - Testnizer → v3 folder → Testnizer gives the same rows per kind (HTTP,
 *    GraphQL, gRPC, WebSocket, Socket.IO, MCP, AI Chat), compared after
 *    normalising ids and absolute sort numbers; the same through the JSON.
 *  - Secrets canary: no secret variable value, no `enc:v1:` ciphertext and no
 *    literal project-auth credential reaches any written file (v3 folder, v3
 *    JSON, v2.1).
 *  - File names follow FMT002 / FMT007; an existing folder is never
 *    overwritten.
 *
 * Fail-before: there was no v3 export at all (only v2.1, which skipped every
 * non-HTTP request).
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'testnizer-pmv3-export-'))
type Handler = (event: unknown, ...args: unknown[]) => unknown
const ipcHandlers = new Map<string, Handler>()
const dialogState: { pick: string | null } = { pick: null }

vi.mock('electron', () => ({
  app: { getPath: (): string => tmpDir },
  ipcMain: {
    handle: (channel: string, fn: Handler): void => {
      ipcHandlers.set(channel, fn)
    },
  },
  dialog: {
    showOpenDialog: async (): Promise<{ canceled: boolean; filePaths: string[] }> =>
      dialogState.pick
        ? { canceled: false, filePaths: [dialogState.pick] }
        : { canceled: true, filePaths: [] },
  },
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

import Ajv from 'ajv'
import { initDatabase, getDb } from '../../src/main/db/database'
import { registerImportExportHandlers } from '../../src/main/ipc/import-export.handler'
import { writeSharedProjectSettings } from '../../src/main/lib/project-settings'
import { storedVariableValue } from '../../src/main/lib/secret-at-rest'
import { buildPostmanV3SuiteExport, v3JsonText } from '../../src/main/export/postman-v3'
import { sanitizeFileStem } from '../../src/main/export/postman-v3/folder-writer'
import { mqttMetaOf, sioMetaOf, wsMetaOf } from '../../src/shared/realtime-meta'
import { DEFAULT_SIO_SETTINGS, DEFAULT_WS_SETTINGS } from '../../src/shared/realtime'
import {
  DEFAULT_MQTT_SETTINGS,
  emptyConnectProperties,
  emptyLastWill,
  emptyMessageProperties,
  emptyPublishDraft,
  emptyWillProperties,
} from '../../src/shared/mqtt'

const FIX = path.join(__dirname, '..', 'fixtures', 'postman')
const SCHEMA = JSON.parse(fs.readFileSync(path.join(FIX, 'v3-schema', 'collection.json'), 'utf-8'))
const validate = new Ajv({ strict: false, allErrors: true }).compile(SCHEMA)

let workspaceId = ''
let seq = 0
const made: string[] = []

function newProject(name = `Project ${seq + 1}`): string {
  const id = `pmv3x-${++seq}`
  const now = Date.now()
  getDb()
    .prepare(
      `INSERT INTO projects (id, workspace_id, name, description, type, sort_order, created_at, updated_at)
       VALUES (?, ?, ?, NULL, 'http', 0, ?, ?)`,
    )
    .run(id, workspaceId, name, now, now)
  return id
}

function tmpOut(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'pmv3-out-'))
  made.push(d)
  return d
}

type Res = {
  success: boolean
  data?: unknown
  error?: string
  skipped?: unknown[]
  notes?: string[]
}
async function call(channel: string, ...args: unknown[]): Promise<Res> {
  return (await ipcHandlers.get(channel)!({}, ...args)) as Res
}

async function importFolder(projectId: string, folder: string): Promise<Record<string, unknown>> {
  dialogState.pick = folder
  const picked = await call('import:pickPostmanFolder')
  expect(picked.success, picked.error).toBe(true)
  const handle = (picked.data as { handle: string }).handle
  const res = await call('import:postmanFolder', { projectId, handle, folderId: null })
  expect(res.success).toBe(true)
  const data = res.data as Record<string, unknown>
  expect(data.success, String(data.error)).toBe(true)
  return data
}

async function exportFolder(projectId: string, parent = tmpOut()): Promise<string> {
  dialogState.pick = parent
  const res = await call('export:postmanV3Folder', projectId)
  expect(res.success, res.error).toBe(true)
  return res.data as string
}

function allFiles(dir: string): string[] {
  const out: string[] = []
  const walk = (d: string): void => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name)
      if (e.isDirectory()) walk(p)
      else out.push(p)
    }
  }
  walk(dir)
  return out
}

/**
 * Everything a project holds, ids and absolute sort numbers normalised:
 * folders by path, requests by folder path + name in tree order, examples.
 */
function snapshot(pid: string): unknown {
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
  const byId = new Map(folders.map((f) => [f.id, f]))
  const pathOf = (id: string | null): string => {
    const parts: string[] = []
    let cur = id ? byId.get(id) : undefined
    while (cur) {
      parts.unshift(cur.name)
      cur = cur.parent_id ? byId.get(cur.parent_id) : undefined
    }
    return parts.join('/')
  }
  const strip = (v: unknown): unknown =>
    JSON.parse(JSON.stringify(v), (k, val) => (k === 'id' ? undefined : val))
  const eps = db
    .prepare('SELECT * FROM endpoints WHERE project_id = ? ORDER BY sort_order')
    .all(pid) as Array<{
    id: string
    folder_id: string | null
    name: string
    protocol: string
    method: string
    path: string
    description: string | null
    request_schema: string
    sort_order: number
  }>
  // sort_order is a per-folder sibling index: order by folder path first.
  eps.sort(
    (x, y) => pathOf(x.folder_id).localeCompare(pathOf(y.folder_id)) || x.sort_order - y.sort_order,
  )
  return {
    folders: folders.map((f) => ({
      path: pathOf(f.id),
      auth: f.auth,
      pre: f.pre_script,
      post: f.post_script,
    })),
    requests: eps.map((e) => ({
      at: `${pathOf(e.folder_id)} :: ${e.name}`,
      protocol: e.protocol,
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
      ).map((x) => {
        const resp = JSON.parse(x.response_json)
        return {
          name: x.name,
          status: x.status_code,
          body: resp.body ?? '',
          statusText: resp.statusText ?? '',
          contentType: Object.entries(resp.headers ?? {}).find(
            ([k]) => k.toLowerCase() === 'content-type',
          )?.[1],
          request: strip(JSON.parse(x.request_json)),
        }
      }),
    })),
  }
}

function envSnapshot(pid: string): unknown {
  const db = getDb()
  const envs = db
    .prepare('SELECT id, name FROM environments WHERE project_id = ? ORDER BY name')
    .all(pid) as Array<{ id: string; name: string }>
  return envs.map((e) => ({
    name: e.name,
    vars: (
      db
        .prepare(
          'SELECT key, value, secret, enabled FROM environment_variables WHERE environment_id = ? ORDER BY rowid',
        )
        .all(e.id) as Array<{ key: string; value: string; secret: number; enabled: number }>
    ).map((v) => ({
      key: v.key,
      value: v.secret ? '<secret>' : v.value,
      secret: v.secret,
      enabled: v.enabled,
    })),
  }))
}

let seeded = ''

beforeAll(async () => {
  initDatabase()
  registerImportExportHandlers()
  workspaceId = (getDb().prepare('SELECT id FROM workspaces LIMIT 1').get() as { id: string }).id
  // A project holding every kind: the constructed v3 workspace fixture.
  seeded = newProject('Shop workspace')
  await importFolder(seeded, path.join(FIX, 'v3', 'workspace'))
})
afterAll(() => {
  for (const d of made) fs.rmSync(d, { recursive: true, force: true })
})

describe('issue #277 — Postman v3 JSON', () => {
  it('validates against the published v3.0.0 JSON Schema', async () => {
    const res = await call('export:postmanV3Json', seeded)
    expect(res.success, res.error).toBe(true)
    const doc = JSON.parse(res.data as string)
    const ok = validate(doc)
    expect(ok, JSON.stringify(validate.errors?.slice(0, 5), null, 2)).toBe(true)
    expect(doc.$kind).toBe('collection')
    const kinds = new Set<string>()
    const walk = (items: Array<Record<string, unknown>>): void => {
      for (const it of items) {
        kinds.add(String(it.$kind))
        if (Array.isArray(it.items)) walk(it.items as Array<Record<string, unknown>>)
      }
    }
    walk(doc.items)
    for (const k of [
      'http-request',
      'graphql-request',
      'grpc-request',
      'websocket-request',
      'socket.io-request',
      'mcp-request',
      'llm-request',
      'mqtt-request',
    ])
      expect(kinds.has(k), k).toBe(true)
  })

  it('the constructed import fixture also validates (it is schema-shaped)', () => {
    const doc = JSON.parse(fs.readFileSync(path.join(FIX, 'v3', 'all-kinds.v3.json'), 'utf-8'))
    expect(validate(doc), JSON.stringify(validate.errors?.slice(0, 3))).toBe(true)
  })

  it('Testnizer → v3 JSON → Testnizer keeps every request, folder and example', async () => {
    const res = await call('export:postmanV3Json', seeded)
    const back = newProject('Shop workspace')
    const imported = await call('import:postman', {
      projectId: back,
      content: res.data,
      folderId: null,
    })
    expect((imported.data as { success: boolean }).success).toBe(true)
    expect(snapshot(back)).toEqual(snapshot(seeded))
  })
})

describe('issue #277 — Postman v3 folder', () => {
  it('writes the Native Git layout with orders spaced by 1000 and resources under .resources', async () => {
    const root = await exportFolder(seeded)
    expect(path.basename(root)).toBe('Shop workspace')
    const col = path.join(root, 'postman', 'collections', 'Shop workspace')
    expect(fs.existsSync(path.join(col, '.resources', 'definition.yaml'))).toBe(true)
    expect(fs.existsSync(path.join(col, 'Shop API', '.resources', 'definition.yaml'))).toBe(true)
    const listYaml = fs.readFileSync(
      path.join(col, 'Shop API', 'List products.request.yaml'),
      'utf-8',
    )
    expect(listYaml).toMatch(/^\$kind: http-request/m)
    expect(listYaml).toMatch(/^order: \d+000$/m)
    expect(listYaml).toMatch(/^examples: \.resources\/List products\.resources\/examples$/m)
    expect(
      fs.existsSync(
        path.join(
          col,
          'Shop API',
          '.resources',
          'List products.resources',
          'examples',
          '200 OK.example.yaml',
        ),
      ),
    ).toBe(true)
    expect(
      fs.existsSync(
        path.join(
          col,
          'Shop API',
          'Realtime',
          '.resources',
          'Feed socket.resources',
          'messages',
          'Hello.message.yaml',
        ),
      ),
    ).toBe(true)
    expect(
      fs.existsSync(path.join(root, 'postman', 'environments', 'Staging.environment.yaml')),
    ).toBe(true)
    // Arrays, never maps (schema form).
    const feed = fs.readFileSync(
      path.join(col, 'Shop API', 'Realtime', 'Feed socket.request.yaml'),
      'utf-8',
    )
    expect(feed).toMatch(/^headers:\n {2}- key: X-Client/m)
  })

  it('Testnizer → v3 folder → Testnizer gives the same rows and environments', async () => {
    const root = await exportFolder(seeded)
    const back = newProject('Shop workspace')
    await importFolder(back, root)
    const protocols = new Set(
      (
        getDb()
          .prepare('SELECT protocol FROM endpoints WHERE project_id = ?')
          .all(seeded) as Array<{ protocol: string }>
      ).map((r) => r.protocol),
    )
    // The comparison covers every kind, not only HTTP.
    for (const p of ['http', 'graphql', 'grpc', 'websocket', 'socketio', 'mcp', 'ai', 'mqtt'])
      expect(protocols.has(p), p).toBe(true)
    expect(snapshot(back)).toEqual(snapshot(seeded))
    expect(envSnapshot(back)).toEqual(envSnapshot(seeded))
    expect((envSnapshot(seeded) as unknown[]).length).toBeGreaterThan(0)
  })

  it('never overwrites: a second export next to the first gets " (2)"', async () => {
    const parent = tmpOut()
    const first = await exportFolder(seeded, parent)
    const second = await exportFolder(seeded, parent)
    expect(path.basename(first)).toBe('Shop workspace')
    expect(path.basename(second)).toBe('Shop workspace (2)')
  })

  it('a cancelled folder dialog writes nothing', async () => {
    dialogState.pick = null
    const res = await call('export:postmanV3Folder', seeded)
    expect(res).toEqual({ success: true, data: null })
  })
})

describe('issue #277 — Testnizer-native HTTP rows (Ctrl+S shapes) round-trip', () => {
  let pid = ''
  beforeAll(() => {
    pid = newProject('Native rows')
    const db = getDb()
    const now = Date.now()
    const ep = (
      name: string,
      protocol: string,
      method: string,
      url: string,
      schema: Record<string, unknown>,
      order: number,
    ): void => {
      db.prepare(
        `INSERT INTO endpoints (id, project_id, folder_id, name, description, protocol, method, path, status, request_schema, response_schemas, sort_order, created_at, updated_at)
         VALUES (?, ?, NULL, ?, NULL, ?, ?, ?, 'developing', ?, NULL, ?, ?, ?)`,
      ).run(randomUUID(), pid, name, protocol, method, url, JSON.stringify(schema), order, now, now)
    }
    ep(
      'HTTP all',
      'http',
      'PUT',
      '/x/:id',
      {
        url: 'https://a.test/x/:id?q=1',
        method: 'PUT',
        params: [
          { id: 'p1', key: 'q', value: '1', enabled: true },
          { id: 'p2', key: 'off', value: 'x', enabled: false },
        ],
        headers: [{ id: 'h1', key: 'X-A', value: '{{a}}', enabled: true, description: 'note' }],
        body: { type: 'xml', content: '<a/>' },
        auth: {
          type: 'aws-signature',
          awsSignature: {
            accessKey: '{{ak}}',
            secretKey: '{{sk}}',
            region: 'eu-west-1',
            service: 's3',
          },
        },
        preScript: 'pm.variables.set("x", 1)',
        postScript: 'pm.test("t", () => {})',
        followRedirects: false,
        maxRedirects: 4,
        sslVerification: false,
        pathVariables: [{ id: 'v1', key: 'id', value: '9', description: 'the id' }],
      },
      0,
    )
    ep(
      'OAuth password',
      'http',
      'GET',
      '/o',
      {
        url: 'https://a.test/o',
        method: 'GET',
        params: [],
        headers: [],
        body: { type: 'none' },
        auth: {
          type: 'oauth2',
          oauth2: {
            grantType: 'password',
            tokenUrl: 'https://a.test/token',
            authUrl: '',
            clientId: 'c',
            clientSecret: '{{cs}}',
            scope: 'r',
            token: '',
            username: 'u',
            password: '{{pw}}',
            clientAuth: 'body',
          },
        },
      },
      1,
    )
    ep(
      'Hawk',
      'http',
      'GET',
      '/h',
      {
        url: 'https://a.test/h',
        method: 'GET',
        params: [],
        headers: [],
        body: { type: 'none' },
        auth: { type: 'hawk', hawk: { authId: 'id', authKey: '{{hk}}', algorithm: 'sha1' } },
      },
      2,
    )
    ep(
      'Form',
      'http',
      'POST',
      '/f',
      {
        url: 'https://a.test/f',
        method: 'POST',
        params: [],
        headers: [],
        body: {
          type: 'form-data',
          formData: [
            { id: 'f1', key: 'a', value: 'b', enabled: true, type: 'text' },
            {
              id: 'f2',
              key: 'file',
              value: 'x.png',
              enabled: true,
              type: 'file',
              filePath: '/tmp/x.png',
            },
          ],
        },
        auth: { type: 'none' },
      },
      3,
    )
  })

  it('HTTP: auth (AWS Signature, OAuth 2.0 password, Hawk), settings, path variables, bodies survive', async () => {
    const json = await call('export:postmanV3Json', pid)
    expect(
      validate(JSON.parse(json.data as string)),
      JSON.stringify(validate.errors?.slice(0, 3)),
    ).toBe(true)
    const root = await exportFolder(pid)
    const back = newProject('Native rows')
    await importFolder(back, root)
    expect(snapshot(back)).toEqual(snapshot(pid))
  })
})

/**
 * Rows the importer never wrote: the shapes older builds saved (legacy
 * realtime keys, the proto importer's `request_schema.grpc`) and the current
 * editor's Ctrl+S blocks (`wsMetaOf` / `sioMetaOf`, the MCP branch of
 * `snapshotProtocol`). The kind round trip above only proves export inverts
 * the importer's own writers.
 */
describe('issue #277 — rows saved by the editor and by older builds', () => {
  type V3Item = Record<string, unknown> & { name: string }
  let items: V3Item[] = []
  let notes: string[] = []
  beforeAll(async () => {
    const pid = newProject('Editor rows')
    const db = getDb()
    const now = Date.now()
    let order = 0
    const ep = (name: string, protocol: string, schema: Record<string, unknown>): void => {
      db.prepare(
        `INSERT INTO endpoints (id, project_id, folder_id, name, description, protocol, method, path, status, request_schema, response_schemas, sort_order, created_at, updated_at)
         VALUES (?, ?, NULL, ?, NULL, ?, 'GET', '', 'developing', ?, NULL, ?, ?, ?)`,
      ).run(randomUUID(), pid, name, protocol, JSON.stringify(schema), order++, now, now)
    }
    // Pre-#282 WebSocket block (671bdee writer): no params / settings / saved messages.
    ep('WS legacy', 'websocket', {
      url: 'wss://old.test/ws',
      metadata: {
        websocket: {
          url: 'wss://old.test/ws',
          customHeaders: [{ id: 'h', key: 'X-Old', value: '1', enabled: true }],
          composerContent: '{"hi":1}',
          composerMode: 'json',
          autoScroll: true,
        },
      },
    })
    // Pre-#283 Socket.IO block: `subscriptions` + `emitPayload` only.
    ep('SIO legacy', 'socketio', {
      url: 'https://sio-old.test',
      metadata: {
        socketio: {
          url: 'https://sio-old.test',
          namespace: '/chat',
          bearerToken: '',
          emitEvent: 'say',
          emitPayload: '{"a":1}',
          subscriptions: ['news', 'alerts'],
        },
      },
    })
    // Proto importer row: the call under `request_schema.grpc`, an absolute proto path.
    ep('gRPC legacy', 'grpc', {
      url: '',
      body: { type: 'json', content: '{"name":"ada"}' },
      grpc: {
        serverAddress: 'grpc.old.test:443',
        serviceName: 'pkg.Greeter',
        methodName: 'SayHello',
        protoPath: '/Users/someone/protos/greeter.proto',
      },
    })
    // Current Ctrl+S blocks.
    ep('WS now', 'websocket', {
      url: 'wss://now.test/ws',
      metadata: {
        websocket: wsMetaOf({
          url: 'wss://now.test/ws',
          customHeaders: [{ id: 'h', key: 'X-Now', value: '{{v}}', enabled: true }],
          params: [{ id: 'q', key: 'room', value: 'a', enabled: true }],
          settings: { ...DEFAULT_WS_SETTINGS, maxPayload: 2 },
          composerContent: '',
          composerMode: 'xml',
          autoScroll: true,
          savedMessages: [{ id: 'm', name: 'Ping', content: '<ping/>', contentType: 'xml' }],
        }),
      },
    })
    ep('SIO now', 'socketio', {
      url: 'https://sio-now.test',
      metadata: {
        socketio: sioMetaOf({
          url: 'https://sio-now.test',
          namespace: '/live',
          bearerToken: '',
          customHeaders: [],
          params: [],
          settings: DEFAULT_SIO_SETTINGS,
          listeners: [
            { id: 'l1', name: 'tick', description: 'clock', listen: true },
            { id: 'l2', name: 'muted', description: '', listen: false },
          ],
          listenAll: false,
          emitEvent: 'join',
          emitArgs: [{ id: 'a', content: '"room-1"', contentType: 'json' }],
          emitAck: false,
          savedMessages: [
            {
              id: 's',
              name: 'Join',
              eventName: 'join',
              acknowledgement: true,
              args: [{ id: 'a2', content: '"room-2"', contentType: 'json' }],
            },
          ],
        }),
      },
    })
    ep('MCP now', 'mcp', {
      url: 'https://mcp.now.test/mcp',
      metadata: {
        mcp: {
          transport: 'http',
          url: 'https://mcp.now.test/mcp',
          customHeaders: [{ id: 'h', key: 'X-Tenant', value: 't1', enabled: true }],
          envVars: [],
          auth: { type: 'bearer', bearerToken: '{{mcpToken}}' },
          protocol: 'auto',
          call: {
            capabilityTab: 'tools',
            selectedTool: 'search',
            toolArgs: '{"q":"{{term}}"}',
            selectedResourceUri: '',
            resourceUriDraft: '',
            selectedPrompt: '',
            promptArgs: {},
          },
        },
      },
    })
    // Issue #284: the MQTT Ctrl+S block, with what v3 cannot carry.
    ep('MQTT now', 'mqtt', {
      url: 'mqtt://broker.now.test:1883',
      metadata: {
        mqtt: mqttMetaOf({
          url: 'mqtt://broker.now.test:1883',
          clientId: '',
          version: 4,
          username: 'dev',
          password: '{{mqttPw}}',
          settings: { ...DEFAULT_MQTT_SETTINGS, keepAlive: 30 },
          properties: emptyConnectProperties(),
          lastWill: {
            ...emptyLastWill(),
            topic: 'clients/now',
            payload: '<gone/>',
            type: 'xml',
            properties: emptyWillProperties(),
          },
          topics: [
            {
              id: 't',
              name: 'sensors/#',
              qos: 1,
              subscribe: true,
              description: '',
              noLocal: false,
              retainAsPublished: false,
              retainHandling: 0,
            },
          ],
          composer: { ...emptyPublishDraft(), topic: 'scratch', content: 'not saved' },
          savedMessages: [
            {
              ...emptyPublishDraft(),
              id: 's',
              name: 'Ping',
              description: '',
              topic: 'sensors/ping',
              content: '1',
              contentType: 'text',
              properties: {
                ...emptyMessageProperties(),
                userProperties: [{ id: 'u', key: 'off', value: 'x', enabled: false }],
              },
            },
          ],
        }),
      },
    })
    const res = await call('export:postmanV3Json', pid)
    expect(res.success, res.error).toBe(true)
    const doc = JSON.parse(res.data as string)
    expect(validate(doc), JSON.stringify(validate.errors?.slice(0, 5), null, 2)).toBe(true)
    items = doc.items
    notes = res.notes ?? []
  })
  const item = (name: string): V3Item => items.find((i) => i.name === name)!

  it('legacy WebSocket: url and headers come out', () => {
    expect(item('WS legacy')).toMatchObject({
      $kind: 'websocket-request',
      url: 'wss://old.test/ws',
      headers: [{ key: 'X-Old', value: '1' }],
    })
  })

  it('legacy Socket.IO: namespace folded into the URL, subscriptions → listened events', () => {
    expect(item('SIO legacy')).toMatchObject({
      $kind: 'socket.io-request',
      url: 'https://sio-old.test/chat',
      events: [
        { name: 'news', subscribeOnConnect: true },
        { name: 'alerts', subscribeOnConnect: true },
      ],
    })
  })

  it('legacy gRPC (request_schema.grpc): address, service/method, message, proto file name only', () => {
    const g = item('gRPC legacy')
    expect(g).toMatchObject({
      $kind: 'grpc-request',
      url: 'grpc.old.test:443',
      methodPath: 'pkg.Greeter/SayHello',
      message: { content: '{"name":"ada"}' },
      schema: { source: 'file', location: 'greeter.proto' },
    })
    expect(JSON.stringify(g)).not.toContain('/Users/someone')
  })

  it('current WebSocket block: params, settings (MB → bytes) and saved messages', () => {
    expect(item('WS now')).toMatchObject({
      url: 'wss://now.test/ws',
      headers: [{ key: 'X-Now', value: '{{v}}' }],
      queryParams: [{ key: 'room', value: 'a' }],
      settings: { maxPayload: 2 * 1024 * 1024 },
      messages: [{ $kind: 'websocket-message', name: 'Ping', content: '<ping/>' }],
    })
  })

  it('current Socket.IO block: listeners with their listen flag', () => {
    expect(item('SIO now')).toMatchObject({
      url: 'https://sio-now.test/live',
      events: [
        { name: 'tick', description: 'clock', subscribeOnConnect: true },
        { name: 'muted', subscribeOnConnect: false },
      ],
    })
  })

  it('current MCP block: url, headers and the tool call as a message', () => {
    const m = item('MCP now')
    expect(m).toMatchObject({
      $kind: 'mcp-request',
      url: 'https://mcp.now.test/mcp',
      headers: [{ key: 'X-Tenant', value: 't1' }],
    })
    // A JSON-RPC tools/call; the `{{var}}` inside the arguments is kept.
    expect(JSON.parse(String(m.message))).toEqual({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'search', arguments: { q: '{{term}}' } },
    })
  })

  it('MQTT block (issue #284): connection, topics, will and saved messages; the rest is noted', () => {
    const m = item('MQTT now')
    expect(m).toMatchObject({
      $kind: 'mqtt-request',
      url: 'mqtt://broker.now.test:1883',
      version: 4,
      topics: [{ name: 'sensors/#', qos: 1, subscribe: true }],
      lastWill: { topic: 'clients/now', payload: '<gone/>', type: 'text' },
      settings: { keepAlive: 30, cleanSession: true },
      messages: [{ $kind: 'mqtt-message', name: 'Ping', topic: 'sensors/ping', content: '1' }],
    })
    // An empty client id stays out (a random one is generated at connect).
    expect(m).not.toHaveProperty('clientId')
    expect(JSON.stringify(m.auth)).toContain('{{mqttPw}}')
    const n = notes.filter((x) => x.includes('MQTT now')).join('\n')
    expect(n).toMatch(/Last Will payload format XML is exported as text/)
    expect(n).toMatch(/disabled message user properties were not exported/)
    expect(n).toMatch(/unsaved message in the composer/)
  })
})

describe('issue #277 — AI Chat with a Custom endpoint', () => {
  it('exports as provider "custom" and re-imports without a lossy-mapping warning', async () => {
    const src = newProject('Custom AI')
    const doc = {
      $kind: 'collection',
      name: 'Custom AI',
      items: [
        {
          $kind: 'llm-request',
          name: 'Local',
          url: 'http://llm.intranet.test/v1/chat/completions',
          config: { model: 'm1', provider: 'my-gateway' },
        },
      ],
    }
    const first = (
      await call('import:postman', { projectId: src, content: JSON.stringify(doc), folderId: null })
    ).data as { warnings?: string[] }
    // A provider Testnizer does not know IS a lossy mapping…
    expect((first.warnings ?? []).some((w) => w.includes('Custom (OpenAI-compatible)'))).toBe(true)
    const exported = JSON.parse((await call('export:postmanV3Json', src)).data as string)
    expect(exported.items[0].config.provider).toBe('custom')
    const back = newProject('Custom AI')
    const again = (
      await call('import:postman', {
        projectId: back,
        content: JSON.stringify(exported),
        folderId: null,
      })
    ).data as { warnings?: string[] }
    // …but "custom" itself is not.
    expect((again.warnings ?? []).some((w) => w.includes('Custom (OpenAI-compatible)'))).toBe(false)
    expect(snapshot(back)).toEqual(snapshot(src))
  })
})

describe('issue #277 — secrets never reach a file', () => {
  const CANARY_SECRET = 'CANARY-SECRET-value-9f8e7d'
  const CANARY_INITIAL = 'CANARY-SECRET-initial-1a2b3c'
  const CANARY_AUTH = 'CANARY-PROJECT-AUTH-token-77'
  let pid = ''
  let ciphertext = ''
  beforeAll(() => {
    pid = newProject('Canary')
    const db = getDb()
    const now = Date.now()
    const envId = randomUUID()
    db.prepare(
      `INSERT INTO environments (id, workspace_id, project_id, name, is_active, created_at, updated_at) VALUES (?, ?, ?, 'Prod', 1, ?, ?)`,
    ).run(envId, workspaceId, pid, now, now)
    ciphertext = storedVariableValue('leftover-ciphertext-plain', true)
    expect(ciphertext.startsWith('enc:v1:')).toBe(true)
    const v = db.prepare(
      `INSERT INTO environment_variables (id, environment_id, key, value, description, enabled, secret, initial_value) VALUES (?, ?, ?, ?, NULL, 1, ?, ?)`,
    )
    v.run(
      randomUUID(),
      envId,
      'token',
      storedVariableValue(CANARY_SECRET, true),
      1,
      storedVariableValue(CANARY_INITIAL, true),
    )
    // An undecryptable value left on a row whose secret flag was cleared (issue #239).
    v.run(randomUUID(), envId, 'stale', ciphertext, 0, null)
    v.run(randomUUID(), envId, 'host', 'https://canary.test', 0, null)
    db.prepare(
      `INSERT INTO global_variables (id, workspace_id, project_id, key, value, description, enabled, secret, initial_value) VALUES (?, ?, ?, 'gsecret', ?, NULL, 1, 1, NULL)`,
    ).run(randomUUID(), workspaceId, pid, storedVariableValue(CANARY_SECRET, true))
    writeSharedProjectSettings(pid, { auth: { type: 'bearer', bearerToken: CANARY_AUTH } })
    db.prepare(
      `INSERT INTO endpoints (id, project_id, folder_id, name, description, protocol, method, path, status, request_schema, response_schemas, sort_order, created_at, updated_at)
       VALUES (?, ?, NULL, 'Call', NULL, 'http', 'GET', '{{host}}/x', 'developing', ?, NULL, 0, ?, ?)`,
    ).run(
      randomUUID(),
      pid,
      JSON.stringify({
        url: '{{host}}/x',
        method: 'GET',
        auth: { type: 'inherit' },
        headers: [],
        params: [],
      }),
      now,
      now,
    )
  })

  const assertClean = (text: string, where: string): void => {
    for (const bad of [CANARY_SECRET, CANARY_INITIAL, CANARY_AUTH, 'enc:v1:', ciphertext]) {
      expect(text.includes(bad), `${where} contains ${bad}`).toBe(false)
    }
  }

  it('v3 folder: every file', async () => {
    const root = await exportFolder(pid)
    const files = allFiles(root)
    expect(files.some((f) => f.endsWith('Prod.environment.yaml'))).toBe(true)
    expect(files.some((f) => f.endsWith('workspace.globals.yaml'))).toBe(true)
    for (const f of files) assertClean(fs.readFileSync(f, 'utf-8'), f)
    const env = fs.readFileSync(files.find((f) => f.endsWith('Prod.environment.yaml'))!, 'utf-8')
    expect(env).toMatch(/key: token\n\s+value: ''\n\s+enabled: true\n\s+type: secret/)
    expect(env).toContain('https://canary.test')
  })

  it('v3 JSON and v2.1 JSON', async () => {
    const v3 = await call('export:postmanV3Json', pid)
    assertClean(String(v3.data), 'v3 JSON')
    expect(JSON.parse(String(v3.data)).variables).toContainEqual({ key: 'token', secret: true })
    const v21 = await call('export:postman', pid)
    assertClean(String(v21.data), 'v2.1 JSON')
  })
})

describe('issue #277 — file names (FMT002 / FMT007)', () => {
  it('sanitises forbidden characters and reserved names', () => {
    expect(sanitizeFileStem('a/b\\c:d*e?f"g<h>i|j')).toBe('a-b-c-d-e-f-g-h-i-j')
    expect(sanitizeFileStem('CON')).toBe('CON_')
    expect(sanitizeFileStem('  .hidden. ')).toBe('_hidden')
    expect(sanitizeFileStem('')).toBe('Untitled')
  })

  it('case-insensitive collisions get " (2)" and keep their names on re-import', async () => {
    const pid = newProject('Names')
    const db = getDb()
    const now = Date.now()
    const names = ['Users', 'users', 'a/b: c', 'NUL']
    names.forEach((n, i) =>
      db
        .prepare(
          `INSERT INTO endpoints (id, project_id, folder_id, name, description, protocol, method, path, status, request_schema, response_schemas, sort_order, created_at, updated_at)
         VALUES (?, ?, NULL, ?, NULL, 'http', 'GET', 'https://n.test', 'developing', ?, NULL, ?, ?, ?)`,
        )
        .run(
          randomUUID(),
          pid,
          n,
          JSON.stringify({ url: 'https://n.test', method: 'GET' }),
          i,
          now,
          now,
        ),
    )
    const root = await exportFolder(pid)
    const col = path.join(root, 'postman', 'collections', 'Names')
    const files = fs
      .readdirSync(col)
      .filter((f) => f.endsWith('.request.yaml'))
      .sort()
    expect(files).toEqual(
      [
        'NUL_.request.yaml',
        'Users.request.yaml',
        'a-b- c.request.yaml',
        'users (2).request.yaml',
      ].sort(),
    )
    const back = newProject('Names')
    await importFolder(back, root)
    const backNames = (
      db
        .prepare('SELECT name FROM endpoints WHERE project_id = ? ORDER BY sort_order')
        .all(back) as Array<{ name: string }>
    ).map((r) => r.name)
    expect(backNames).toEqual(names)
  })
})

describe('issue #277 — test suite as Postman v3', () => {
  it('a suite exports in execution order (requests before sub-folders) and validates', () => {
    const db = getDb()
    const pid = newProject('Suite host')
    const suiteId = randomUUID()
    const now = Date.now()
    db.prepare(
      `INSERT INTO test_suites (id, project_id, name, description, created_at, updated_at) VALUES (?, ?, 'Smoke', NULL, ?, ?)`,
    ).run(suiteId, pid, now, now)
    const folderId = randomUUID()
    db.prepare(
      `INSERT INTO test_suite_folders (id, suite_id, parent_id, name, sort_order, created_at) VALUES (?, ?, NULL, 'Sub', 0, ?)`,
    ).run(folderId, suiteId, now)
    const item = (
      name: string,
      folder: string | null,
      order: number,
      protocol = 'http',
      schema: Record<string, unknown> = {},
    ): void => {
      db.prepare(
        `INSERT INTO test_suite_items (id, suite_id, folder_id, name, method, url, protocol, request_schema, assertions, sort_order, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'GET', 'https://s.test', ?, ?, ?, ?, ?, ?)`,
      ).run(
        randomUUID(),
        suiteId,
        folder,
        name,
        protocol,
        JSON.stringify(schema),
        JSON.stringify([{ id: 'a1', type: 'status_equals', expected: '200', enabled: true }]),
        order,
        now,
        now,
      )
    }
    item('In folder', folderId, 0)
    item('Root one', null, 1)
    item('Socket', null, 2, 'websocket', { metadata: { websocket: { url: 'wss://s.test' } } })
    const r = buildPostmanV3SuiteExport(suiteId)
    const doc = JSON.parse(v3JsonText(r))
    expect(validate(doc), JSON.stringify(validate.errors?.slice(0, 3))).toBe(true)
    expect(doc.items.map((i: { name: string }) => i.name)).toEqual(['Root one', 'Socket', 'Sub'])
    // Tests-tab rows ride as generated pm.test code (v3 has no assertion slot).
    const root = doc.items[0] as { scripts: Array<{ type: string; code: string }> }
    expect(root.scripts.find((s) => s.type === 'afterResponse')!.code).toMatch(/pm\.test\(/)
  })
})
