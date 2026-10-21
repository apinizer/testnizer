/**
 * Issue #190 re-open (tester, 2026-10-13): "Duplicate project drops HTTP mock
 * servers". The first test (`project-duplicate-mocks.test.ts`) seeds the mock
 * rows with raw SQL on the hand-kept test schema. This one walks the tester's
 * exact path end to end:
 *
 *   1. the "New mock server" dialog's real preset code (`createFromHttpPreset`
 *      over `window.api.mock`, issue #140/#148) — every call forwarded to the
 *      real `mock:*` IPC handlers;
 *   2. a hand-added `GET /health → 200 + body` endpoint, like the tester's;
 *   3. Home → project card ⋯ → Duplicate = `project:duplicate`
 *      (`ProjectHome.tsx` `handleDuplicateProject`);
 *   4. the Mocks panel's own read: `mock:server:list(copyId)` (what
 *      `mock.store.loadServers` calls), then endpoints and responses.
 *
 * The DB is the PRODUCTION schema (`openAndMigrate` on a temp file), not the
 * test helper's copy, so schema drift cannot hide a failing INSERT.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { mkdtempSync, rmSync } from 'node:fs'
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

const { openAndMigrate } = await import('../../../src/main/db/database')
const { registerSaveHandlers } = await import('../../../src/main/ipc/save.handler')
const { registerMockHandlers } = await import('../../../src/main/ipc/mock.handler')
const { createMockMcpServer, listMockMcpServers } =
  await import('../../../src/main/db/mock-mcp.repo')
const { buildHttpPreset, createFromHttpPreset } =
  await import('../../../src/renderer/components/mock/mock-http-presets')

type Envelope<T> = { success: boolean; error?: string; data?: T }
interface ServerView {
  id: string
  name: string
  port: number
  host: string
  autoStart: boolean
  authConfig: unknown
}
interface EndpointView {
  id: string
  method: string
  path: string
}
interface ResponseView {
  name: string
  statusCode: number
  body: string
}

const invoke = <T>(channel: string, ...args: unknown[]): Promise<Envelope<T>> =>
  harness.invoke(channel, ...args) as Promise<Envelope<T>>

/** `window.api.mock` as the preload exposes it, backed by the real handlers. */
function installMockBridge(): void {
  const api = {
    mock: {
      server: {
        create: (input: unknown) => invoke('mock:server:create', input),
        update: (id: string, patch: unknown) => invoke('mock:server:update', id, patch),
        delete: (id: string) => invoke('mock:server:delete', id),
      },
      endpoint: {
        create: (input: unknown) => invoke('mock:endpoint:create', input),
      },
      response: {
        create: (input: unknown) => invoke('mock:response:create', input),
      },
    },
  }
  vi.stubGlobal('window', { api })
}

let dir: string

beforeEach(() => {
  harness.reset()
  dir = mkdtempSync(join(tmpdir(), 'tnz-dup-preset-'))
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

/** What the Mocks panel shows for a project: servers → endpoints → responses. */
async function panelGraph(
  projectId: string,
): Promise<{ server: ServerView; endpoints: EndpointView[]; responses: ResponseView[][] }[]> {
  const servers = await invoke<ServerView[]>('mock:server:list', projectId)
  expect(servers.error).toBeUndefined()
  const out = []
  for (const server of servers.data ?? []) {
    const eps = await invoke<EndpointView[]>('mock:endpoint:list', server.id)
    const responses: ResponseView[][] = []
    for (const ep of eps.data ?? []) {
      const rs = await invoke<ResponseView[]>('mock:response:list', ep.id)
      responses.push(rs.data ?? [])
    }
    out.push({ server, endpoints: eps.data ?? [], responses })
  }
  return out
}

describe('Duplicate Project keeps preset-created HTTP mocks — tester path (issue #190)', () => {
  it('preset server on 127.0.0.1:3001 + GET /health → Home Duplicate → the copy lists it', async () => {
    const workspaceId = seedWorkspace(testDb)
    const projectId = seedProject(testDb, workspaceId, 'dilek11')

    // 1. "New mock server" dialog, Blank preset, port 3001 (the dialog's default).
    const blank = await createFromHttpPreset(projectId, buildHttpPreset('blank'), 'Health', 3001)
    expect(blank.error).toBeUndefined()
    // 2. "+ endpoint" GET /health with a 200 + body response.
    const ep = await invoke<EndpointView>('mock:endpoint:create', {
      serverId: blank.server!.id,
      method: 'GET',
      path: '/health',
      pathMode: 'exact',
    })
    expect(ep.error).toBeUndefined()
    const resp = await invoke('mock:response:create', {
      endpointId: ep.data!.id,
      name: 'OK',
      statusCode: 200,
      bodyType: 'json',
      body: '{"status":"up"}',
    })
    expect(resp.error).toBeUndefined()
    // A second server from a content preset (settings update + 4 endpoints).
    const rest = await createFromHttpPreset(projectId, buildHttpPreset('rest'), 'Users API', 3002)
    expect(rest.error).toBeUndefined()
    // And the "Auth required" preset (server auth + endpoint auth override).
    const auth = await createFromHttpPreset(projectId, buildHttpPreset('auth'), 'Auth API', 3003)
    expect(auth.error).toBeUndefined()

    // The tester's project also had Mock MCP servers — those WERE copied.
    createMockMcpServer({ projectId, name: 'Echo MCP', port: 3100 })

    const before = await panelGraph(projectId)
    expect(before.map((g) => g.server.name)).toEqual(['Health', 'Users API', 'Auth API'])

    // 3. Home → project card ⋯ → Duplicate.
    const dup = await invoke<{ projectId: string }>('project:duplicate', {
      projectId,
      workspaceId,
    })
    expect(dup.error).toBeUndefined()
    const copyId = dup.data!.projectId
    expect(copyId).not.toBe(projectId)

    // 4. Open the copy → Mocks → HTTP SERVERS.
    const after = await panelGraph(copyId)
    expect(after.map((g) => g.server.name)).toEqual(['Health', 'Users API', 'Auth API'])
    for (const [i, g] of after.entries()) {
      expect(g.server.id).not.toBe(before[i].server.id)
      expect(g.server).toMatchObject({ host: '127.0.0.1', port: before[i].server.port })
      expect(g.server.autoStart).toBe(false)
      expect(g.server.authConfig).toEqual(before[i].server.authConfig)
      expect(g.endpoints.map((e) => `${e.method} ${e.path}`)).toEqual(
        before[i].endpoints.map((e) => `${e.method} ${e.path}`),
      )
      expect(g.responses.map((rs) => rs.map((r) => [r.name, r.statusCode, r.body]))).toEqual(
        before[i].responses.map((rs) => rs.map((r) => [r.name, r.statusCode, r.body])),
      )
    }
    expect(after[0].endpoints.map((e) => e.path)).toEqual(['/health'])
    expect(after[0].responses[0][0]).toMatchObject({ statusCode: 200, body: '{"status":"up"}' })

    // …next to the MCP group, which was never the problem.
    expect(listMockMcpServers(copyId).map((m) => m.name)).toEqual(['Echo MCP'])

    // The original still has its own three servers.
    expect((await panelGraph(projectId)).map((g) => g.server.id)).toEqual(
      before.map((g) => g.server.id),
    )
  })
})
