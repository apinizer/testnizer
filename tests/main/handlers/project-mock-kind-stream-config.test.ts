/**
 * Issue #221 (Faz 0) — `mock_servers.kind` and `mock_responses.stream_config`
 * travel with the project file (export / import / git / duplicate), and a
 * file written by an OLDER build — which does not carry the keys — keeps the
 * local values instead of resetting them (the issue #186 rule, Ek C R05).
 *
 * Real save handlers, real export / import, in-memory DBs (one per "machine").
 * The git boundary itself is covered column by column in
 * `git-project-fidelity.test.ts`.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { randomUUID } from 'crypto'
import type Database from 'better-sqlite3'
import {
  setupHandlerHarness,
  makeElectronMock,
  createTestDb,
  seedProject,
  seedWorkspace,
} from './helpers'

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
vi.mock('../../../src/main/db/database', () => ({
  getDb: () => testDb,
}))

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

const { registerSaveHandlers, exportProjectData, importProjectDataFromJson } =
  await import('../../../src/main/ipc/save.handler')

type Row = Record<string, unknown>
type Envelope<T> = { success: boolean; error?: string; data?: T }

beforeEach(() => {
  harness.reset()
  registerSaveHandlers()
})

const STREAM = '{"intervalMs":1000,"heartbeatMs":15000,"loop":true}'

interface Seeded {
  workspaceId: string
  projectId: string
  sseServerId: string
  aiServerId: string
  endpointId: string
  streamResponseId: string
  plainResponseId: string
}

function seed(db: Database.Database): Seeded {
  const workspaceId = seedWorkspace(db)
  const projectId = seedProject(db, workspaceId, 'Streams')
  const now = Date.now()
  const s: Seeded = {
    workspaceId,
    projectId,
    sseServerId: randomUUID(),
    aiServerId: randomUUID(),
    endpointId: randomUUID(),
    streamResponseId: randomUUID(),
    plainResponseId: randomUUID(),
  }
  const insServer = db.prepare(
    `INSERT INTO mock_servers (id, project_id, name, port, kind, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  )
  insServer.run(s.sseServerId, projectId, 'Ticker', 3201, 'sse', now, now)
  insServer.run(s.aiServerId, projectId, 'Chat API', 3301, 'ai', now, now)
  db.prepare(
    `INSERT INTO mock_endpoints (id, server_id, method, path, created_at, updated_at)
     VALUES (?, ?, 'GET', '/events', ?, ?)`,
  ).run(s.endpointId, s.sseServerId, now, now)
  const insResp = db.prepare(
    `INSERT INTO mock_responses (id, endpoint_id, name, body_type, body, response_order, stream_config)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  )
  insResp.run(s.streamResponseId, s.endpointId, 'Ticks', 'sse', 'data: {{stream.seq}}', 0, STREAM)
  insResp.run(s.plainResponseId, s.endpointId, 'Error', 'json', '{"error":1}', 1, null)
  return s
}

const rowsOf = (doc: Row, section: string): Row[] => (doc[section] as Row[] | undefined) ?? []
const byId = (rows: Row[], id: string): Row => rows.find((r) => r.id === id) as Row

const kindOf = (id: string): unknown =>
  (testDb.prepare('SELECT kind FROM mock_servers WHERE id = ?').get(id) as Row | undefined)?.kind
const streamOf = (id: string): unknown =>
  (
    testDb.prepare('SELECT stream_config FROM mock_responses WHERE id = ?').get(id) as
      | Row
      | undefined
  )?.stream_config

/** The live export as plain JSON (what lands in the file). */
const fileOf = (projectId: string): Row =>
  JSON.parse(JSON.stringify(exportProjectData(projectId))) as Row

/** What a pre-#221 build wrote: the same export, minus the new keys. */
function oldFile(projectId: string): Row {
  const doc = fileOf(projectId)
  for (const r of rowsOf(doc, 'mockServers')) delete r.kind
  for (const r of rowsOf(doc, 'mockResponses')) delete r.stream_config
  return doc
}

describe('project file carries the mock kind + stream_config (issue #221)', () => {
  it('export writes both columns', () => {
    testDb = createTestDb()
    const s = seed(testDb)
    const doc = fileOf(s.projectId)
    expect(byId(rowsOf(doc, 'mockServers'), s.sseServerId).kind).toBe('sse')
    expect(byId(rowsOf(doc, 'mockServers'), s.aiServerId).kind).toBe('ai')
    expect(byId(rowsOf(doc, 'mockResponses'), s.streamResponseId).stream_config).toBe(STREAM)
    expect(byId(rowsOf(doc, 'mockResponses'), s.plainResponseId).stream_config).toBeNull()
  })

  it('a fresh machine (pull / Clone) gets them verbatim', async () => {
    testDb = createTestDb()
    const s = seed(testDb)
    const doc = fileOf(s.projectId)

    testDb = createTestDb()
    const pid = seedProject(testDb, seedWorkspace(testDb, 'B'), 'Streams')
    await importProjectDataFromJson(JSON.stringify(doc), pid)

    expect(kindOf(s.sseServerId)).toBe('sse')
    expect(kindOf(s.aiServerId)).toBe('ai')
    expect(streamOf(s.streamResponseId)).toBe(STREAM)
    expect(streamOf(s.plainResponseId)).toBeNull()
  })

  it('the file wins when it carries the keys: a changed kind and an explicit null clear', async () => {
    testDb = createTestDb()
    const s = seed(testDb)
    const doc = fileOf(s.projectId)
    byId(rowsOf(doc, 'mockServers'), s.sseServerId).kind = 'ai'
    byId(rowsOf(doc, 'mockResponses'), s.streamResponseId).stream_config = null

    await importProjectDataFromJson(JSON.stringify(doc), s.projectId)

    expect(kindOf(s.sseServerId)).toBe('ai')
    expect(streamOf(s.streamResponseId)).toBeNull()
  })

  it('an explicit null kind (hand-edited file) keeps the local value — no NOT NULL abort', async () => {
    testDb = createTestDb()
    const s = seed(testDb)
    const doc = fileOf(s.projectId)
    byId(rowsOf(doc, 'mockServers'), s.sseServerId).kind = null
    byId(rowsOf(doc, 'mockResponses'), s.plainResponseId).name = 'Error (from file)'

    await importProjectDataFromJson(JSON.stringify(doc), s.projectId)

    expect(kindOf(s.sseServerId)).toBe('sse')
    // The import ran to the end — the section after mock_servers landed.
    expect(
      testDb.prepare('SELECT name FROM mock_responses WHERE id = ?').get(s.plainResponseId),
    ).toEqual({ name: 'Error (from file)' })
  })
})

describe('a project file without the #221 keys keeps local values (issue #186 rule)', () => {
  for (const mode of ['merge', 'replace'] as const) {
    it(`${mode} mode into the same project: local kind + stream_config survive`, async () => {
      testDb = createTestDb()
      const s = seed(testDb)
      const doc = oldFile(s.projectId)
      byId(rowsOf(doc, 'mockServers'), s.sseServerId).name = 'Ticker (old file)'
      byId(rowsOf(doc, 'mockResponses'), s.streamResponseId).name = 'Ticks (old file)'

      await importProjectDataFromJson(JSON.stringify(doc), s.projectId, { mode })

      expect(kindOf(s.sseServerId)).toBe('sse')
      expect(kindOf(s.aiServerId)).toBe('ai')
      expect(streamOf(s.streamResponseId)).toBe(STREAM)
      // The rest of each row is the file's word.
      expect(
        testDb.prepare('SELECT name FROM mock_servers WHERE id = ?').get(s.sseServerId),
      ).toEqual({ name: 'Ticker (old file)' })
      expect(
        testDb.prepare('SELECT name FROM mock_responses WHERE id = ?').get(s.streamResponseId),
      ).toEqual({ name: 'Ticks (old file)' })
    })
  }

  it('into a fresh DB: new rows take the defaults (kind http, stream_config NULL)', async () => {
    testDb = createTestDb()
    const s = seed(testDb)
    const doc = oldFile(s.projectId)

    testDb = createTestDb()
    const pid = seedProject(testDb, seedWorkspace(testDb, 'B'), 'Streams')
    await importProjectDataFromJson(JSON.stringify(doc), pid)

    expect(kindOf(s.sseServerId)).toBe('http')
    expect(kindOf(s.aiServerId)).toBe('http')
    expect(streamOf(s.streamResponseId)).toBeNull()
  })
})

describe('Duplicate Project copies the mock kind + stream_config (issue #221)', () => {
  it('the copy keeps kind and stream_config under fresh ids', async () => {
    testDb = createTestDb()
    const s = seed(testDb)
    const res = (await harness.invoke('project:duplicate', {
      projectId: s.projectId,
      workspaceId: s.workspaceId,
    })) as Envelope<{ projectId: string }>
    expect(res.error).toBeUndefined()
    const copy = res.data!.projectId

    const servers = testDb
      .prepare('SELECT id, name, kind FROM mock_servers WHERE project_id = ? ORDER BY name')
      .all(copy) as Row[]
    expect(servers.map((r) => [r.name, r.kind])).toEqual([
      ['Chat API', 'ai'],
      ['Ticker', 'sse'],
    ])
    expect(servers.map((r) => r.id)).not.toContain(s.sseServerId)
    const responses = testDb
      .prepare(
        `SELECT mr.id, mr.stream_config FROM mock_responses mr
         JOIN mock_endpoints me ON me.id = mr.endpoint_id
         JOIN mock_servers ms ON ms.id = me.server_id
         WHERE ms.project_id = ? ORDER BY mr.response_order`,
      )
      .all(copy) as Row[]
    expect(responses.map((r) => r.stream_config)).toEqual([STREAM, null])
    expect(responses.map((r) => r.id)).not.toContain(s.streamResponseId)
  })
})

describe('a kind changed in Settings travels with the project file (issue #222)', () => {
  it('update kind → export → pull on another machine: new kind, responses untouched', async () => {
    const { updateMockServer } = await import('../../../src/main/db/mock.repo')
    testDb = createTestDb()
    const s = seed(testDb)
    // The Settings "Server type" selector: SSE → HTTP.
    expect(updateMockServer(s.sseServerId, { kind: 'http' })?.kind).toBe('http')
    const doc = fileOf(s.projectId)
    expect(byId(rowsOf(doc, 'mockServers'), s.sseServerId).kind).toBe('http')

    testDb = createTestDb()
    const pid = seedProject(testDb, seedWorkspace(testDb, 'B'), 'Streams')
    await importProjectDataFromJson(JSON.stringify(doc), pid)

    expect(kindOf(s.sseServerId)).toBe('http')
    expect(kindOf(s.aiServerId)).toBe('ai')
    // The SSE response keeps its body type and stream settings — nothing is dropped.
    expect(streamOf(s.streamResponseId)).toBe(STREAM)
    expect(
      testDb.prepare('SELECT body_type FROM mock_responses WHERE id = ?').get(s.streamResponseId),
    ).toEqual({ body_type: 'sse' })
  })

  it('a pull of the changed file onto the machine that still has the old kind adopts it', async () => {
    const { updateMockServer } = await import('../../../src/main/db/mock.repo')
    testDb = createTestDb()
    const s = seed(testDb)
    const before = fileOf(s.projectId)
    updateMockServer(s.aiServerId, { kind: 'sse' })
    const changed = fileOf(s.projectId)
    // Back to the old kind locally, then pull the changed file (merge with base).
    updateMockServer(s.aiServerId, { kind: 'ai' })
    await importProjectDataFromJson(JSON.stringify(changed), s.projectId, {
      mode: 'merge',
      base: before as never,
    })
    expect(kindOf(s.aiServerId)).toBe('sse')
  })
})

/**
 * Issue #222: the advanced streaming settings live INSIDE `stream_config`
 * (SSE `errorEvent`; LLM `chunking: 'fixed'` + `chunkSize`, the new stop
 * reasons, `stopSequence`, `streamError`) — no column changes. A pull / Clone
 * carries them verbatim, and what arrives still passes save-time validation.
 */
describe('the #222 stream settings ride inside stream_config (no column change)', () => {
  const SSE_222 = JSON.stringify({
    intervalMs: 500,
    heartbeatMs: 0,
    loop: false,
    onEnd: 'close',
    resume: true,
    errorEvent: { afterEvents: 2, data: '{"error": "{{stream.seq}}"}' },
  })
  const LLM_222 = JSON.stringify({
    provider: 'anthropic',
    chunking: 'fixed',
    chunkSize: 5,
    chunkIntervalMs: 0,
    stopReason: 'stop_sequence',
    stopSequence: '\n\nUser:',
    toolCalls: [],
    usage: 'auto',
    streamError: { afterChunks: 3, type: 'overloaded_error', message: 'Overloaded' },
  })

  it('export → a fresh machine: both configs arrive byte-identical and still validate', async () => {
    testDb = createTestDb()
    const s = seed(testDb)
    const llmId = randomUUID()
    testDb
      .prepare('UPDATE mock_responses SET stream_config = ? WHERE id = ?')
      .run(SSE_222, s.streamResponseId)
    testDb
      .prepare(
        `INSERT INTO mock_responses (id, endpoint_id, name, body_type, body, response_order, stream_config)
         VALUES (?, ?, 'Reply', 'llm', 'Hello', 2, ?)`,
      )
      .run(llmId, s.endpointId, LLM_222)
    const doc = fileOf(s.projectId)
    expect(byId(rowsOf(doc, 'mockResponses'), llmId).stream_config).toBe(LLM_222)

    testDb = createTestDb()
    const pid = seedProject(testDb, seedWorkspace(testDb, 'B'), 'Streams')
    await importProjectDataFromJson(JSON.stringify(doc), pid)

    expect(streamOf(s.streamResponseId)).toBe(SSE_222)
    expect(streamOf(llmId)).toBe(LLM_222)
    const { validateLlmConfig, validateStreamConfig } =
      await import('../../../src/shared/mock-stream')
    expect(validateStreamConfig(JSON.parse(SSE_222))).toBeNull()
    expect(validateLlmConfig(JSON.parse(LLM_222))).toBeNull()
  })
})
