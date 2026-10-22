/**
 * Issue #177 re-open (tester, 2026-10-14): an exported project file
 * (`dilek11_1.json`) still carried an HTTP mock bearer token in plain text,
 * while secret env values and the Mock MCP bearer were blank.
 *
 * Two leaks, both reproduced through the code the UI really runs:
 *   1. The "Auth required" preset (`createFromHttpPreset`, issue #140) wrote
 *      its generated token into the server DESCRIPTION — a plain-text column
 *      no boundary stripped. Projects created with that preset keep leaking
 *      until the description is scrubbed at the boundary too.
 *   2. Auth Config is a free JSON textarea (`MockServerEditor` →
 *      `JsonConfigField` → `JSON.parse` → `mock:server:update`). The strip
 *      only knew the canonical `{tokens|keys|users[].password}` shape; a
 *      `token` / `value` / top-level `password` field, or a JSON string typed
 *      into the field, went out untouched.
 *
 * Boundaries checked by a CANARY scan of the written text: Export Project
 * (`save:exportProject`), Save to folder (`save:local`), and the git working
 * tree / push / diff form (`stripLocalSecrets(exportProjectData())` — the exact
 * call git.handler.ts and `save:git*` make; the real-git plumbing is covered
 * by git-two-machines.test.ts). Duplicate keeps every secret. A stripped file
 * imported back (merge + replace) restores the local values; a fresh machine
 * gets blanks and the mock stays closed.
 *
 * Production schema (`openAndMigrate`), real `mock:*` and save handlers.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type Database from 'better-sqlite3'
import { setupHandlerHarness, makeElectronMock, seedProject, seedWorkspace } from './helpers'

const harness = setupHandlerHarness()

vi.mock('electron', () => ({
  ...makeElectronMock(),
  BrowserWindow: {
    getFocusedWindow: () => null,
    getAllWindows: () => [],
    fromWebContents: () => null,
    fromId: () => null,
  },
}))

let testDb: Database.Database
vi.mock('../../../src/main/db/database', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/main/db/database')>()
  return { ...actual, getDb: () => testDb }
})

vi.mock('../../../src/main/lib/secure-storage', () => ({
  // A consistent stand-in for the safeStorage envelope: idempotent like the
  // real `encryptSecret`, recognised by `isEncryptedSecret` (issue #239 —
  // values marked secret are sealed on every write).
  encryptSecret: (s: string | null | undefined) =>
    s ? (s.startsWith('enc:') ? s : `enc:${s}`) : null,
  decryptSecret: (s: string | null | undefined) => (s ? s.replace(/^enc:/, '') : null),
  isEncryptedSecret: (s: unknown): s is string => typeof s === 'string' && s.startsWith('enc:'),
  isEncryptionAvailable: () => true,
}))

vi.mock('../../../src/main/ipc/import-export.handler', () => ({
  importPostman: vi.fn(),
  importInsomnia: vi.fn(),
}))

vi.mock('../../../src/main/ipc/test-suite.handler', () => ({
  snapshotEndpointForSuite: vi.fn(() => ({})),
  ensureUniqueSuiteName: (_db: unknown, _pid: string, name: string) => name,
}))

class FakeMockManager extends EventEmitter {
  status = (): 'stopped' => 'stopped'
  list = vi.fn(() => [])
  start = vi.fn(async () => ({ ok: true as const }))
  stop = vi.fn(async () => undefined)
  update = vi.fn(async () => undefined)
  getLogs = vi.fn(() => [])
  clearLogs = vi.fn(() => undefined)
}
vi.mock('../../../src/main/mock/server', () => ({ mockServerManager: new FakeMockManager() }))
vi.mock('../../../src/main/mock/importers', () => ({
  importOpenApi: vi.fn(),
  importPostman: vi.fn(),
}))

const electron = await import('electron')
const dialogMock = (electron as unknown as { dialog: { showSaveDialog: ReturnType<typeof vi.fn> } })
  .dialog

const { openAndMigrate } = await import('../../../src/main/db/database')
const { registerSaveHandlers, exportProjectData, importProjectDataFromJson } =
  await import('../../../src/main/ipc/save.handler')
const { registerMockHandlers } = await import('../../../src/main/ipc/mock.handler')
const { stripLocalSecrets } = await import('../../../src/main/lib/local-secrets')
const { checkAuth, resolveAuthConfig } = await import('../../../src/main/mock/auth')
const { buildHttpPreset, createFromHttpPreset } =
  await import('../../../src/renderer/components/mock/mock-http-presets')
type AuthConfig = Parameters<typeof checkAuth>[0]['config']

type Envelope<T> = { success: boolean; error?: string; data?: T }
type Row = Record<string, unknown>
interface ServerView {
  id: string
  description: string
  authConfig: Record<string, unknown>
}
interface EndpointView {
  id: string
  path: string
}

const invoke = <T>(channel: string, ...args: unknown[]): Promise<Envelope<T>> =>
  harness.invoke(channel, ...args) as Promise<Envelope<T>>

function installMockBridge(): void {
  vi.stubGlobal('window', {
    api: {
      mock: {
        server: {
          create: (input: unknown) => invoke('mock:server:create', input),
          update: (id: string, patch: unknown) => invoke('mock:server:update', id, patch),
          delete: (id: string) => invoke('mock:server:delete', id),
        },
        endpoint: { create: (input: unknown) => invoke('mock:endpoint:create', input) },
        response: { create: (input: unknown) => invoke('mock:response:create', input) },
      },
    },
  })
}

/** What the mock editor's Auth Config textarea commits: `JSON.parse(text)`. */
function typed(text: string): unknown {
  return JSON.parse(text)
}

let dir: string

beforeEach(() => {
  harness.reset()
  dialogMock.showSaveDialog.mockReset()
  dir = mkdtempSync(join(tmpdir(), 'tnz-mock-auth-177-'))
  testDb = openAndMigrate(join(dir, 'testnizer.db'))
  registerSaveHandlers()
  registerMockHandlers()
  installMockBridge()
})

afterEach(() => {
  vi.unstubAllGlobals()
  testDb.close()
  rmSync(dir, { recursive: true, force: true })
})

// ─── Fixture: the tester's project, built through the UI code ───

const TESTER_TOKEN = 'http-mock-bearer-177-test'
const NC_BEARER = 'nc-bearer-single-177'
const NC_APIKEY_VALUE = 'nc-apikey-value-177'
const NC_BASIC_PW = 'nc-basic-password-177'
const DOUBLE_ENCODED = 'double-encoded-tok-177'
const EP_KEY = 'endpoint-key-177-abc'
const EP_PW = 'endpoint-pw-177-abc'

interface Built {
  workspaceId: string
  projectId: string
  /** The token the preset generated (and used to write into the description). */
  presetToken: string
  authServerId: string
  /** server id → the auth config as the editor committed it */
  serverAuth: Map<string, unknown>
  endpointId: string
  endpointAuth: unknown
  /** Every secret value that must never reach a file. */
  canaries: string[]
}

async function build(): Promise<Built> {
  const workspaceId = seedWorkspace(testDb)
  const projectId = seedProject(testDb, workspaceId, 'dilek11')
  const serverAuth = new Map<string, unknown>()

  // 1. "New mock server" → Auth required preset, 127.0.0.1:3001.
  const created = await createFromHttpPreset(projectId, buildHttpPreset('auth'), 'Auth API', 3001)
  expect(created.error).toBeUndefined()
  const authServer = created.server!
  const presetAuth = authServer.authConfig as { type: string; tokens: string[] }
  expect(presetAuth.type).toBe('bearer')
  const presetToken = presetAuth.tokens[0]
  // An Auth API made by an older build: the token is in the description.
  await invoke('mock:server:update', authServer.id, {
    description: `Requests need "Authorization: Bearer ${presetToken}" (GET /public is open).`,
  })

  // 2. The tester replaces the token in Auth Config (exact UI shape).
  const testerAuth = typed(`{ "type": "bearer", "tokens": ["${TESTER_TOKEN}", "${presetToken}"] }`)
  expect(
    (await invoke('mock:server:update', authServer.id, { authConfig: testerAuth })).error,
  ).toBeUndefined()
  serverAuth.set(authServer.id, testerAuth)

  // 3. Other shapes the free JSON field accepts.
  const shapes: [string, unknown][] = [
    ['Single token', typed(`{ "type": "bearer", "token": "${NC_BEARER}" }`)],
    [
      'Key as value',
      typed(
        `{ "type": "apiKey", "in": "header", "name": "X-API-Key", "value": "${NC_APIKEY_VALUE}" }`,
      ),
    ],
    ['Flat basic', typed(`{ "type": "basic", "username": "qa", "password": "${NC_BASIC_PW}" }`)],
    // A JSON string typed into the field (quoted JSON) — the repo stores it double-encoded.
    ['Quoted JSON', JSON.stringify({ type: 'bearer', tokens: [DOUBLE_ENCODED] })],
  ]
  for (const [i, [name, auth]] of shapes.entries()) {
    const s = await invoke<ServerView>('mock:server:create', { projectId, name, port: 3010 + i })
    expect(s.error).toBeUndefined()
    expect(
      (await invoke('mock:server:update', s.data!.id, { authConfig: auth })).error,
    ).toBeUndefined()
    serverAuth.set(s.data!.id, auth)
  }

  // 4. Endpoint Auth Override on the preset's /me (same textarea, same shapes).
  const eps = await invoke<EndpointView[]>('mock:endpoint:list', authServer.id)
  const me = eps.data!.find((e) => e.path === '/me')!
  const endpointAuth = typed(
    `{ "type": "basic", "users": [{ "username": "alice", "password": "${EP_PW}" }], "keys": ["${EP_KEY}"] }`,
  )
  expect(
    (await invoke('mock:endpoint:update', me.id, { authOverride: endpointAuth })).error,
  ).toBeUndefined()

  return {
    workspaceId,
    projectId,
    presetToken,
    authServerId: authServer.id,
    serverAuth,
    endpointId: me.id,
    endpointAuth,
    canaries: [
      TESTER_TOKEN,
      presetToken,
      NC_BEARER,
      NC_APIKEY_VALUE,
      NC_BASIC_PW,
      DOUBLE_ENCODED,
      EP_KEY,
      EP_PW,
    ],
  }
}

function expectNoCanary(text: string, b: Built, where: string): void {
  const leaked = b.canaries.filter((c) => text.includes(c))
  expect(leaked, `${where} leaks`).toEqual([])
}

const dbAuth = (id: string): string =>
  (testDb.prepare('SELECT auth_config FROM mock_servers WHERE id = ?').get(id) as Row)
    .auth_config as string

// ─── Export boundaries ───────────────────────────────────────────

describe('HTTP mock auth never reaches a project file, whatever shape the editor wrote (issue #177)', () => {
  it('Export Project (save dialog): canary scan of the written file', async () => {
    const b = await build()
    const target = join(dir, 'dilek11_1.json')
    dialogMock.showSaveDialog.mockResolvedValueOnce({ canceled: false, filePath: target })
    const res = await invoke('save:exportProject', b.projectId)
    expect(res.error).toBeUndefined()
    const text = readFileSync(target, 'utf-8')
    expectNoCanary(text, b, 'Export Project')

    // Structure survives: the user re-enters only the secret.
    const doc = JSON.parse(text) as { mockServers: Row[]; mockEndpoints: Row[] }
    const auth = (id: string): unknown =>
      JSON.parse(doc.mockServers.find((r) => r.id === id)!.auth_config as string)
    expect(auth(b.authServerId)).toEqual({ type: 'bearer', tokens: ['', ''] })
    const byName = (n: string): Row => doc.mockServers.find((r) => r.name === n)!
    expect(JSON.parse(byName('Key as value').auth_config as string)).toEqual({
      type: 'apiKey',
      in: 'header',
      name: 'X-API-Key',
      value: '',
    })
    expect(JSON.parse(byName('Flat basic').auth_config as string)).toEqual({
      type: 'basic',
      username: 'qa',
      password: '',
    })
    expect(
      JSON.parse(doc.mockEndpoints.find((r) => r.id === b.endpointId)!.auth_override as string),
    ).toEqual({ type: 'basic', users: [{ username: 'alice', password: '' }], keys: [''] })
    expect(doc.mockServers.find((r) => r.id === b.authServerId)!.description).toBe(
      'Requests need "Authorization: Bearer ••••••" (GET /public is open).',
    )
  })

  it('Save to folder (save:local): canary scan', async () => {
    const b = await build()
    const res = await invoke<{ path: string }>('save:local', {
      projectId: b.projectId,
      directoryPath: dir,
    })
    expect(res.error).toBeUndefined()
    expectNoCanary(readFileSync(res.data!.path, 'utf-8'), b, 'Save to folder')
  })

  it('git working tree / push / diff form: canary scan', async () => {
    const b = await build()
    const text = JSON.stringify(stripLocalSecrets(exportProjectData(b.projectId)), null, 2)
    expectNoCanary(text, b, 'git sync')
  })

  it('a new "Auth required" preset keeps its token out of the description', async () => {
    const workspaceId = seedWorkspace(testDb)
    const projectId = seedProject(testDb, workspaceId, 'fresh')
    const created = await createFromHttpPreset(projectId, buildHttpPreset('auth'), 'Auth API', 3001)
    const token = (created.server!.authConfig as { tokens: string[] }).tokens[0]
    expect(created.server!.description).not.toContain(token)
    const res = await invoke<{ path: string }>('save:local', { projectId, directoryPath: dir })
    expect(readFileSync(res.data!.path, 'utf-8')).not.toContain(token)
  })

  it('Duplicate keeps every secret and the description (the copy stays on this machine)', async () => {
    const b = await build()
    const dup = await invoke<{ projectId: string }>('project:duplicate', {
      projectId: b.projectId,
      workspaceId: b.workspaceId,
    })
    expect(dup.error).toBeUndefined()
    const copyRows = testDb
      .prepare('SELECT name, description, auth_config FROM mock_servers WHERE project_id = ?')
      .all(dup.data!.projectId) as Row[]
    const all = JSON.stringify(copyRows)
    for (const c of [TESTER_TOKEN, b.presetToken, NC_BEARER, NC_APIKEY_VALUE, NC_BASIC_PW]) {
      expect(all).toContain(c)
    }
    const source = testDb
      .prepare('SELECT name, description, auth_config FROM mock_servers WHERE project_id = ?')
      .all(b.projectId) as Row[]
    expect(copyRows).toEqual(source)
  })
})

// ─── Import boundary ─────────────────────────────────────────────

describe('a stripped file imported back keeps this machine’s mock secrets (issue #177)', () => {
  for (const mode of ['merge', 'replace'] as const) {
    it(`${mode}: every auth shape and the masked description come back from the local row`, async () => {
      const b = await build()
      const before = testDb
        .prepare(
          'SELECT id, description, auth_config FROM mock_servers WHERE project_id = ? ORDER BY id',
        )
        .all(b.projectId) as Row[]
      const beforeEp = testDb
        .prepare('SELECT auth_override, description FROM mock_endpoints WHERE id = ?')
        .get(b.endpointId) as Row
      const res = await invoke<{ path: string }>('save:local', {
        projectId: b.projectId,
        directoryPath: dir,
      })
      const text = readFileSync(res.data!.path, 'utf-8')
      expectNoCanary(text, b, 'Save to folder')

      await importProjectDataFromJson(text, b.projectId, { mode })

      const after = testDb
        .prepare(
          'SELECT id, description, auth_config FROM mock_servers WHERE project_id = ? ORDER BY id',
        )
        .all(b.projectId) as Row[]
      expect(after).toEqual(before)
      expect(
        testDb
          .prepare('SELECT auth_override, description FROM mock_endpoints WHERE id = ?')
          .get(b.endpointId),
      ).toEqual(beforeEp)
      // Spot-check the tester's own row: the token they typed is still there
      // (sealed at rest since issue #239 — the mock envelope is `enc:`).
      expect(
        JSON.parse(dbAuth(b.authServerId), (_k, v: unknown) =>
          typeof v === 'string' ? v.replace(/^enc:/, '') : v,
        ),
      ).toEqual(b.serverAuth.get(b.authServerId))
    })
  }

  it('a fresh machine gets blanks and every mock stays closed (fail-closed)', async () => {
    const b = await build()
    const res = await invoke<{ path: string }>('save:local', {
      projectId: b.projectId,
      directoryPath: dir,
    })
    const text = readFileSync(res.data!.path, 'utf-8')

    // Machine B: its own DB.
    testDb.close()
    testDb = openAndMigrate(join(dir, 'machine-b.db'))
    const ws = seedWorkspace(testDb, 'B')
    const pid = seedProject(testDb, ws, 'dilek11')
    await importProjectDataFromJson(text, pid)

    const rows = testDb.prepare('SELECT auth_config FROM mock_servers').all() as Row[]
    expect(rows).toHaveLength(5)
    expectNoCanary(JSON.stringify(rows), b, 'machine B DB')
    for (const r of rows) {
      const cfg = JSON.parse(r.auth_config as string) as AuthConfig
      const attempts = [
        { authorization: 'Bearer ' },
        { authorization: `Bearer ${TESTER_TOKEN}` },
        { authorization: `Basic ${Buffer.from('qa:').toString('base64')}` },
        { 'x-api-key': '' },
      ]
      for (const headers of attempts) {
        expect(checkAuth({ config: cfg, headers, query: {} }).ok).toBe(false)
      }
    }
    const override = JSON.parse(
      (
        testDb
          .prepare('SELECT auth_override FROM mock_endpoints WHERE id = ?')
          .get(b.endpointId) as Row
      ).auth_override as string,
    ) as AuthConfig
    const server = JSON.parse(dbAuth(b.authServerId)) as AuthConfig
    const effective = resolveAuthConfig(server, override)
    expect(
      checkAuth({
        config: effective,
        headers: { authorization: `Basic ${Buffer.from('alice:').toString('base64')}` },
        query: {},
      }).ok,
    ).toBe(false)
  })
})
