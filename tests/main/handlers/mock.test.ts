/**
 * Smoke tests for `mock:*` IPC handlers.
 *
 * We stub the long-running `mockServerManager` (real network listeners would
 * leak between tests) and the OpenAPI/Postman importer helpers. The DB
 * repos are exercised against an in-memory better-sqlite3.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { EventEmitter } from 'node:events'
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

let testDb: ReturnType<typeof createTestDb>
vi.mock('../../../src/main/db/database', () => ({
  getDb: () => testDb,
}))

class FakeMockManager extends EventEmitter {
  private statusMap = new Map<string, 'running' | 'stopped'>()
  start = vi.fn(async (def: { id: string }) => {
    this.statusMap.set(def.id, 'running')
    return { ok: true as const }
  })
  stop = vi.fn(async (id: string) => {
    this.statusMap.set(id, 'stopped')
  })
  status = (id: string): 'running' | 'stopped' => this.statusMap.get(id) ?? 'stopped'
  update = vi.fn(async () => {})
  getLogs = vi.fn(() => [])
  clearLogs = vi.fn(() => {})
}
const fakeManager = new FakeMockManager()

vi.mock('../../../src/main/mock/server', () => ({
  mockServerManager: fakeManager,
}))

vi.mock('../../../src/main/mock/importers', () => ({
  importOpenApi: vi.fn(async () => ({ created: 1 })),
  importPostman: vi.fn(() => ({ created: 1 })),
}))

const { registerMockHandlers } = await import('../../../src/main/ipc/mock.handler')

let projectId: string

beforeEach(() => {
  harness.reset()
  testDb = createTestDb()
  projectId = seedProject(testDb, seedWorkspace(testDb))
  registerMockHandlers()
})

describe('mock:server CRUD', () => {
  it('creates and lists a mock server', async () => {
    const created = (await harness.invoke('mock:server:create', {
      projectId,
      name: 'mock-1',
      host: '127.0.0.1',
      port: 3000,
      basePath: '',
    })) as { success: boolean; data?: { id: string } }
    expect(created.success).toBe(true)

    const list = (await harness.invoke('mock:server:list', projectId)) as {
      success: boolean
      data?: unknown[]
    }
    expect(list.success).toBe(true)
    expect(list.data?.length).toBe(1)
  })

  it('returns error envelope on missing required fields', async () => {
    const res = (await harness.invoke('mock:server:create', {})) as {
      success: boolean
      error?: string
    }
    expect(res.success).toBe(false)
  })

  it('updates an existing server', async () => {
    const created = (await harness.invoke('mock:server:create', {
      projectId,
      name: 'mock-1',
      host: '127.0.0.1',
      port: 3000,
      basePath: '',
    })) as { data: { id: string } }
    const upd = (await harness.invoke('mock:server:update', created.data.id, {
      name: 'renamed',
    })) as { success: boolean }
    expect(upd.success).toBe(true)
  })
})

describe('mock:server lifecycle', () => {
  it('start + stop + status', async () => {
    const created = (await harness.invoke('mock:server:create', {
      projectId,
      name: 'mock-1',
      host: '127.0.0.1',
      port: 3000,
      basePath: '',
    })) as { data: { id: string } }

    const start = (await harness.invoke('mock:server:start', created.data.id)) as {
      success: boolean
      data?: { status: string }
    }
    expect(start.success).toBe(true)

    const status = (await harness.invoke('mock:server:status', created.data.id)) as {
      success: boolean
      data?: { status: string }
    }
    expect(status.success).toBe(true)
    expect(status.data?.status).toBe('running')

    const stop = (await harness.invoke('mock:server:stop', created.data.id)) as {
      success: boolean
    }
    expect(stop.success).toBe(true)
  })
})

describe('mock:endpoint + mock:response', () => {
  it('CRUDs an endpoint under a server', async () => {
    const srv = (await harness.invoke('mock:server:create', {
      projectId,
      name: 'mock-1',
      host: '127.0.0.1',
      port: 3000,
      basePath: '',
    })) as { data: { id: string } }

    const ep = (await harness.invoke('mock:endpoint:create', {
      serverId: srv.data.id,
      method: 'GET',
      path: '/users',
    })) as { success: boolean; data?: { id: string } }
    expect(ep.success).toBe(true)

    const list = (await harness.invoke('mock:endpoint:list', srv.data.id)) as {
      success: boolean
      data?: unknown[]
    }
    expect(list.success).toBe(true)
    expect(list.data?.length).toBe(1)
  })

  it('creates a response under an endpoint', async () => {
    const srv = (await harness.invoke('mock:server:create', {
      projectId,
      name: 'mock-1',
      host: '127.0.0.1',
      port: 3000,
      basePath: '',
    })) as { data: { id: string } }
    const ep = (await harness.invoke('mock:endpoint:create', {
      serverId: srv.data.id,
      method: 'GET',
      path: '/users',
    })) as { data: { id: string } }

    const r = (await harness.invoke('mock:response:create', {
      endpointId: ep.data.id,
      statusCode: 200,
      bodyType: 'json',
      body: '{}',
    })) as { success: boolean; data?: { id: string } }
    expect(r.success).toBe(true)
  })
})

describe('mock:import:* + mock:logs:*', () => {
  it('logs:get + logs:clear return envelopes', async () => {
    const get = (await harness.invoke('mock:logs:get', 'srv')) as { success: boolean }
    expect(get.success).toBe(true)
    const clr = (await harness.invoke('mock:logs:clear', 'srv')) as { success: boolean }
    expect(clr.success).toBe(true)
  })

  it('import:openapi returns success envelope', async () => {
    const res = (await harness.invoke('mock:import:openapi', 'srv-id', 'openapi: 3.0')) as {
      success: boolean
      data?: { created: number }
    }
    expect(res.success).toBe(true)
    expect(res.data?.created).toBe(1)
  })

  it('import:postman returns success envelope', async () => {
    const res = (await harness.invoke('mock:import:postman', 'srv-id', '{}')) as {
      success: boolean
    }
    expect(res.success).toBe(true)
  })
})

// ─── Issue #221 (Faz 0): server kind + response stream_config ────

describe('mock server kind + response stream_config (issue #221)', () => {
  type View = { success: boolean; error?: string; data?: Record<string, unknown> }

  const createServer = (over: Record<string, unknown> = {}): Promise<View> =>
    harness.invoke('mock:server:create', {
      projectId,
      name: 'mock-k',
      port: 3100,
      ...over,
    }) as Promise<View>

  it('defaults kind to http when absent — an old caller creates an HTTP server', async () => {
    const r = await createServer()
    expect(r.success).toBe(true)
    expect(r.data?.kind).toBe('http')
    expect(
      testDb.prepare('SELECT kind FROM mock_servers WHERE id = ?').get(r.data!.id as string),
    ).toEqual({ kind: 'http' })
  })

  it('stores sse / ai and returns them from get + list', async () => {
    const sse = await createServer({ kind: 'sse' })
    const ai = await createServer({ kind: 'ai', port: 3101 })
    expect(sse.data?.kind).toBe('sse')
    expect(ai.data?.kind).toBe('ai')
    const got = (await harness.invoke('mock:server:get', sse.data!.id)) as View
    expect(got.data?.kind).toBe('sse')
    const list = (await harness.invoke('mock:server:list', projectId)) as {
      data: { kind: string }[]
    }
    expect(list.data.map((s) => s.kind)).toEqual(['sse', 'ai'])
  })

  it('rejects an unknown kind on create (MCP is its own table) and writes nothing', async () => {
    for (const kind of ['mcp', 'x']) {
      const r = await createServer({ kind })
      expect(r.success).toBe(false)
      expect(r.error).toMatch(/Unknown mock server kind/)
    }
    expect(testDb.prepare('SELECT COUNT(*) AS n FROM mock_servers').get()).toEqual({ n: 0 })
  })

  // Issue #222 — the Settings tab's "Server type" selector. Before the fix
  // `UpdateMockServerInput` had no `kind` and the update ignored it.
  it('update changes the kind and keeps every endpoint and response row as it is', async () => {
    const r = await createServer({ kind: 'sse' })
    const id = r.data!.id as string
    const ep = (await harness.invoke('mock:endpoint:create', {
      serverId: id,
      method: 'GET',
      path: '/events',
    })) as { data: { id: string } }
    await harness.invoke('mock:response:create', {
      endpointId: ep.data.id,
      bodyType: 'sse',
      body: 'data: hi',
      streamConfig: { intervalMs: 250, heartbeatMs: 0, loop: false },
    })
    const before = testDb
      .prepare('SELECT body_type, body, stream_config FROM mock_responses WHERE endpoint_id = ?')
      .all(ep.data.id)

    const up = (await harness.invoke('mock:server:update', id, {
      name: 'renamed',
      kind: 'ai',
    })) as View
    expect(up.success).toBe(true)
    expect(up.data).toMatchObject({ name: 'renamed', kind: 'ai' })
    expect(testDb.prepare('SELECT kind FROM mock_servers WHERE id = ?').get(id)).toEqual({
      kind: 'ai',
    })
    expect(
      testDb
        .prepare('SELECT body_type, body, stream_config FROM mock_responses WHERE endpoint_id = ?')
        .all(ep.data.id),
    ).toEqual(before)
    expect(
      testDb.prepare('SELECT COUNT(*) AS n FROM mock_endpoints WHERE server_id = ?').get(id),
    ).toEqual({ n: 1 })
  })

  it('update rejects an unknown kind and leaves the stored one', async () => {
    const r = await createServer({ kind: 'sse' })
    for (const kind of ['mcp', 'x']) {
      const up = (await harness.invoke('mock:server:update', r.data!.id, { kind })) as View
      expect(up.success).toBe(false)
      expect(up.error).toMatch(/Unknown mock server kind/)
    }
    expect(
      testDb.prepare('SELECT kind FROM mock_servers WHERE id = ?').get(r.data!.id as string),
    ).toEqual({ kind: 'sse' })
  })

  it('an update without kind keeps a stored unknown kind byte-for-byte', async () => {
    const r = await createServer()
    testDb.prepare("UPDATE mock_servers SET kind = 'future' WHERE id = ?").run(r.data!.id)
    const up = (await harness.invoke('mock:server:update', r.data!.id, { name: 'x' })) as View
    expect(up.success).toBe(true)
    expect(
      testDb.prepare('SELECT kind FROM mock_servers WHERE id = ?').get(r.data!.id as string),
    ).toEqual({ kind: 'future' })
  })

  it('a stored unknown kind (file from another build) reads back as http, raw value untouched', async () => {
    const r = await createServer()
    testDb.prepare("UPDATE mock_servers SET kind = 'future' WHERE id = ?").run(r.data!.id)
    const got = (await harness.invoke('mock:server:get', r.data!.id)) as View
    expect(got.data?.kind).toBe('http')
    expect(
      testDb.prepare('SELECT kind FROM mock_servers WHERE id = ?').get(r.data!.id as string),
    ).toEqual({ kind: 'future' })
  })

  async function endpointId(): Promise<string> {
    const srv = await createServer({ kind: 'sse' })
    const ep = (await harness.invoke('mock:endpoint:create', {
      serverId: srv.data!.id,
      method: 'GET',
      path: '/events',
    })) as { data: { id: string } }
    return ep.data.id
  }

  const STREAM = { intervalMs: 1000, heartbeatMs: 15000, loop: true }

  it('round-trips stream_config on create; absent → null', async () => {
    const ep = await endpointId()
    const plain = (await harness.invoke('mock:response:create', {
      endpointId: ep,
      body: '{}',
      order: 0,
    })) as View
    expect(plain.data?.streamConfig).toBeNull()
    const streamed = (await harness.invoke('mock:response:create', {
      endpointId: ep,
      bodyType: 'json',
      body: 'data: hi',
      streamConfig: STREAM,
      order: 1,
    })) as View
    expect(streamed.success).toBe(true)
    expect(streamed.data?.streamConfig).toEqual(STREAM)
    expect(
      testDb
        .prepare('SELECT stream_config FROM mock_responses WHERE id = ?')
        .get(streamed.data!.id as string),
    ).toEqual({ stream_config: JSON.stringify(STREAM) })
    const list = (await harness.invoke('mock:response:list', ep)) as {
      data: { streamConfig: unknown }[]
    }
    expect(list.data.map((r) => r.streamConfig)).toEqual([null, STREAM])
  })

  it('update: undefined keeps stream_config, an object sets it, null clears it', async () => {
    const ep = await endpointId()
    const r = (await harness.invoke('mock:response:create', {
      endpointId: ep,
      streamConfig: STREAM,
    })) as View
    const id = r.data!.id as string
    const kept = (await harness.invoke('mock:response:update', id, { name: 'n' })) as View
    expect(kept.data?.streamConfig).toEqual(STREAM)
    const set = (await harness.invoke('mock:response:update', id, {
      streamConfig: { intervalMs: 5 },
    })) as View
    expect(set.data?.streamConfig).toEqual({ intervalMs: 5 })
    const cleared = (await harness.invoke('mock:response:update', id, {
      streamConfig: null,
    })) as View
    expect(cleared.data?.streamConfig).toBeNull()
    expect(testDb.prepare('SELECT stream_config FROM mock_responses WHERE id = ?').get(id)).toEqual(
      { stream_config: null },
    )
  })

  it('a stored non-object / corrupt stream_config reads back as null', async () => {
    const ep = await endpointId()
    const r = (await harness.invoke('mock:response:create', { endpointId: ep })) as View
    const id = r.data!.id as string
    for (const raw of ['not json', '[1,2]', '42']) {
      testDb.prepare('UPDATE mock_responses SET stream_config = ? WHERE id = ?').run(raw, id)
      const list = (await harness.invoke('mock:response:list', ep)) as {
        data: { streamConfig: unknown }[]
      }
      expect(list.data[0].streamConfig).toBeNull()
    }
  })

  // ─── Faz 1a: save-time validation + the engine definition ──────

  it('an sse response with invalid stream settings is refused on create and update', async () => {
    const ep = await endpointId()
    const bad = (await harness.invoke('mock:response:create', {
      endpointId: ep,
      bodyType: 'sse',
      body: 'data: x',
      streamConfig: { intervalMs: -1 },
    })) as View
    expect(bad.success).toBe(false)
    expect(bad.error).toMatch(/^Event interval must be a whole number of milliseconds/)
    expect(testDb.prepare('SELECT COUNT(*) AS n FROM mock_responses').get()).toEqual({ n: 0 })

    const good = (await harness.invoke('mock:response:create', {
      endpointId: ep,
      bodyType: 'sse',
      body: 'data: x',
      streamConfig: { intervalMs: 50, loop: true },
    })) as View
    expect(good.success).toBe(true)
    const id = good.data!.id as string
    // The stored row's body type decides when the patch does not carry one.
    const upd = (await harness.invoke('mock:response:update', id, {
      streamConfig: { onEnd: 'later' },
    })) as View
    expect(upd.success).toBe(false)
    expect(upd.error).toMatch(/close or stay open/)
    const cleared = (await harness.invoke('mock:response:update', id, {
      streamConfig: null,
    })) as View
    expect(cleared.success).toBe(true)
  })

  it('buildServerDef hands the engine a normalized config for sse rows only', async () => {
    const srv = await createServer({ kind: 'sse', port: 3201 })
    const ep = (await harness.invoke('mock:endpoint:create', {
      serverId: srv.data!.id,
      method: 'GET',
      path: '/events',
    })) as { data: { id: string } }
    await harness.invoke('mock:response:create', {
      endpointId: ep.data.id,
      bodyType: 'sse',
      body: 'data: x',
      streamConfig: { intervalMs: 0, loop: true },
      order: 0,
    })
    await harness.invoke('mock:response:create', {
      endpointId: ep.data.id,
      bodyType: 'json',
      body: '{}',
      streamConfig: STREAM,
      order: 1,
    })
    const started = (await harness.invoke('mock:server:start', srv.data!.id)) as View
    expect(started.success).toBe(true)
    const def = fakeManager.start.mock.calls.at(-1)![0] as unknown as {
      endpoints: { responses: { bodyType: string; streamConfig: unknown }[] }[]
    }
    expect(def.endpoints[0].responses.map((r) => [r.bodyType, r.streamConfig])).toEqual([
      ['sse', { intervalMs: 10, heartbeatMs: 0, loop: true, onEnd: 'close', resume: true }],
      ['json', null],
    ])
  })

  // ─── Faz 2a: AI (`llm`) reply settings in the same column ───────

  it('an llm response with invalid settings is refused on create and update; valid ones round-trip', async () => {
    const ep = await endpointId()
    const bad = (await harness.invoke('mock:response:create', {
      endpointId: ep,
      bodyType: 'llm',
      body: 'Hi',
      streamConfig: { provider: 'gemini' },
    })) as View
    expect(bad.success).toBe(false)
    expect(bad.error).toBe('Provider must be "openai" or "anthropic"')
    // An SSE key is not an LLM setting.
    const sseKey = (await harness.invoke('mock:response:create', {
      endpointId: ep,
      bodyType: 'llm',
      body: 'Hi',
      streamConfig: { intervalMs: 5 },
    })) as View
    expect(sseKey.error).toBe('Unknown LLM setting: intervalMs')
    expect(testDb.prepare('SELECT COUNT(*) AS n FROM mock_responses').get()).toEqual({ n: 0 })

    const LLM = {
      provider: 'anthropic',
      chunking: 'char',
      toolCalls: [{ name: 'echo', arguments: { text: '{{lastUserMessage}}' } }],
    }
    const good = (await harness.invoke('mock:response:create', {
      endpointId: ep,
      bodyType: 'llm',
      body: 'Hi',
      streamConfig: LLM,
    })) as View
    expect(good.success).toBe(true)
    expect(good.data?.streamConfig).toEqual(LLM)
    const id = good.data!.id as string
    // The stored row's body type (llm) decides when the patch does not carry one.
    const upd = (await harness.invoke('mock:response:update', id, {
      streamConfig: { stopReason: 'tool_calls' },
    })) as View
    expect(upd.success).toBe(false)
    expect(upd.error).toBe('Stop reason "tool_calls" needs at least one tool call')
    // A patch that switches the body type is checked against the NEW type.
    const toSse = (await harness.invoke('mock:response:update', id, {
      bodyType: 'sse',
      streamConfig: { provider: 'openai' },
    })) as View
    expect(toSse.error).toBe('Unknown stream setting: provider')
    const toJson = (await harness.invoke('mock:response:update', id, {
      bodyType: 'json',
      streamConfig: { provider: 'nope' },
    })) as View
    expect(toJson.success).toBe(true)
  })

  it('buildServerDef hands the engine a normalized llmConfig for llm rows only', async () => {
    const srv = await createServer({ kind: 'ai', port: 3301 })
    const ep = (await harness.invoke('mock:endpoint:create', {
      serverId: srv.data!.id,
      method: 'POST',
      path: '/v1/chat/completions',
    })) as { data: { id: string } }
    await harness.invoke('mock:response:create', {
      endpointId: ep.data.id,
      bodyType: 'llm',
      body: 'Hi',
      streamConfig: { provider: 'anthropic', chunkIntervalMs: 0 },
      order: 0,
    })
    const unset = (await harness.invoke('mock:response:create', {
      endpointId: ep.data.id,
      bodyType: 'llm',
      body: 'Hi',
      order: 1,
    })) as View
    // A foreign / corrupt stored value still serves (the defaults).
    testDb
      .prepare('UPDATE mock_responses SET stream_config = ? WHERE id = ?')
      .run('{"provider":"x","chunking":"sentence"}', unset.data!.id)
    await harness.invoke('mock:response:create', {
      endpointId: ep.data.id,
      bodyType: 'sse',
      body: 'data: x',
      streamConfig: { intervalMs: 50 },
      order: 2,
    })
    const started = (await harness.invoke('mock:server:start', srv.data!.id)) as View
    expect(started.success).toBe(true)
    const def = fakeManager.start.mock.calls.at(-1)![0] as unknown as {
      endpoints: {
        responses: { bodyType: string; streamConfig: unknown; llmConfig: unknown }[]
      }[]
    }
    const base = { stopReason: 'stop', toolCalls: [], usage: 'auto' }
    expect(def.endpoints[0].responses.map((r) => [r.bodyType, r.llmConfig])).toEqual([
      ['llm', { ...base, provider: 'anthropic', chunking: 'word', chunkIntervalMs: 0 }],
      ['llm', { ...base, provider: 'openai', chunking: 'sentence', chunkIntervalMs: 30 }],
      ['sse', null],
    ])
    expect(def.endpoints[0].responses[0].streamConfig).toBeNull()
  })
})
