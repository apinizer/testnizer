/**
 * Issue #276 part 2 — Postman v3 import: a Native Git folder (workspace or a
 * single collection) through `import:pickPostmanFolder` + `import:postmanFolder`,
 * and a monolithic v3 JSON file through `import:postman`.
 *
 * Fixtures are constructed (tests/fixtures/postman/v3/README.md): both the
 * list and the `key: value` map forms, multi-auth, path-backed scripts (one
 * climbing out of the collection), examples and saved messages under
 * `.resources/`, every request kind (MQTT / Kafka / an unknown kind skipped).
 *
 * Fail-before: v3 folders had no import path at all and a v3 JSON file was
 * refused ("Testnizer imports Postman v3 in a later version").
 *
 * Real production schema (`initDatabase` in a temp userData dir) and the real
 * IPC handlers; only the native folder dialog is stubbed.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'testnizer-pmv3-'))
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

import { initDatabase, getDb } from '../../src/main/db/database'
import { registerImportExportHandlers } from '../../src/main/ipc/import-export.handler'
import { readSharedProjectSettings } from '../../src/main/lib/project-settings'
import * as trust from '../../src/main/lib/mcp-stdio-trust'
import { readWsMeta, readSioMeta } from '../../src/shared/realtime-meta'

const FIX = path.join(__dirname, '..', 'fixtures', 'postman', 'v3')
const WORKSPACE = path.join(FIX, 'workspace')

let workspaceId = ''
let seq = 0
function newProject(): string {
  const id = `pmv3-${++seq}`
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

async function pick(
  folder: string,
): Promise<{ success: boolean; data?: Record<string, unknown> | null; error?: string }> {
  dialogState.pick = folder
  return (await ipcHandlers.get('import:pickPostmanFolder')!({})) as {
    success: boolean
    data?: Record<string, unknown> | null
    error?: string
  }
}

async function importFolder(
  projectId: string,
  folder: string,
  folderId: string | null = null,
): Promise<ImportData> {
  const picked = await pick(folder)
  expect(picked.success, picked.error).toBe(true)
  const handle = (picked.data as { handle: string }).handle
  const res = (await ipcHandlers.get('import:postmanFolder')!(
    {},
    { projectId, handle, folderId },
  )) as {
    success: boolean
    data?: ImportData
  }
  expect(res.success).toBe(true)
  return res.data ?? {}
}

async function importText(projectId: string, content: string): Promise<ImportData> {
  const res = (await ipcHandlers.get('import:postman')!(
    {},
    { projectId, content, folderId: null },
  )) as {
    success: boolean
    data?: ImportData
  }
  expect(res.success).toBe(true)
  return res.data ?? {}
}

interface EpRow {
  id: string
  name: string
  folder_id: string | null
  protocol: string
  method: string
  path: string
  description: string | null
  request_schema: string
  sort_order: number
}
interface FolderRow {
  id: string
  parent_id: string | null
  name: string
  auth: string | null
  pre_script: string | null
  post_script: string | null
  sort_order: number
}

function folders(pid: string): FolderRow[] {
  return getDb()
    .prepare('SELECT * FROM folders WHERE project_id = ? ORDER BY sort_order')
    .all(pid) as FolderRow[]
}
function endpoints(pid: string): EpRow[] {
  return getDb()
    .prepare('SELECT * FROM endpoints WHERE project_id = ? ORDER BY sort_order')
    .all(pid) as EpRow[]
}
function ep(pid: string, name: string): EpRow & { schema: Record<string, any> } {
  const row = endpoints(pid).find((e) => e.name === name)
  if (!row)
    throw new Error(
      `no endpoint ${name}: ${endpoints(pid)
        .map((e) => e.name)
        .join(', ')}`,
    )
  return { ...row, schema: JSON.parse(row.request_schema) }
}
function folderByName(pid: string, name: string): FolderRow {
  const f = folders(pid).find((x) => x.name === name)
  if (!f) throw new Error(`no folder ${name}`)
  return f
}

/** Tree order: each level's items as the walker wrote them (folders and requests by sort_order). */
function namesIn(pid: string, folderId: string | null): string[] {
  const eps = endpoints(pid).filter((e) => e.folder_id === folderId)
  return eps.map((e) => e.name)
}

const trustStore = new Map<string, unknown>()

beforeAll(() => {
  initDatabase()
  registerImportExportHandlers()
  workspaceId = (getDb().prepare('SELECT id FROM workspaces LIMIT 1').get() as { id: string }).id
  trust.setStdioTrustStoreForTests({
    get: (k) => trustStore.get(k),
    set: (k, v) => void trustStore.set(k, v),
  })
})
afterAll(() => trust.setStdioTrustStoreForTests(undefined))
beforeEach(() => {
  dialogState.pick = null
})

describe('issue #276 part 2 — Postman v3 workspace folder', () => {
  let pid = ''
  let res: ImportData = {}
  beforeAll(async () => {
    pid = newProject()
    res = await importFolder(pid, WORKSPACE)
  })

  it('the pick returns a summary and an opaque handle, never a path', async () => {
    const picked = await pick(WORKSPACE)
    expect(picked.success).toBe(true)
    const d = picked.data as Record<string, unknown>
    expect(d.kind).toBe('workspace')
    expect(d.collections).toEqual(['Shop API', 'Status'])
    expect(d.environmentCount).toBe(1)
    expect(d.globalsCount).toBe(1)
    expect(typeof d.handle).toBe('string')
    expect(JSON.stringify(d)).not.toContain(FIX)
    // A cancelled dialog is not an error.
    dialogState.pick = null
    const cancelled = (await ipcHandlers.get('import:pickPostmanFolder')!({})) as {
      success: boolean
      data: unknown
    }
    expect(cancelled).toEqual({ success: true, data: null })
  })

  it('a handle is single-use; an unknown handle is refused', async () => {
    const r = (await ipcHandlers.get('import:postmanFolder')!(
      {},
      { projectId: pid, handle: 'nope' },
    )) as {
      data: ImportData
    }
    expect(r.data.success).toBe(false)
    expect(r.data.error).toMatch(/pick it again/)
  })

  it('imports both collections, each into its own folder, in order', () => {
    expect(res.success).toBe(true)
    const shop = folderByName(pid, 'Shop API')
    const status = folderByName(pid, 'Status')
    expect(shop.parent_id).toBeNull()
    expect(status.parent_id).toBeNull()
    expect(namesIn(pid, status.id)).toEqual(['Health'])
    // order 1000, 2000, 3000; Realtime (4000) and Admin (5000) are folders.
    expect(namesIn(pid, shop.id)).toEqual(['List products', 'Get product :id', 'Create order'])
    const realtime = folderByName(pid, 'Realtime')
    const admin = folderByName(pid, 'Admin')
    expect(realtime.parent_id).toBe(shop.id)
    expect(admin.parent_id).toBe(shop.id)
    expect(realtime.sort_order).toBeLessThan(admin.sort_order)
    // No order → last.
    expect(namesIn(pid, admin.id)).toEqual([
      'Login',
      'Upload logo',
      'Audit',
      'GraphQL body',
      'No order',
    ])
    expect(namesIn(pid, realtime.id)).toEqual([
      'Feed socket',
      'Chat room',
      'Say hello',
      'Catalog query',
      'Tools',
      'Local server',
      'Assistant',
    ])
  })

  it('collection auth + http scripts go to the collection folder; other lifecycle scripts are reported', () => {
    const shop = folderByName(pid, 'Shop API')
    expect(JSON.parse(shop.auth!)).toEqual({
      type: 'bearer',
      bearer: { token: '{{accessToken}}', prefix: 'Bearer' },
    })
    expect(shop.pre_script).toContain("key: 'X-Client'")
    expect(shop.post_script).toContain('not 5xx')
    expect(res.warnings!.join('\n')).toMatch(/"grpc:beforeInvoke" script was not imported/)
    // Requests without auth inherit; an explicit noauth stays.
    expect(ep(pid, 'List products').schema.auth).toEqual({ type: 'inherit' })
    expect(ep(pid, 'Get product :id').schema.auth).toEqual({ type: 'none' })
  })

  it('maps an HTTP request: map headers, query rows, URL kept in sync, settings, examples', () => {
    const e = ep(pid, 'List products')
    expect(e.protocol).toBe('http')
    expect(e.schema.url).toBe('{{baseUrl}}/products?page=1&limit={{pageSize}}')
    expect(e.schema.params.map((p: any) => [p.key, p.value, p.enabled])).toEqual([
      ['page', '1', true],
      ['limit', '{{pageSize}}', true],
      ['draft', 'true', false],
    ])
    expect(e.schema.headers.map((h: any) => [h.key, h.value])).toEqual([
      ['Accept', 'application/json'],
      ['X-Trace', '{{$guid}}'],
    ])
    expect(e.schema.followRedirects).toBe(false)
    expect(e.schema.maxRedirects).toBe(3)
    expect(e.schema.sslVerification).toBe(false)
    const w = res.warnings!.join('\n')
    expect(w).toMatch(/List products.*query string and its query parameters disagreed/)
    expect(w).toMatch(/disableCookies=true/)
    const examples = getDb()
      .prepare(
        'SELECT name, status_code, response_json FROM saved_responses WHERE owner_id = ? ORDER BY created_at',
      )
      .all(e.id) as Array<{ name: string; status_code: number; response_json: string }>
    expect(examples.map((x) => [x.name, x.status_code])).toEqual([
      ['200 OK', 200],
      ['Server error', 500],
    ])
    expect(JSON.parse(examples[0].response_json).body).toBe('[{"id":1,"name":"Mug"}]')
  })

  it('path variables, scripts, bodies', () => {
    const g = ep(pid, 'Get product :id')
    expect(g.schema.pathVariables.map((v: any) => [v.key, v.value, v.description])).toEqual([
      ['id', '42', 'Product id'],
    ])
    const c = ep(pid, 'Create order')
    expect(c.description).toBe('Creates an order and keeps its id.')
    expect(c.schema.body).toEqual({
      type: 'json',
      content: '{\n  "productId": 42,\n  "quantity": 2\n}',
    })
    expect(c.schema.preScript).toBe("pm.variables.set('ts', Date.now());")
    expect(c.schema.postScript).toContain("pm.environment.set('orderId'")
    expect(ep(pid, 'Login').schema.body.urlEncoded.map((r: any) => r.key)).toEqual([
      'user',
      'remember',
    ])
    const up = ep(pid, 'Upload logo').schema.body
    expect(up.type).toBe('form-data')
    expect(up.formData[1]).toMatchObject({ key: 'image', type: 'file', filePath: './logo.png' })
    const gql = JSON.parse(ep(pid, 'GraphQL body').schema.body.content)
    expect(gql).toEqual({ query: '{ me { id } }', variables: { x: 1 } })
  })

  it('multi-auth takes the first set; a path-backed script inside the collection is read, one outside is refused', () => {
    const admin = folderByName(pid, 'Admin')
    expect(JSON.parse(admin.auth!)).toEqual({
      type: 'basic',
      basic: { username: '{{adminUser}}', password: '{{adminPassword}}' },
    })
    expect(admin.pre_script).toBe("pm.request.headers.add({ key: 'X-Signed', value: 'yes' });\n")
    const w = res.warnings!.join('\n')
    expect(w).toMatch(
      /multi-auth — only the first credential set "Admin basic" was imported; "Partner key" was not/,
    )
    expect(w).toMatch(/Audit\.request\.yaml.*outside\.js.*outside the collection folder/)
    expect(ep(pid, 'Audit').schema.postScript).toBeUndefined()
  })

  it('WebSocket: URL + params + headers, bearer → Authorization header, settings (bytes → MB), saved messages, legacy keys', () => {
    const e = ep(pid, 'Feed socket')
    expect(e.protocol).toBe('websocket')
    const m = e.schema.metadata.websocket
    expect(m.url).toBe('wss://feed.example.test/ws?room=general')
    expect(m.params.map((p: any) => [p.key, p.value])).toEqual([['room', 'general']])
    expect(m.customHeaders.map((h: any) => [h.key, h.value])).toEqual([
      ['X-Client', 'testnizer'],
      ['Authorization', 'Bearer {{feedToken}}'],
    ])
    expect(m.settings).toEqual({
      strictSSL: false,
      handshakeTimeout: 5000,
      retryCount: 2,
      retryDelay: 1500,
      maxPayload: 2,
    })
    expect(m.savedMessages.map((x: any) => [x.name, x.contentType])).toEqual([
      ['Hello', 'json'],
      ['Ping bytes', 'hex'],
    ])
    // Older builds read `composerMode` json | text.
    expect(m.composerMode).toBe('json')
    expect(readWsMeta(m).savedMessages).toHaveLength(2)
  })

  it('Socket.IO: namespace from the URL path, listeners with listen = subscribeOnConnect, messages, legacy keys', () => {
    const e = ep(pid, 'Chat room')
    expect(e.protocol).toBe('socketio')
    const m = e.schema.metadata.socketio
    expect(m.url).toBe('https://io.example.test')
    expect(m.namespace).toBe('/chat')
    expect(m.listenAll).toBe(false)
    expect(m.listeners.map((l: any) => [l.name, l.description, l.listen])).toEqual([
      ['message', 'A chat line', true],
      ['typing', '', false],
    ])
    expect(m.settings).toMatchObject({
      version: '4',
      path: '/realtime',
      handshakeTimeout: 8000,
      retryCount: 1,
      retryDelay: 2000,
    })
    expect(m.savedMessages[0]).toMatchObject({
      name: 'Say hi',
      description: 'The first line',
      eventName: 'message',
      acknowledgement: true,
    })
    expect(m.savedMessages[0].args.map((a: any) => [a.content, a.contentType])).toEqual([
      ['{"text":"hi"}', 'json'],
      ['second', 'text'],
    ])
    // Older builds read `subscriptions` + `emitPayload`.
    expect(m.subscriptions).toEqual(['message'])
    expect(m.emitPayload).toBe('{"text":"hi"}')
    expect(readSioMeta(m).listenAll).toBe(false)
  })

  it('gRPC: grpcs → TLS, method path split, metadata; proto file and settings reported', () => {
    const e = ep(pid, 'Say hello')
    expect(e.protocol).toBe('grpc')
    expect(e.path).toBe('demo.Greeter/SayHello')
    expect(e.schema.metadata.grpc).toMatchObject({
      address: 'grpc.example.test:443',
      useTls: true,
      protoSource: 'file',
      selectedService: 'demo.Greeter',
      selectedMethod: 'SayHello',
      requestBody: '{ "name": "{{userName}}" }',
    })
    expect(e.schema.metadata.grpc.metadata.map((r: any) => [r.key, r.value])).toEqual([
      ['x-tenant', 'acme'],
    ])
    const w = res.warnings!.join('\n')
    expect(w).toMatch(/proto file "\.\.\/protos\/greeter\.proto"/)
    expect(w).toMatch(/includeDefaultFields=true/)
    expect(w).toMatch(/Say hello.*"beforeInvoke" script was not imported/)
  })

  it('GraphQL request → graphql protocol with query, variables, headers, inherited auth, scripts', () => {
    const e = ep(pid, 'Catalog query')
    expect(e.protocol).toBe('graphql')
    expect(e.schema.metadata.graphql).toMatchObject({
      url: 'https://shop.example.test/graphql',
      query: 'query Catalog { products { id name } }',
      variables: '{"first":10}',
    })
    expect(e.schema.metadata.graphql.headers.map((h: any) => h.key)).toEqual(['X-Gql'])
    expect(e.schema.body).toEqual({
      type: 'graphql',
      content: 'query Catalog { products { id name } }',
    })
    expect(e.schema.auth).toEqual({ type: 'inherit' })
    expect(e.schema.preScript).toBe("pm.variables.set('q', 1);")
    expect(e.schema.postScript).toContain("pm.test('ok'")
    expect(res.warnings!.join('\n')).toMatch(/operation name "Catalog"/)
  })

  it('MCP (HTTP): tool call with a bare {{var}} argument, bearer auth, protocol pin, timeout', () => {
    const e = ep(pid, 'Tools')
    expect(e.protocol).toBe('mcp')
    const m = e.schema.metadata.mcp
    expect(m.transport).toBe('http')
    expect(m.url).toBe('https://mcp.example.test/mcp')
    expect(m.customHeaders.map((h: any) => [h.key, h.value])).toEqual([['X-Mcp', '1']])
    expect(m.auth).toEqual({ type: 'bearer', bearer: { token: '{{mcpToken}}' } })
    expect(m.protocol).toBe('2026-07-28')
    expect(m.call.capabilityTab).toBe('tools')
    expect(m.call.selectedTool).toBe('search')
    expect(m.call.toolArgs).toBe('{\n  "query": "mug",\n  "limit": {{limit}}\n}')
    expect(e.schema.timeout).toBe(45000)
  })

  it('MCP (stdio): command line + env, resource read; never trusted — Run refuses it until a Connect', async () => {
    const e = ep(pid, 'Local server')
    const m = e.schema.metadata.mcp
    expect(m.transport).toBe('stdio')
    expect(m.url).toBe('npx -y @modelcontextprotocol/server-everything')
    expect(m.envVars.map((r: any) => [r.key, r.value])).toEqual([['LOG_LEVEL', 'debug']])
    expect(m.call).toEqual({
      capabilityTab: 'resources',
      selectedResourceUri: 'file:///readme.md',
      resourceUriDraft: 'file:///readme.md',
    })
    expect(m.protocol).toBe('legacy')
    expect(trustStore.size).toBe(0)
    expect(
      await trust.isStdioServerTrusted({ projectId: pid, url: m.url, env: { LOG_LEVEL: 'debug' } }),
    ).toBe(false)
    expect(res.warnings!.join('\n')).toMatch(/stdio MCP server .* only after you connect it once/)
  })

  it('LLM → AI Chat with the saved key switched off; the credential in the file is never stored', () => {
    const e = ep(pid, 'Assistant')
    expect(e.protocol).toBe('ai')
    expect(e.schema.metadata.ai).toEqual({
      provider: 'openai',
      customUrl: 'https://llm.example.test/v1/chat/completions',
      model: 'gpt-4o-mini',
      systemPrompt: 'You are a shop assistant.',
      customHeaders: [],
      temperature: 0.3,
      maxTokens: 256,
      toolServers: [],
      savedKeyDisabled: true,
    })
    const dump = JSON.stringify(
      getDb().prepare('SELECT * FROM endpoints WHERE project_id = ?').all(pid),
    )
    expect(dump).not.toContain('sk-live-should-never-be-imported')
    const w = res.warnings!.join('\n')
    expect(w).toMatch(/Assistant.*1 user prompt\(s\) were not imported/)
    expect(w).toMatch(/Assistant.*topP/)
    expect(w).toMatch(/Assistant.*credentials in the file were not imported/)
  })

  it('MQTT, Kafka and unknown kinds are skipped and reported', () => {
    const w = res.warnings!.join('\n')
    expect(w).toMatch(
      /"Realtime \/ Broker": MQTT request skipped — MQTT support is coming \(issue #284\)/,
    )
    expect(w).toMatch(/Orders topic.*Kafka request skipped/)
    expect(w).toMatch(/Pigeon.*unknown request kind "carrier-pigeon-request" skipped/)
    expect(endpoints(pid).some((e) => ['Broker', 'Orders topic', 'Pigeon'].includes(e.name))).toBe(
      false,
    )
  })

  it('unknown files and Native Git side content are listed, not imported', () => {
    const w = res.warnings!.join('\n')
    expect(w).toMatch(/Found in the folder and not imported: .*postman\/specs\//)
    expect(w).toMatch(/notes\.txt/)
    expect(w).toMatch(/\.postman\//)
    expect(w).not.toMatch(/sign\.js/)
  })

  it('variables: collection + folder variables → "(imported)" env; vault secret → empty secret + re-enter note', () => {
    const db = getDb()
    const env = db
      .prepare('SELECT id FROM environments WHERE project_id = ? AND name = ?')
      .get(pid, 'Shop API (imported)') as { id: string }
    expect(env).toBeTruthy()
    const vars = db
      .prepare(
        'SELECT key, value, secret, enabled FROM environment_variables WHERE environment_id = ? ORDER BY rowid',
      )
      .all(env.id) as Array<{ key: string; value: string; secret: number; enabled: number }>
    expect(vars.map((v) => v.key)).toEqual([
      'baseUrl',
      'pageSize',
      'legacy',
      'vaultToken',
      'adminUser',
    ])
    expect(vars.find((v) => v.key === 'legacy')!.enabled).toBe(0)
    const vault = vars.find((v) => v.key === 'vaultToken')!
    expect(vault.secret).toBe(1)
    expect(res.warnings!.join('\n')).toMatch(
      /"vaultToken" is linked to a postman vault secret; imported as an empty secret — enter its value/,
    )
  })

  it('environment and globals YAML → project environments; secrets sealed at rest', () => {
    const db = getDb()
    const staging = db
      .prepare('SELECT id FROM environments WHERE project_id = ? AND name = ?')
      .get(pid, 'Staging') as {
      id: string
    }
    const rows = db
      .prepare(
        'SELECT key, value, secret, enabled FROM environment_variables WHERE environment_id = ? ORDER BY rowid',
      )
      .all(staging.id) as Array<{ key: string; value: string; secret: number; enabled: number }>
    const token = rows.find((r) => r.key === 'accessToken')!
    expect(token.secret).toBe(1)
    expect(token.value.startsWith('enc:v1:')).toBe(true)
    expect(token.value).not.toContain('staging-token-literal')
    expect(rows.find((r) => r.key === 'disabledVar')!.enabled).toBe(0)
    const globals = db
      .prepare('SELECT id FROM environments WHERE project_id = ? AND name = ?')
      .get(pid, 'Globals') as {
      id: string
    }
    expect(globals).toBeTruthy()
  })
})

describe('issue #276 part 2 — a single collection folder and a v3 JSON file', () => {
  it('a collection folder without a definition imports into the chosen folder, ordered by `order`', async () => {
    const pid = newProject()
    const fid = 'pmv3-target'
    getDb()
      .prepare(
        'INSERT INTO folders (id, project_id, parent_id, name, sort_order) VALUES (?, ?, NULL, ?, 0)',
      )
      .run(fid, pid, 'Target')
    const r = await importFolder(pid, path.join(FIX, 'collection-only'), fid)
    expect(r.success).toBe(true)
    expect(namesIn(pid, fid)).toEqual(['Echo', 'Ping'])
    expect(ep(pid, 'Echo').schema.body).toEqual({ type: 'text', content: 'hello' })
  })

  it('a monolithic v3 JSON collection imports through import:postman (detector routes it)', async () => {
    const pid = newProject()
    const r = await importText(pid, fs.readFileSync(path.join(FIX, 'all-kinds.v3.json'), 'utf-8'))
    expect(r.success).toBe(true)
    expect(r.endpointCount).toBe(7)
    expect(endpoints(pid).map((e) => [e.name, e.protocol])).toEqual([
      ['Create user', 'http'],
      ['GQL', 'graphql'],
      ['Hello', 'grpc'],
      ['WS', 'websocket'],
      ['SIO', 'socketio'],
      ['MCP', 'mcp'],
      ['LLM', 'ai'],
    ])
    // Collection auth with a {{var}} credential → project auth (project root, no auth yet).
    expect((readSharedProjectSettings(pid)?.auth as { type: string }).type).toBe('bearer')
    expect(ep(pid, 'MCP').schema.metadata.mcp).toMatchObject({
      transport: 'sse',
      call: { capabilityTab: 'prompts', selectedPrompt: 'greet', promptArgs: { who: 'ada' } },
    })
    expect(ep(pid, 'Create user').schema.pathVariables[0]).toMatchObject({ key: 'id', value: '7' })
    const w = r.warnings!.join('\n')
    expect(w).toMatch(/MQTT request skipped/)
    expect(w).toMatch(/Data \(database \/ file\) request skipped/)
  })

  it('a single v3 request file is refused with a pointer to "Import folder…", nothing written', async () => {
    const pid = newProject()
    const r = await importText(pid, '$kind: http-request\nname: Get\nmethod: GET\nurl: https://x\n')
    expect(r.success).toBe(false)
    expect(r.error).toMatch(/Import folder/)
    expect(endpoints(pid)).toHaveLength(0)
  })
})

describe('issue #276 part 2 — untrusted folder safety', () => {
  const made: string[] = []
  const mk = (files: Record<string, string>): string => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pmv3-safety-'))
    made.push(dir)
    for (const [rel, text] of Object.entries(files)) {
      const p = path.join(dir, rel)
      fs.mkdirSync(path.dirname(p), { recursive: true })
      fs.writeFileSync(p, text)
    }
    return dir
  }
  afterAll(() => {
    for (const d of made) fs.rmSync(d, { recursive: true, force: true })
  })

  it('symbolic links are not followed and are reported', async () => {
    const outside = mk({
      'Secret.request.yaml': '$kind: http-request\nurl: https://secret.example.test\n',
    })
    const dir = mk({ 'Ok.request.yaml': '$kind: http-request\nurl: https://ok.example.test\n' })
    fs.symlinkSync(path.join(outside, 'Secret.request.yaml'), path.join(dir, 'Link.request.yaml'))
    fs.symlinkSync(outside, path.join(dir, 'linked-dir'))
    const pid = newProject()
    const r = await importFolder(pid, dir)
    expect(r.success).toBe(true)
    expect(endpoints(pid).map((e) => e.name)).toEqual(['Ok'])
    expect(r.warnings!.join('\n')).toMatch(
      /"Link\.request\.yaml" is a symbolic link and was not followed/,
    )
    expect(r.warnings!.join('\n')).toMatch(/"linked-dir" is a symbolic link/)
  })

  it('a picked folder that is itself a symlink is refused', async () => {
    const real = mk({ 'A.request.yaml': '$kind: http-request\nurl: https://a.example.test\n' })
    const link = path.join(os.tmpdir(), `pmv3-link-${Date.now()}`)
    fs.symlinkSync(real, link)
    made.push(link)
    const picked = await pick(link)
    expect(picked.success).toBe(false)
    expect(picked.error).toMatch(/symbolic link/)
  })

  it('examples / messages paths that leave the collection are refused', async () => {
    const dir = mk({
      'col/A.request.yaml':
        '$kind: websocket-request\nurl: wss://a.example.test\nmessages: ../../elsewhere\n',
    })
    const pid = newProject()
    const r = await importFolder(pid, path.join(dir, 'col'))
    expect(r.warnings!.join('\n')).toMatch(
      /messages folder "\.\.\/\.\.\/elsewhere" is outside the collection folder/,
    )
  })

  it('an oversized file is refused before anything is written', async () => {
    const dir = mk({
      'A.request.yaml': '$kind: http-request\nurl: https://a.example.test\n',
      'Big.request.yaml': `$kind: http-request\nurl: https://b.example.test\ndescription: "${'x'.repeat(6 * 1024 * 1024)}"\n`,
    })
    const picked = await pick(dir)
    expect(picked.success).toBe(false)
    expect(picked.error).toMatch(/Big\.request\.yaml" is larger than 5 MB/)
  })

  it('a YAML alias bomb is refused', async () => {
    const lines = [
      '$kind: http-request',
      'url: https://a.example.test',
      'a0: &a0 [x, x, x, x, x, x, x, x, x, x]',
    ]
    for (let i = 1; i <= 8; i++) {
      lines.push(
        `a${i}: &a${i} [${Array(10)
          .fill(`*a${i - 1}`)
          .join(', ')}]`,
      )
    }
    const dir = mk({ 'Bomb.request.yaml': lines.join('\n') + '\n' })
    const picked = await pick(dir)
    expect(picked.success).toBe(false)
    expect(picked.error).toMatch(/too large .*aliases counted per use/)
  })

  it('a recursive alias and too-deep nesting are refused', async () => {
    const rec = mk({
      'R.request.yaml': '$kind: http-request\nurl: https://a.example.test\nself: &s\n  me: *s\n',
    })
    expect((await pick(rec)).error).toMatch(/recursive YAML alias/)
    const deep = mk({
      'D.request.yaml': `$kind: http-request\nurl: https://a.example.test\nx: ${'['.repeat(80)}${']'.repeat(80)}\n`,
    })
    expect((await pick(deep)).error).toMatch(/nested deeper than 64 levels/)
  })

  it('YAML custom tags are not executed (CORE schema)', async () => {
    const dir = mk({
      'T.request.yaml':
        '$kind: http-request\nurl: https://a.example.test\nx: !!js/function "function () { return 1 }"\n',
    })
    const picked = await pick(dir)
    expect(picked.success).toBe(false)
    expect(picked.error).toMatch(/not valid YAML/)
  })

  it('a folder that is not Postman v3 is refused with a clear message', async () => {
    const dir = mk({ 'readme.md': '# nothing' })
    const picked = await pick(dir)
    expect(picked.success).toBe(false)
    expect(picked.error).toMatch(/not a Postman v3 collection or workspace/)
  })
})
