/**
 * Tester finding 13 (critical): a WebSocket tab took another tab's messages.
 *
 * Steps: tab A connects, A's server goes away (A: Disconnected 1005), tab B
 * connects to another server and exchanges a message, back to A: B's rows were
 * in A's log. The listener read its expected id from A's slice and let every
 * event through while that id was empty — empty after the `close` (which also
 * never removed the listener) and while A's connect was still in flight.
 *
 * The same filter sat in SSE (connecting window) and gRPC streaming (`end` /
 * `error` cleared the stream id and kept the listener). The fix pins each
 * listener to the id its connect / start answered (`lib/pinned-events.ts`).
 * Socket.IO, MQTT, GraphQL and MCP already pinned (see the report).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useWebSocketStore } from '../../src/renderer/stores/websocket.store'
import { useSseStore } from '../../src/renderer/stores/sse.store'
import { useGrpcStore } from '../../src/renderer/stores/grpc.store'
import { useEnvironmentStore } from '../../src/renderer/stores/environment.store'
import { useTabsStore } from '../../src/renderer/stores/tabs.store'
import { pinnedEvents } from '../../src/renderer/lib/pinned-events'

type Evt = Record<string, unknown>

interface Held<T> {
  promise: Promise<T>
  resolve: (v: T) => void
}
function held<T>(): Held<T> {
  let resolve!: (v: T) => void
  const promise = new Promise<T>((r) => (resolve = r))
  return { promise, resolve }
}

/** One broadcast channel, like `ipcRenderer.on('ws:event')`: every tab hears every event. */
function channel(): {
  listeners: Array<(e: Evt) => void>
  on: (cb: (e: Evt) => void) => () => void
  emit: (e: Evt) => void
} {
  const ch = {
    listeners: [] as Array<(e: Evt) => void>,
    on: (cb: (e: Evt) => void) => {
      ch.listeners.push(cb)
      return () => {
        ch.listeners = ch.listeners.filter((l) => l !== cb)
      }
    },
    emit: (e: Evt) => {
      for (const l of [...ch.listeners]) l({ timestamp: Date.now(), ...e })
    },
  }
  return ch
}

const flush = async (): Promise<void> => {
  for (let i = 0; i < 10; i++) await Promise.resolve()
}

beforeEach(() => {
  useEnvironmentStore.setState({ getActiveVariables: () => ({}) })
  useTabsStore.setState({ tabs: [], activeTabId: null })
})

afterEach(() => {
  delete (window as unknown as { api?: unknown }).api
})

// ─── WebSocket ──────────────────────────────────────────────────────────────

describe('WebSocket: a closed tab keeps only its own rows', () => {
  let ch: ReturnType<typeof channel>
  let replies: Array<Held<unknown>>
  const connect = vi.fn()

  beforeEach(() => {
    ch = channel()
    replies = []
    connect.mockReset()
    connect.mockImplementation(() => {
      const r = held<unknown>()
      replies.push(r)
      return r.promise
    })
    ;(window as unknown as { api: unknown }).api = {
      ws: {
        connect,
        send: vi.fn(async () => ({ success: true, data: true })),
        disconnect: vi.fn(async () => ({ success: true })),
        cancelConnect: vi.fn(async () => ({ success: true })),
        onEvent: ch.on,
      },
    }
    useWebSocketStore.setState({ _tabStates: new Map(), _currentTabId: null })
  })

  const ws = () => useWebSocketStore.getState()

  /** Connect the tab on screen; main fires `open` before the connect reply, as the engine does. */
  async function connectAs(tab: string, id: string): Promise<void> {
    ws().switchToTab(tab)
    ws().setUrl(`ws://127.0.0.1/${tab}`)
    const done = ws().connect()
    await vi.waitFor(() => expect(replies.length).toBe(connect.mock.calls.length))
    await flush()
    ch.emit({ connectionId: id, type: 'open' })
    replies[replies.length - 1].resolve({ success: true, data: { connectionId: id } })
    await done
    expect(ws().connectionState).toBe('connected')
  }

  it('the reported sequence: A closed by its server, B talks, A shows only its own rows', async () => {
    await connectAs('A', 'wA')
    ch.emit({ connectionId: 'wA', type: 'close', code: 1005 })
    expect(ws().connectionState).toBe('disconnected')

    await connectAs('B', 'wB')
    ch.emit({ connectionId: 'wB', type: 'message', data: 'from B' })
    ch.emit({ connectionId: 'wB', type: 'close', code: 1000 })

    ws().switchToTab('A')
    expect(ws().messages.map((m) => m.event ?? m.content)).toEqual(['connected', 'disconnected'])
    expect(ws().connectionState).toBe('disconnected')
    expect(ws().connectionId).toBeNull()

    ws().switchToTab('B')
    expect(ws().messages.map((m) => m.event ?? m.content)).toEqual([
      'connected',
      'from B',
      'disconnected',
    ])
    // Each close removed its listener: nothing is still subscribed.
    expect(ch.listeners).toHaveLength(0)
  })

  it("A's connect still in flight: B's traffic never lands in A", async () => {
    await connectAs('B', 'wB')
    ws().switchToTab('A')
    ws().setUrl('ws://127.0.0.1/slow')
    const done = ws().connect()
    await vi.waitFor(() => expect(replies.length).toBe(2))
    ch.emit({ connectionId: 'wB', type: 'message', data: 'from B' })
    ch.emit({ connectionId: 'wB', type: 'close', code: 1000 })
    expect(ws().messages).toEqual([])
    expect(ws().connectionState).toBe('connecting')

    ch.emit({ connectionId: 'wA', type: 'open' })
    replies[1].resolve({ success: true, data: { connectionId: 'wA' } })
    await done
    expect(ws().messages.map((m) => m.event ?? m.content)).toEqual(['connected'])
    expect(ws().connectionState).toBe('connected')
  })

  it('an event without a connection id is never accepted', async () => {
    await connectAs('A', 'wA')
    ch.emit({ type: 'message', data: 'stray' })
    ch.emit({ connectionId: null, type: 'close', code: 1006 })
    expect(ws().messages.map((m) => m.event ?? m.content)).toEqual(['connected'])
    expect(ws().connectionState).toBe('connected')
  })

  it('auto reconnect keeps the same id: reconnecting / reconnected rows still land', async () => {
    await connectAs('A', 'wA')
    ch.emit({ connectionId: 'wA', type: 'reconnecting', attempt: 1, code: 1006 })
    ch.emit({ connectionId: 'wA', type: 'open', reconnected: true })
    ch.emit({ connectionId: 'wA', type: 'message', data: 'after reconnect' })
    expect(ws().messages.map((m) => m.event ?? m.content)).toEqual([
      'connected',
      'reconnecting',
      'reconnected',
      'after reconnect',
    ])
    expect(ch.listeners).toHaveLength(1)
  })

  it('a failed handshake shows its error row and leaves no listener behind', async () => {
    ws().switchToTab('A')
    ws().setUrl('ws://127.0.0.1/down')
    const done = ws().connect()
    await vi.waitFor(() => expect(replies.length).toBe(1))
    ch.emit({ connectionId: 'wA', type: 'error', data: 'connect ECONNREFUSED 127.0.0.1:80' })
    replies[0].resolve({ success: false, error: 'connect ECONNREFUSED 127.0.0.1:80' })
    await done
    expect(ws().connectionState).toBe('error')
    expect(ws().messages.map((m) => m.event)).toEqual(['error'])
    expect(ch.listeners).toHaveLength(0)
  })
})

// ─── SSE ────────────────────────────────────────────────────────────────────

describe('SSE: the connecting window takes no other connection', () => {
  let ch: ReturnType<typeof channel>
  let replies: Array<Held<unknown>>

  beforeEach(() => {
    ch = channel()
    replies = []
    ;(window as unknown as { api: unknown }).api = {
      sse: {
        onEvent: ch.on,
        connect: () => {
          const r = held<unknown>()
          replies.push(r)
          return r.promise
        },
        cancelConnect: async () => ({ success: true, data: { canceled: false } }),
        disconnect: async () => ({ success: true, data: true }),
      },
    }
    useSseStore.setState({
      _tabStates: new Map(),
      _currentTabId: null,
      connectionId: null,
      connectionState: 'disconnected',
      errorMessage: null,
      events: [],
      _unsubscribe: undefined,
      _pendingConnectId: undefined,
      reconnecting: false,
    })
  })

  const sse = () => useSseStore.getState()

  it("B's events while A is still connecting never land in A", async () => {
    sse().switchToTab('A')
    sse().setUrl('http://127.0.0.1/slow')
    const done = sse().connect()
    await vi.waitFor(() => expect(replies.length).toBe(1))
    ch.emit({ connectionId: 'sB', type: 'event', data: 'from B', eventType: 'message' })
    ch.emit({ connectionId: 'sB', type: 'error', closed: 'ended' })
    expect(sse().events).toEqual([])
    expect(sse().connectionState).toBe('connecting')

    ch.emit({ connectionId: 'sA', type: 'open' })
    ch.emit({ connectionId: 'sA', type: 'event', data: 'from A', eventType: 'message' })
    replies[0].resolve({ success: true, data: { connectionId: 'sA' } })
    await done
    expect(sse().connectionState).toBe('connected')
    expect(sse().events.map((e) => e.data)).toEqual(['from A'])

    ch.emit({ connectionId: 'sB', type: 'event', data: 'later B', eventType: 'message' })
    ch.emit({ type: 'event', data: 'no id', eventType: 'message' })
    expect(sse().events.map((e) => e.data)).toEqual(['from A'])
  })
})

// ─── gRPC streaming ─────────────────────────────────────────────────────────

describe('gRPC: an ended stream keeps no listener', () => {
  let ch: ReturnType<typeof channel>
  let ids: string[]

  beforeEach(() => {
    ch = channel()
    ids = []
    ;(window as unknown as { api: unknown }).api = {
      grpc: {
        onStreamEvent: ch.on,
        serverStream: async () => {
          const id = `g${ids.length + 1}`
          ids.push(id)
          return { success: true, data: { streamId: id } }
        },
        cancelStream: async () => ({ success: true }),
      },
    }
    useGrpcStore.setState({ _tabStates: new Map(), _currentTabId: null })
  })

  const grpc = () => useGrpcStore.getState()

  async function startStream(tab: string): Promise<string> {
    grpc().switchToTab(tab)
    useGrpcStore.setState({
      address: 'a.example:1',
      services: [
        {
          name: 'a.Greeter',
          methods: [
            { name: 'Watch', type: 'server_streaming', requestType: 'Q', responseType: 'R' },
          ],
        },
      ],
      selectedService: 'a.Greeter',
      selectedMethod: 'Watch',
    })
    await grpc().execute()
    return ids[ids.length - 1]
  }

  it('A ended, B streams, A keeps only its own messages and state', async () => {
    const a = await startStream('A')
    ch.emit({ streamId: a, type: 'data', data: '{"from":"A"}' })
    ch.emit({ streamId: a, type: 'end' })
    expect(grpc().isStreaming).toBe(false)

    const b = await startStream('B')
    ch.emit({ streamId: b, type: 'data', data: '{"from":"B"}' })

    grpc().switchToTab('A')
    expect(grpc().streamEvents.map((e) => e.data)).toEqual(['{"from":"A"}'])
    expect(grpc().isStreaming).toBe(false)

    grpc().switchToTab('B')
    expect(grpc().streamEvents.map((e) => e.data)).toEqual(['{"from":"B"}'])
    expect(grpc().isStreaming).toBe(true)
    // A's `end` removed its listener: only B's stream is subscribed.
    expect(ch.listeners).toHaveLength(1)
  })

  it('a stream error also removes the listener; events without a stream id are ignored', async () => {
    const a = await startStream('A')
    ch.emit({ type: 'data', data: '{"stray":1}' })
    ch.emit({ streamId: a, type: 'error', error: 'UNAVAILABLE' })
    expect(grpc().errorMessage).toBe('UNAVAILABLE')
    expect(grpc().streamEvents).toEqual([])
    expect(ch.listeners).toHaveLength(0)
  })

  it('grpc-js order on a failed status (`error`, then `end`): the error text stays', async () => {
    const a = await startStream('A')
    ch.emit({ streamId: a, type: 'data', data: '{"n":1}' })
    ch.emit({ streamId: a, type: 'error', error: 'DEADLINE_EXCEEDED' })
    ch.emit({ streamId: a, type: 'end' })
    expect(grpc().errorMessage).toBe('DEADLINE_EXCEEDED')
    expect(grpc().isStreaming).toBe(false)
    expect(grpc().activeStreamId).toBeNull()
    expect(grpc().streamEvents.map((e) => e.data)).toEqual(['{"n":1}'])
  })

  it('a start that fails in main (error event, then the stream id) settles the tab', async () => {
    ;(
      window.api as unknown as { grpc: { serverStream: () => Promise<unknown> } }
    ).grpc.serverStream = async () => {
      ch.emit({ streamId: 'g-bad', type: 'error', error: 'Service not found: a.Greeter' })
      return { success: true, data: { streamId: 'g-bad' } }
    }
    await startStream('A')
    expect(grpc().errorMessage).toBe('Service not found: a.Greeter')
    expect(grpc().isStreaming).toBe(false)
    expect(ch.listeners).toHaveLength(0)
  })
})

// ─── The helper ─────────────────────────────────────────────────────────────

describe('pinnedEvents', () => {
  it('holds events until pinned, then delivers only its own id, in order', () => {
    const got: string[] = []
    const p = pinnedEvents<{ id?: string; v: string }>(
      (e) => e.id,
      (e) => got.push(e.v),
    )
    p.receive({ id: 'x', v: 'x1' })
    p.receive({ id: 'a', v: 'a1' })
    p.receive({ v: 'none' })
    p.receive({ id: 'a', v: 'a2' })
    expect(got).toEqual([])
    p.pin('a')
    expect(got).toEqual(['a1', 'a2'])
    p.receive({ id: 'x', v: 'x2' })
    p.receive({ id: 'a', v: 'a3' })
    p.drop()
    p.receive({ id: 'a', v: 'a4' })
    expect(got).toEqual(['a1', 'a2', 'a3'])
  })

  it('a held terminal event that drops the listener stops the drain', () => {
    const got: string[] = []
    const p = pinnedEvents<{ id: string; v: string }>(
      (e) => e.id,
      (e) => {
        got.push(e.v)
        if (e.v === 'close') p.drop()
      },
    )
    p.receive({ id: 'a', v: 'open' })
    p.receive({ id: 'a', v: 'close' })
    p.receive({ id: 'a', v: 'after' })
    p.pin('a')
    expect(got).toEqual(['open', 'close'])
  })
})
