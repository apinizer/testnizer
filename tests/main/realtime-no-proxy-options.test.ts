/**
 * With no proxy, each connection hands its library exactly what it did before the
 * proxy existed: these options are copied from the code as it stood. A stand-in for
 * each library records them. If an entry here has to change, the no-proxy path changed.
 */
import { EventEmitter } from 'node:events'
import { Module } from 'node:module'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const seen = vi.hoisted(() => ({
  ws: [] as unknown[][],
  sio: [] as unknown[][],
  mqtt: [] as unknown[][],
  mqttClient: [] as unknown[][],
  es: [] as unknown[][],
}))

vi.mock('electron', () => {
  const win = { id: 1, isDestroyed: () => false, webContents: { send: () => {} } }
  return { BrowserWindow: { fromId: () => win, getAllWindows: () => [win] } }
})
vi.mock('ws', async () => {
  const { EventEmitter: Emitter } = await import('node:events')
  class FakeWs extends Emitter {
    static CONNECTING = 0
    static OPEN = 1
    readyState = 0
    constructor(...args: unknown[]) {
      super()
      seen.ws.push(args)
    }
    terminate(): void {}
    close(): void {}
  }
  return { default: FakeWs, WebSocket: FakeWs }
})
vi.mock('socket.io-client', async () => {
  const { EventEmitter: Emitter } = await import('node:events')
  return {
    io: (...args: unknown[]) => {
      seen.sio.push(args)
      const socket = new Emitter() as EventEmitter & Record<string, unknown>
      socket.io = new Emitter()
      socket.disconnect = () => {}
      socket.onAny = () => {}
      socket.connect = () => {}
      return socket
    },
  }
})
vi.mock('mqtt', async () => {
  const { EventEmitter: Emitter } = await import('node:events')
  class FakeClient extends Emitter {
    options: Record<string, unknown> = {}
    constructor(...args: unknown[]) {
      super()
      seen.mqttClient.push(args)
    }
    end(): void {}
  }
  return {
    MqttClient: FakeClient,
    connect: (...args: unknown[]) => {
      seen.mqtt.push(args)
      const client = new Emitter() as EventEmitter & Record<string, unknown>
      client.options = {}
      client.end = () => {}
      return client
    },
  }
})
vi.mock('eventsource', () => {
  class FakeEs {
    static CONNECTING = 0
    static OPEN = 1
    static CLOSED = 2
    readyState = 0
    constructor(...args: unknown[]) {
      seen.es.push(args)
    }
    addEventListener(): void {}
    close(): void {}
  }
  return { EventSource: FakeEs }
})

const { connect: wsConnect } = await import('../../src/main/protocols/websocket.engine')
const { socketIOConnect } = await import('../../src/main/protocols/socketio.engine')
const { mqttConnect } = await import('../../src/main/protocols/mqtt.engine')
const sse = await import('../../src/main/protocols/sse.engine')
const { gqlWsConnect } = await import('../../src/main/protocols/graphql-ws.engine')
const { resolveConnectionProxy } = await import('../../src/main/lib/proxy-tunnel')

beforeEach(() => {
  for (const list of Object.values(seen)) list.length = 0
})
afterEach(() => vi.unstubAllGlobals())

const noop = (): void => {}
const ignore = (p: Promise<unknown>): void => void p.catch(noop)

describe('no proxy configured resolves to none', () => {
  it.each([undefined, null, { mode: 'system' as const }, { mode: 'none' as const }])(
    '%j',
    (setting) => {
      const before = process.env
      process.env = {}
      try {
        expect(resolveConnectionProxy(setting, 'ws://s.test')).toBeNull()
      } finally {
        process.env = before
      }
    },
  )
})

describe.each([
  ['absent', {}],
  ['null', { proxy: null }],
])('with the proxy %s, what each library receives', (_label, noProxy) => {
  it('WebSocket', () => {
    ignore(
      wsConnect(
        {
          url: 'ws://s.test/x',
          headers: { A: 'b' },
          protocols: ['p'],
          rejectUnauthorized: false,
          handshakeTimeout: 1000,
          maxPayload: 2000,
          ...noProxy,
        },
        1,
      ),
    )
    const [url, protocols, options] = seen.ws[0] as [string, string[], Record<string, unknown>]
    expect(url).toBe('ws://s.test/x')
    expect(protocols).toEqual(['p'])
    expect(options).not.toHaveProperty('agent')
    expect(options).toEqual({
      headers: { A: 'b' },
      // One second past the engine's own timer, which words the message.
      handshakeTimeout: 2000,
      maxPayload: 2000,
      rejectUnauthorized: false,
    })
  })

  it('GraphQL subscription', () => {
    ignore(
      gqlWsConnect({
        connectionId: `pin-${Math.random()}`,
        url: 'ws://s.test/graphql',
        payload: { query: 'subscription { t }', variables: {} },
        onEvent: noop,
        ...noProxy,
      }),
    )
    const [url, protocols, options] = seen.ws[0] as [string, string[], Record<string, unknown>]
    expect(url).toBe('ws://s.test/graphql')
    expect(protocols).toEqual(['graphql-transport-ws', 'graphql-ws'])
    expect(options).not.toHaveProperty('agent')
    expect(options).toEqual({ headers: {}, rejectUnauthorized: true })
  })

  it('Socket.IO v4', () => {
    ignore(socketIOConnect({ url: 'http://s.test', settings: { version: '4' }, ...noProxy }))
    const options = seen.sio[0][1] as Record<string, unknown>
    expect(options).not.toHaveProperty('agent')
    expect(options).toEqual({
      path: '/socket.io',
      forceNew: true,
      reconnection: false,
      reconnectionAttempts: 0,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 1000,
      randomizationFactor: 0,
      timeout: 10_000,
      transports: ['websocket', 'polling'],
      rejectUnauthorized: true,
    })
  })

  it('MQTT over TCP and WebSocket take `mqtt.connect` with nothing added', () => {
    for (const url of ['mqtt://s.test', 'ws://s.test']) {
      ignore(mqttConnect({ url, version: 4, clientId: 'pin', onEvent: noop, ...noProxy }))
    }
    expect(seen.mqttClient).toEqual([])
    expect(seen.mqtt.map(([url]) => url)).toEqual(['mqtt://s.test', 'ws://s.test'])
    for (const [, options] of seen.mqtt as Array<[string, Record<string, unknown>]>) {
      expect(options).not.toHaveProperty('wsOptions')
      expect(options).not.toHaveProperty('agent')
      expect(options).toEqual({
        clientId: 'pin',
        protocolVersion: 4,
        clean: true,
        keepalive: 60,
        connectTimeout: 30_000,
        reconnectPeriod: 0,
        resubscribe: true,
        rejectUnauthorized: true,
      })
    }
  })

  it('SSE: both paths use the global fetch and never load undici', async () => {
    const loaded: string[] = []
    const load = Module as unknown as { _load: (r: string, ...a: unknown[]) => unknown }
    const original = load._load
    load._load = function (request: string, ...rest: unknown[]) {
      loaded.push(request)
      return original.call(this, request, ...rest)
    }
    const globalFetch = vi.fn(async () => new Response(null, { status: 500 }))
    vi.stubGlobal('fetch', globalFetch)
    try {
      ignore(sse.connect({ url: 'http://s.test/s', ...noProxy }, 1))
      const [url, init] = seen.es[0] as [string, { fetch: typeof fetch; withCredentials: boolean }]
      expect(url).toBe('http://s.test/s')
      expect(Object.keys(init).sort()).toEqual(['fetch', 'withCredentials'])
      await init.fetch('http://s.test/s', { headers: {} } as never)
      expect(globalFetch).toHaveBeenCalledTimes(1)

      globalFetch.mockClear()
      ignore(sse.connect({ url: 'http://s.test/s', method: 'POST', body: '{}', ...noProxy }, 1))
      expect(globalFetch).toHaveBeenCalledTimes(1)
      const [, postInit] = globalFetch.mock.calls[0] as unknown as [string, RequestInit]
      expect(postInit).not.toHaveProperty('dispatcher')
      expect(loaded).not.toContain('undici')
    } finally {
      load._load = original
    }
  })
})

describe('Socket.IO v2', () => {
  it('takes no agent, with its required options', async () => {
    // A lazy CommonJS `require`, out of `vi.mock`'s reach.
    const load = Module as unknown as { _load: (r: string, ...a: unknown[]) => unknown }
    const original = load._load
    const v2Calls: unknown[][] = []
    load._load = function (request: string, ...rest: unknown[]) {
      if (request === 'socket.io-client-v2') {
        return (...args: unknown[]) => {
          v2Calls.push(args)
          const socket = new EventEmitter() as EventEmitter & Record<string, unknown>
          socket.io = new EventEmitter()
          socket.disconnect = () => {}
          socket.close = () => {}
          return socket
        }
      }
      return original.call(this, request, ...rest)
    }
    try {
      ignore(socketIOConnect({ url: 'http://s.test', settings: { version: '2' } }))
      await vi.waitFor(() => expect(v2Calls.length).toBe(1))
      expect(v2Calls[0][0]).toBe('http://s.test')
      const options = v2Calls[0][1] as Record<string, unknown>
      expect(options).not.toHaveProperty('agent')
      expect(options).toEqual({
        path: '/socket.io',
        forceNew: true,
        reconnection: false,
        reconnectionAttempts: 0,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 1000,
        randomizationFactor: 0,
        timeout: 10_000,
        transports: ['websocket', 'polling'],
        rejectUnauthorized: true,
        query: {},
        forceNode: true,
        transportOptions: {
          polling: { extraHeaders: {} },
          websocket: { extraHeaders: {} },
        },
      })
    } finally {
      load._load = original
    }
  })
})
