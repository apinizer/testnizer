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

// ─── Held events before the connect reply (review P2) ───────────────────────
//
// The first cut trimmed the held queue at 1000 events of ANY kind and ANY id:
// `open(A)` followed by 1000 messages lost the `open` (the tab stayed on
// Connecting while it showed messages), and another connection's traffic could
// push A's own events out. Control events are never dropped, the cap counts
// one connection's data events only, and a drop is reported, never silent.

describe('pinnedEvents: the held queue', () => {
  type E = { id?: string; kind: 'open' | 'data' | 'close'; v: string }
  const isControl = (e: E): boolean => e.kind !== 'data'

  it('never drops a control event; drops the oldest data past the cap and reports it in place', () => {
    const got: string[] = []
    const p = pinnedEvents<E>(
      (e) => e.id,
      (e) => got.push(e.v),
      { isControl, limit: 3, onDropped: (n) => got.push(`dropped:${n}`) },
    )
    p.receive({ id: 'a', kind: 'open', v: 'open' })
    for (let i = 1; i <= 5; i++) p.receive({ id: 'a', kind: 'data', v: `d${i}` })
    p.receive({ id: 'a', kind: 'close', v: 'close' })
    p.pin('a')
    expect(got).toEqual(['open', 'dropped:2', 'd3', 'd4', 'd5', 'close'])
  })

  it("another connection's flood never pushes this connection's events out", () => {
    const got: string[] = []
    const dropped: number[] = []
    const p = pinnedEvents<E>(
      (e) => e.id,
      (e) => got.push(e.v),
      { isControl, limit: 3, onDropped: (n) => dropped.push(n) },
    )
    p.receive({ id: 'a', kind: 'open', v: 'open' })
    for (let i = 0; i < 50; i++) p.receive({ id: 'x', kind: 'data', v: `x${i}` })
    p.receive({ id: 'a', kind: 'data', v: 'a1' })
    p.pin('a')
    expect(got).toEqual(['open', 'a1'])
    expect(dropped).toEqual([])
  })
})

describe('stores: a flood before the connect reply', () => {
  const FLOOD = 1001

  it('WebSocket: open + 1001 messages → connected, 1000 kept, one "dropped" row', async () => {
    const ch = channel()
    let reply!: Held<unknown>
    ;(window as unknown as { api: unknown }).api = {
      ws: {
        connect: () => {
          reply = held<unknown>()
          return reply.promise
        },
        disconnect: vi.fn(async () => ({ success: true })),
        cancelConnect: vi.fn(async () => ({ success: true })),
        onEvent: ch.on,
      },
    }
    useWebSocketStore.setState({ _tabStates: new Map(), _currentTabId: null })
    const ws = () => useWebSocketStore.getState()
    ws().switchToTab('A')
    ws().setUrl('ws://127.0.0.1/flood')
    const done = ws().connect()
    await vi.waitFor(() => expect(reply).toBeDefined())
    ch.emit({ connectionId: 'wA', type: 'open' })
    for (let i = 0; i < 1500; i++) ch.emit({ connectionId: 'wX', type: 'message', data: `x${i}` })
    for (let i = 0; i < FLOOD; i++) ch.emit({ connectionId: 'wA', type: 'message', data: `m${i}` })
    reply.resolve({ success: true, data: { connectionId: 'wA' } })
    await done

    expect(ws().connectionState).toBe('connected')
    const rows = ws().messages
    expect(rows[0].event).toBe('connected')
    expect(rows[1].event).toBe('dropped')
    expect(rows[1].content).toContain('1')
    const received = rows.filter((m) => m.direction === 'received')
    expect(received).toHaveLength(1000)
    expect(received[0].content).toBe('m1')
    expect(received.some((m) => m.content.startsWith('x'))).toBe(false)
  })

  it('SSE: open + 1001 events → connected, 1000 kept, the drop counted on the tab', async () => {
    const ch = channel()
    let reply!: Held<unknown>
    ;(window as unknown as { api: unknown }).api = {
      sse: {
        onEvent: ch.on,
        connect: () => {
          reply = held<unknown>()
          return reply.promise
        },
        cancelConnect: async () => ({ success: true, data: { canceled: false } }),
        disconnect: async () => ({ success: true, data: true }),
      },
    }
    useSseStore.setState({ _tabStates: new Map(), _currentTabId: null })
    const sse = () => useSseStore.getState()
    sse().switchToTab('A')
    sse().setUrl('http://127.0.0.1/flood')
    const done = sse().connect()
    await vi.waitFor(() => expect(reply).toBeDefined())
    ch.emit({ connectionId: 'sA', type: 'open' })
    for (let i = 0; i < FLOOD; i++) {
      ch.emit({ connectionId: 'sA', type: 'event', data: `e${i}`, eventType: 'message' })
    }
    reply.resolve({ success: true, data: { connectionId: 'sA' } })
    await done

    expect(sse().connectionState).toBe('connected')
    expect(sse().events).toHaveLength(1000)
    expect(sse().droppedEarly).toBe(1)
  })

  it('gRPC bidi: an error main sends before the stream id settles the tab', async () => {
    const ch = channel()
    ;(window as unknown as { api: unknown }).api = {
      grpc: {
        onStreamEvent: ch.on,
        bidiStream: async () => {
          ch.emit({ streamId: 'g-bidi', type: 'error', error: 'Method not found: Chat' })
          return { success: true, data: { streamId: 'g-bidi' } }
        },
        cancelStream: async () => ({ success: true }),
      },
    }
    useGrpcStore.setState({ _tabStates: new Map(), _currentTabId: null })
    useGrpcStore.getState().switchToTab('A')
    useGrpcStore.setState({
      address: 'a.example:1',
      requestBody: '{}',
      services: [
        {
          name: 'a.Greeter',
          methods: [{ name: 'Chat', type: 'bidi_streaming', requestType: 'Q', responseType: 'R' }],
        },
      ],
      selectedService: 'a.Greeter',
      selectedMethod: 'Chat',
    })
    await useGrpcStore.getState().execute()
    const g = useGrpcStore.getState()
    expect(g.errorMessage).toBe('Method not found: Chat')
    expect(g.isStreaming).toBe(false)
    expect(g.activeStreamId).toBeNull()
    expect(ch.listeners).toHaveLength(0)
  })

  it('gRPC client stream: main answers with data + end before the stream id', async () => {
    const ch = channel()
    ;(window as unknown as { api: unknown }).api = {
      grpc: {
        onStreamEvent: ch.on,
        bidiStream: async () => {
          ch.emit({ streamId: 'g-cs', type: 'data', data: '{"total":3}' })
          ch.emit({ streamId: 'g-cs', type: 'end' })
          return { success: true, data: { streamId: 'g-cs' } }
        },
        sendStreamMessage: vi.fn(async () => ({ success: true })),
        cancelStream: async () => ({ success: true }),
      },
    }
    useGrpcStore.setState({ _tabStates: new Map(), _currentTabId: null })
    useGrpcStore.getState().switchToTab('A')
    useGrpcStore.setState({
      address: 'a.example:1',
      requestBody: '{}',
      services: [
        {
          name: 'a.Greeter',
          methods: [{ name: 'Sum', type: 'client_streaming', requestType: 'Q', responseType: 'R' }],
        },
      ],
      selectedService: 'a.Greeter',
      selectedMethod: 'Sum',
    })
    await useGrpcStore.getState().execute()
    const g = useGrpcStore.getState()
    expect(g.streamEvents.map((e) => e.data)).toEqual(['{"total":3}'])
    expect(g.isStreaming).toBe(false)
    expect(g.activeStreamId).toBeNull()
    expect(ch.listeners).toHaveLength(0)
  })

  it('gRPC server stream: a data flood before the stream id is counted, not silent', async () => {
    const ch = channel()
    ;(window as unknown as { api: unknown }).api = {
      grpc: {
        onStreamEvent: ch.on,
        serverStream: async () => {
          for (let i = 0; i < FLOOD; i++) ch.emit({ streamId: 'g-f', type: 'data', data: `${i}` })
          return { success: true, data: { streamId: 'g-f' } }
        },
        cancelStream: async () => ({ success: true }),
      },
    }
    useGrpcStore.setState({ _tabStates: new Map(), _currentTabId: null })
    useGrpcStore.getState().switchToTab('A')
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
    await useGrpcStore.getState().execute()
    const g = useGrpcStore.getState()
    expect(g.streamEvents).toHaveLength(1000)
    expect(g.droppedEarly).toBe(1)
    expect(g.isStreaming).toBe(true)
  })
})
