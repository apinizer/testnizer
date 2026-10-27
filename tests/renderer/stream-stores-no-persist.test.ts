/**
 * Received payloads never reach localStorage (canary scan, release 1.6.0).
 *
 * Every connection store keeps a per-tab snapshot in localStorage
 * (`attachTabbedPersist`). Before this fix the snapshot carried what the
 * SERVER sent — SSE `events` (a mock echoed `Bearer <secret>` and secret env
 * values into them), WebSocket `messages`, Socket.IO `events`, GraphQL
 * `response` + `subscriptionEvents`, gRPC `response` + `streamEvents` — and
 * the error text derived from them. Server output is like a response body:
 * it stays in memory for the session (a tab switch keeps it) and is never
 * written to disk.
 *
 * Per store this pins:
 *   1. after a payload with a canary arrives, the stored snapshot has no
 *      canary — for the active tab AND for a cached (background) tab;
 *   2. the in-memory state still holds the payload (counter-assertion);
 *   3. user-authored config (URL, headers, composer drafts) is still stored
 *      and restores after a reload;
 *   4. a snapshot an older build already wrote is scrubbed on load — the
 *      leaked payload is neither shown nor left on disk.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const CANARY = 'CANARY-RECEIVED-7f3a'
const CONFIG_URL = 'https://config.example.test/stream'

function raw(key: string): string {
  return window.localStorage.getItem(key) ?? ''
}

beforeEach(() => {
  window.localStorage.clear()
  vi.resetModules()
})

// ─── SSE ────────────────────────────────────────────────────────────────

describe('SSE store', () => {
  const KEY = 'testnizer-sse'
  const event = { id: '1', type: 'message', data: `{"auth":"Bearer ${CANARY}"}`, timestamp: 1 }

  it('keeps received events and the error text out of localStorage, in memory', async () => {
    const { useSseStore } = await import('../../src/renderer/stores/sse.store')
    const cached = {
      ...useSseStore.getState(),
      url: 'https://cached.example.test/sse',
      events: [event],
      errorMessage: CANARY,
    }
    useSseStore.setState({
      _currentTabId: 'tab-1',
      _tabStates: new Map([['tab-2', cached]]),
      url: CONFIG_URL,
      customHeaders: [{ id: 'h', key: 'X-Trace', value: '{{trace}}', enabled: true }],
      events: [event],
      errorMessage: `SSE error ${CANARY}`,
      connectionState: 'connected',
      connectionId: 'conn-1',
    })

    const stored = raw(KEY)
    expect(stored).not.toContain(CANARY)
    expect(stored).toContain(CONFIG_URL)
    expect(stored).toContain('https://cached.example.test/sse')
    expect(stored).toContain('{{trace}}')
    // Session memory is untouched.
    expect(useSseStore.getState().events).toHaveLength(1)
    expect(useSseStore.getState()._tabStates.get('tab-2')?.events).toHaveLength(1)
  })

  it('scrubs a snapshot an older build left on disk and still restores the config', async () => {
    window.localStorage.setItem(
      KEY,
      JSON.stringify({
        current: { url: CONFIG_URL, events: [event], errorMessage: CANARY },
        _currentTabId: 'tab-1',
        _tabStates: [['tab-2', { url: 'https://cached.example.test/sse', events: [event] }]],
      }),
    )
    const { useSseStore } = await import('../../src/renderer/stores/sse.store')
    const s = useSseStore.getState()
    expect(s.url).toBe(CONFIG_URL)
    expect(s.events).toEqual([])
    expect(s.errorMessage).toBeNull()
    expect(s.connectionState).toBe('disconnected')
    expect(s._tabStates.get('tab-2')?.url).toBe('https://cached.example.test/sse')
    expect(s._tabStates.get('tab-2')?.events).toEqual([])
    expect(raw(KEY)).not.toContain(CANARY)
    expect(raw(KEY)).toContain(CONFIG_URL)
  })
})

// ─── WebSocket ─────────────────────────────────────────────────────────

describe('WebSocket store', () => {
  const KEY = 'testnizer-websocket'
  const received = {
    id: 'm1',
    direction: 'received' as const,
    content: `{"token":"${CANARY}"}`,
    contentType: 'json' as const,
    timestamp: 1,
  }

  it('keeps the message timeline out of localStorage; the composer draft stays', async () => {
    const { useWebSocketStore } = await import('../../src/renderer/stores/websocket.store')
    useWebSocketStore.setState({
      _currentTabId: 'tab-1',
      _tabStates: new Map([['tab-2', { ...useWebSocketStore.getState(), messages: [received] }]]),
      url: 'wss://config.example.test/ws',
      composerContent: '{"hello":"{{name}}"}',
      messages: [received],
      errorMessage: `closed: ${CANARY}`,
    })
    const stored = raw(KEY)
    expect(stored).not.toContain(CANARY)
    expect(stored).toContain('wss://config.example.test/ws')
    expect(stored).toContain('{{name}}')
    expect(useWebSocketStore.getState().messages).toHaveLength(1)
  })

  it('scrubs an old snapshot on load', async () => {
    window.localStorage.setItem(
      KEY,
      JSON.stringify({
        current: { url: 'wss://config.example.test/ws', messages: [received] },
        _currentTabId: 'tab-1',
        _tabStates: [],
      }),
    )
    const { useWebSocketStore } = await import('../../src/renderer/stores/websocket.store')
    expect(useWebSocketStore.getState().url).toBe('wss://config.example.test/ws')
    expect(useWebSocketStore.getState().messages).toEqual([])
    expect(raw(KEY)).not.toContain(CANARY)
  })
})

// ─── Socket.IO ─────────────────────────────────────────────────────────

describe('Socket.IO store', () => {
  const KEY = 'testnizer-socketio'
  const received = { direction: 'in' as const, event: 'msg', data: { t: CANARY }, timestamp: 1 }

  it('keeps received events out of localStorage; namespace / emit draft stay', async () => {
    const { useSocketIOStore } = await import('../../src/renderer/stores/socketio.store')
    useSocketIOStore.setState({
      _currentTabId: 'tab-1',
      _tabStates: new Map([['tab-2', { ...useSocketIOStore.getState(), events: [received] }]]),
      url: 'http://config.example.test',
      namespace: '/chat',
      emitArgs: [{ id: 'a1', content: '{"draft":true}', contentType: 'json' }],
      events: [received],
      errorMessage: CANARY,
    })
    const stored = raw(KEY)
    expect(stored).not.toContain(CANARY)
    expect(stored).toContain('/chat')
    expect(stored).toContain('{\\"draft\\":true}')
    expect(useSocketIOStore.getState().events).toHaveLength(1)
  })

  it('scrubs an old snapshot on load', async () => {
    window.localStorage.setItem(
      KEY,
      JSON.stringify({
        current: { url: 'http://config.example.test', events: [received] },
        _currentTabId: 'tab-1',
        _tabStates: [],
      }),
    )
    const { useSocketIOStore } = await import('../../src/renderer/stores/socketio.store')
    expect(useSocketIOStore.getState().url).toBe('http://config.example.test')
    expect(useSocketIOStore.getState().events).toEqual([])
    expect(raw(KEY)).not.toContain(CANARY)
  })

  it('a pre-#283 snapshot (subscriptions / emitPayload) keeps showing every event', async () => {
    const old = {
      url: 'http://old.example.test',
      subscriptions: ['chat'],
      newSubscription: '',
      emitEvent: 'go',
      emitPayload: '{"a":1}',
    }
    window.localStorage.setItem(
      KEY,
      JSON.stringify({ current: old, _currentTabId: 'tab-1', _tabStates: [['tab-2', old]] }),
    )
    const { useSocketIOStore } = await import('../../src/renderer/stores/socketio.store')
    const st = useSocketIOStore.getState()
    expect(st.listenAll).toBe(true)
    expect(st.listeners.map((l) => l.name)).toEqual(['chat'])
    expect(st.emitArgs.map((a) => [a.content, a.contentType])).toEqual([['{"a":1}', 'json']])
    expect(st._tabStates.get('tab-2')?.listenAll).toBe(true)
    expect(raw(KEY)).not.toContain('subscriptions')
  })
})

// ─── GraphQL ───────────────────────────────────────────────────────────

describe('GraphQL store', () => {
  const KEY = 'testnizer-graphql'
  const response = {
    requestId: 'r1',
    protocol: 'graphql' as const,
    status: 200,
    body: `{"data":{"token":"${CANARY}"}}`,
    timing: { total: 1 },
  }

  it('keeps the response body and subscription events out of localStorage', async () => {
    const { useGraphQLStore } = await import('../../src/renderer/stores/graphql.store')
    useGraphQLStore.setState({
      _currentTabId: 'tab-1',
      _tabStates: new Map(),
      url: 'https://config.example.test/graphql',
      query: '{ me { id } }',
      response: response as never,
      subscriptionEvents: [{ id: 'e1', data: CANARY, timestamp: 1 }],
    })
    const stored = raw(KEY)
    expect(stored).not.toContain(CANARY)
    expect(stored).toContain('https://config.example.test/graphql')
    expect(stored).toContain('{ me { id } }')
    expect(useGraphQLStore.getState().response?.body).toContain(CANARY)
  })

  it('scrubs an old snapshot on load and restores url / query', async () => {
    window.localStorage.setItem(
      KEY,
      JSON.stringify({
        current: {
          url: 'https://config.example.test/graphql',
          query: '{ me { id } }',
          response,
          subscriptionEvents: [{ id: 'e1', data: CANARY, timestamp: 1 }],
        },
        _currentTabId: 'tab-1',
        _tabStates: [['tab-2', { url: 'https://cached.example.test/gql', response }]],
      }),
    )
    const { useGraphQLStore } = await import('../../src/renderer/stores/graphql.store')
    const s = useGraphQLStore.getState()
    expect(s.url).toBe('https://config.example.test/graphql')
    expect(s.query).toBe('{ me { id } }')
    expect(s.response).toBeNull()
    expect(s.subscriptionEvents).toEqual([])
    expect(s._tabStates.get('tab-2')?.url).toBe('https://cached.example.test/gql')
    expect(s._tabStates.get('tab-2')?.response).toBeNull()
    expect(raw(KEY)).not.toContain(CANARY)
  })
})

// ─── gRPC ──────────────────────────────────────────────────────────────

describe('gRPC store', () => {
  const KEY = 'testnizer-grpc'

  it('keeps the response and stream events out of localStorage; request body stays', async () => {
    const { useGrpcStore } = await import('../../src/renderer/stores/grpc.store')
    useGrpcStore.setState({
      _currentTabId: 'tab-1',
      _tabStates: new Map(),
      address: 'config.example.test:50051',
      requestBody: '{"name":"{{who}}"}',
      response: {
        requestId: 'r1',
        protocol: 'grpc',
        body: `{"token":"${CANARY}"}`,
        timing: { total: 1 },
      } as never,
      streamEvents: [{ id: 's1', data: CANARY, timestamp: 1, index: 0 }],
      errorMessage: CANARY,
    })
    const stored = raw(KEY)
    expect(stored).not.toContain(CANARY)
    expect(stored).toContain('config.example.test:50051')
    expect(stored).toContain('{{who}}')
    expect(useGrpcStore.getState().streamEvents).toHaveLength(1)
  })

  it('scrubs an old snapshot on load and restores address / request body', async () => {
    window.localStorage.setItem(
      KEY,
      JSON.stringify({
        current: {
          address: 'config.example.test:50051',
          requestBody: '{"name":"{{who}}"}',
          response: { requestId: 'r1', protocol: 'grpc', body: CANARY, timing: { total: 1 } },
          streamEvents: [{ id: 's1', data: CANARY, timestamp: 1, index: 0 }],
          errorMessage: CANARY,
        },
        _currentTabId: 'tab-1',
        _tabStates: [],
      }),
    )
    const { useGrpcStore } = await import('../../src/renderer/stores/grpc.store')
    const s = useGrpcStore.getState()
    expect(s.address).toBe('config.example.test:50051')
    expect(s.requestBody).toBe('{"name":"{{who}}"}')
    expect(s.response).toBeNull()
    expect(s.streamEvents).toEqual([])
    expect(s.errorMessage).toBeNull()
    expect(raw(KEY)).not.toContain(CANARY)
  })
})

// ─── MCP (already compliant — pinned) ──────────────────────────────────

describe('MCP store', () => {
  const KEY = 'testnizer-mcp'

  it('keeps results, frames and notifications out of localStorage', async () => {
    const { useMcpStore } = await import('../../src/renderer/stores/mcp.store')
    useMcpStore.setState({
      _currentTabId: 'tab-1',
      _tabStates: new Map(),
      url: 'https://config.example.test/mcp',
      toolArgs: '{"q":"{{query}}"}',
      result: { content: [{ type: 'text', text: CANARY }] },
      resultError: CANARY,
      frames: [{ id: 'f1', direction: 'in', timestamp: 1, raw: CANARY } as never],
      notifications: [{ id: 'n1', method: 'x', params: { t: CANARY }, timestamp: 1 } as never],
      instructions: CANARY,
    })
    const stored = raw(KEY)
    expect(stored).not.toContain(CANARY)
    expect(stored).toContain('https://config.example.test/mcp')
    expect(stored).toContain('{{query}}')
  })
})

// ─── MQTT (issue #284) ─────────────────────────────────────────────────

describe('MQTT store', () => {
  const KEY = 'testnizer-mqtt'

  it('keeps the message log and errors out of localStorage; the request stays', async () => {
    const { useMqttStore } = await import('../../src/renderer/stores/mqtt.store')
    const row = {
      id: 'r1',
      direction: 'received' as const,
      topic: 't',
      content: `{"token":"${CANARY}"}`,
      contentType: 'json' as const,
      timestamp: 1,
    }
    useMqttStore.setState({
      _currentTabId: 'tab-1',
      _tabStates: new Map([['tab-2', { ...useMqttStore.getState(), log: [row] }]]),
      url: 'mqtt://config.example.test',
      log: [row],
      errorMessage: CANARY,
    })
    const stored = raw(KEY)
    expect(stored).not.toContain(CANARY)
    expect(stored).toContain('mqtt://config.example.test')
    expect(useMqttStore.getState().log).toHaveLength(1)
  })
})
