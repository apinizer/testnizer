/**
 * Issue #276 part 2 — a Postman v3 request imported as its own protocol must
 * OPEN in that protocol's editor with what the file held. DB rows alone do
 * not prove it: the editor reads `request_schema.metadata.<protocol>` through
 * `restoreProtocolFromMetadata`, and the GraphQL / gRPC / MCP / AI blocks are
 * built inline in `snapshotProtocol` (no shared writer).
 *
 * Each case writes the row with the REAL main-side writer (`insertNativeItem`,
 * a capturing fake db), opens it through the real `openEndpointTab`, checks
 * the store, and checks that Ctrl+S's `snapshotProtocol` gives the same block
 * back (the import writes exactly what the editor saves).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { insertNativeItem } from '../../src/main/import/postman/v3/native'
import { openEndpointTab } from '../../src/renderer/lib/open-endpoint-tab'
import { snapshotProtocol } from '../../src/renderer/lib/save-active-request'
import { useTabsStore } from '../../src/renderer/stores/tabs.store'
import { useRequestStore } from '../../src/renderer/stores/request.store'
import { useGraphQLStore } from '../../src/renderer/stores/graphql.store'
import { useGrpcStore } from '../../src/renderer/stores/grpc.store'
import { useWebSocketStore } from '../../src/renderer/stores/websocket.store'
import { useSocketIOStore } from '../../src/renderer/stores/socketio.store'
import { useMcpStore } from '../../src/renderer/stores/mcp.store'
import { resetAiKeySessionForTests, useAiChatStore } from '../../src/renderer/stores/ai-chat.store'
import { useWorkspaceStore } from '../../src/renderer/stores/workspace.store'

type Row = Record<string, unknown>
const endpoints = new Map<string, Row>()
const getKey = vi.fn(async () => ({
  success: true,
  data: { key: 'SAVED-REAL-KEY', encryptionAvailable: true },
}))

function installApi(): void {
  const ok = (data: unknown) => ({ success: true, data })
  ;(window as unknown as { api: unknown }).api = {
    endpoint: { get: vi.fn(async (id: string) => ok(endpoints.get(id) ?? null)), update: vi.fn() },
    savedRequest: { get: vi.fn(async () => ok(null)) },
    aiChat: { getKey, setKey: vi.fn(async () => ok({ persisted: true })) },
  }
}

/** Write one v3 request with the import writer; returns the row id. */
function importRow(kind: string, doc: Record<string, unknown>, name = 'Imported'): string {
  let captured: unknown[] = []
  const db = {
    prepare: () => ({
      run: (...args: unknown[]) => {
        captured = args
      },
    }),
  }
  const id = insertNativeItem({
    db: db as never,
    projectId: 'p',
    parentFolderId: null,
    name,
    description: null,
    native: { kind, doc: { $kind: kind, name, ...doc }, label: name },
    inheritedAuth: null,
    ancestorAuth: false,
    sortOrder: 0,
    now: 1,
    warnings: [],
  })
  const [, , , rowName, , protocol, method, path, , requestSchema] = captured
  endpoints.set(id, { id, name: rowName, protocol, method, path, request_schema: requestSchema })
  return id
}

function metaOf(id: string): Record<string, unknown> {
  return JSON.parse(String(endpoints.get(id)!.request_schema)).metadata
}

const noIds = (v: unknown): unknown =>
  JSON.parse(JSON.stringify(v), (k, val) => (k === 'id' ? undefined : val))

function activeTab() {
  const s = useTabsStore.getState()
  return s.tabs.find((t) => t.id === s.activeTabId)!
}

beforeEach(() => {
  endpoints.clear()
  getKey.mockClear()
  installApi()
  resetAiKeySessionForTests()
  useWorkspaceStore.setState({ refreshTree: vi.fn().mockResolvedValue(undefined) })
  useTabsStore.setState({ tabs: [], activeTabId: null })
  useRequestStore.setState({ _tabStates: new Map(), _currentTabId: null })
})

describe('issue #276 part 2 — imported v3 requests open in their editor', () => {
  it('GraphQL', async () => {
    const id = importRow('graphql-request', {
      url: 'https://g.example.test/graphql',
      query: '{ me { id } }',
      variables: '{"a":1}',
      headers: [{ key: 'X-A', value: '1' }],
    })
    await openEndpointTab(id)
    const s = useGraphQLStore.getState()
    expect(s.url).toBe('https://g.example.test/graphql')
    expect(s.query).toBe('{ me { id } }')
    expect(s.variables).toBe('{"a":1}')
    expect(s.headers.map((h) => [h.key, h.value])).toEqual([['X-A', '1']])
    expect(noIds(snapshotProtocol(activeTab()).protocolMeta)).toEqual(noIds(metaOf(id)))
  })

  it('gRPC', async () => {
    const id = importRow('grpc-request', {
      url: 'grpcs://grpc.example.test:443',
      methodPath: 'demo.Greeter/SayHello',
      message: { content: '{"name":"x"}' },
      metadata: [{ key: 'x-tenant', value: 'acme' }],
    })
    await openEndpointTab(id)
    const s = useGrpcStore.getState()
    expect(s.address).toBe('grpc.example.test:443')
    expect(s.useTls).toBe(true)
    expect(s.requestBody).toBe('{"name":"x"}')
    expect(s.metadata.map((m) => [m.key, m.value])).toEqual([['x-tenant', 'acme']])
    const snap = snapshotProtocol(activeTab()).protocolMeta.grpc as Record<string, unknown>
    const imported = metaOf(id).grpc as Record<string, unknown>
    // The service / method pick needs the loaded definition (not restored by design).
    for (const k of ['address', 'useTls', 'protoSource', 'protoUrl', 'requestBody', 'metadata'])
      expect(noIds(snap[k])).toEqual(noIds(imported[k]))
  })

  it('WebSocket', async () => {
    const id = importRow('websocket-request', {
      url: 'wss://ws.example.test/feed?room=a',
      queryParams: [{ key: 'room', value: 'a' }],
      headers: [{ key: 'X-C', value: '1' }],
      settings: { handshakeTimeout: 4000, retryCount: 1, maxPayload: 3145728 },
      messages: [{ name: 'hi', content: '{"t":1}', contentType: 'json' }],
    })
    await openEndpointTab(id)
    const s = useWebSocketStore.getState()
    expect(s.url).toBe('wss://ws.example.test/feed?room=a')
    expect(s.params.map((p) => [p.key, p.value])).toEqual([['room', 'a']])
    expect(s.settings).toMatchObject({ handshakeTimeout: 4000, retryCount: 1, maxPayload: 3 })
    expect(s.savedMessages.map((m) => [m.name, m.contentType])).toEqual([['hi', 'json']])
    expect(noIds(snapshotProtocol(activeTab()).protocolMeta)).toEqual(noIds(metaOf(id)))
  })

  it('Socket.IO', async () => {
    const id = importRow('socket.io-request', {
      url: 'https://io.example.test/chat',
      events: [
        { name: 'news', subscribeOnConnect: true },
        { name: 'quiet', subscribeOnConnect: false },
      ],
      settings: { version: '4', path: '/rt' },
      messages: [
        {
          name: 'm',
          eventName: 'news',
          acknowledgement: true,
          args: [{ content: '1', contentType: 'json' }],
        },
      ],
    })
    await openEndpointTab(id)
    const s = useSocketIOStore.getState()
    expect(s.url).toBe('https://io.example.test')
    expect(s.namespace).toBe('/chat')
    expect(s.listenAll).toBe(false)
    expect(s.listeners.map((l) => [l.name, l.listen])).toEqual([
      ['news', true],
      ['quiet', false],
    ])
    expect(s.settings.path).toBe('/rt')
    expect(s.savedMessages[0]).toMatchObject({ eventName: 'news', acknowledgement: true })
    expect(noIds(snapshotProtocol(activeTab()).protocolMeta)).toEqual(noIds(metaOf(id)))
  })

  it('MCP', async () => {
    const id = importRow('mcp-request', {
      transport: 'sse',
      url: 'https://mcp.example.test/mcp',
      headers: [{ key: 'X-M', value: '1' }],
      auth: { type: 'bearer', credentials: [{ key: 'token', value: '{{t}}' }] },
      message:
        '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"echo","arguments":{"n":{{n}}}}}',
      settings: { version: 'legacy' },
    })
    await openEndpointTab(id)
    const s = useMcpStore.getState()
    expect(s.transport).toBe('http')
    expect(s.url).toBe('https://mcp.example.test/mcp')
    expect(s.auth).toEqual({ type: 'bearer', bearer: { token: '{{t}}' } })
    expect(s.protocol).toBe('legacy')
    const snap = snapshotProtocol(activeTab()).protocolMeta.mcp as Record<string, unknown>
    const imported = metaOf(id).mcp as Record<string, unknown>
    for (const k of ['transport', 'url', 'customHeaders', 'envVars', 'auth', 'protocol'])
      expect(noIds(snap[k])).toEqual(noIds(imported[k]))
    expect(snap.call).toMatchObject(imported.call as Record<string, unknown>)
  })

  it('AI Chat — the saved provider key is never loaded into an imported request', async () => {
    const id = importRow('llm-request', {
      url: 'https://evil.example.test/v1/chat/completions',
      config: { provider: 'openai', model: 'gpt-4o' },
      systemPrompts: [{ value: 'Be brief', active: true, contentType: 'text' }],
      settings: { temperature: 0.5 },
    })
    await openEndpointTab(id)
    const s = useAiChatStore.getState()
    expect(s.provider).toBe('openai')
    expect(s.customUrl).toBe('https://evil.example.test/v1/chat/completions')
    expect(s.systemPrompt).toBe('Be brief')
    expect(s.temperature).toBe(0.5)
    expect(s.savedKeyDisabled).toBe(true)
    // Whatever the fresh tab looked up before the restore, the saved key never
    // lands on the imported request (it would go to the file's URL).
    await new Promise((r) => setTimeout(r, 30))
    expect(useAiChatStore.getState().apiKey).toBe('')
    expect(useAiChatStore.getState().savedKeyDisabled).toBe(true)
    const snap = snapshotProtocol(activeTab()).protocolMeta.ai as Record<string, unknown>
    expect(snap).toMatchObject({ provider: 'openai', model: 'gpt-4o', savedKeyDisabled: true })
  })
})
