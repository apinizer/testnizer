/**
 * #21 — Socket.io disconnect must NOT wipe the request configuration. Before
 * the fix, disconnect() reset to emptyState() keeping only url/namespace/
 * bearerToken, so the configured emit event/payload + subscriptions were lost
 * on every connect→disconnect cycle.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useSocketIOStore } from '../../src/renderer/stores/socketio.store'

beforeEach(() => {
  ;(globalThis as unknown as { window: { api: unknown } }).window = {
    api: {
      socketio: {
        disconnect: vi.fn(async () => ({ success: true })),
        cancelConnect: vi.fn(async () => ({ success: true })),
      },
    },
  }
})

describe('socketio.store.disconnect (#21)', () => {
  it('preserves the request config (emit, args, listeners, headers, settings) across disconnect', async () => {
    useSocketIOStore.setState({
      ...useSocketIOStore.getState(),
      url: 'wss://example.test',
      namespace: '/ns',
      bearerToken: 'tok',
      emitEvent: 'chat',
      emitArgs: [{ id: 'a1', content: '{"a":1}', contentType: 'json' }],
      emitAck: true,
      listeners: [{ id: 'l1', name: 'evtA', description: '', listen: true }],
      listenAll: false,
      newListener: 'draft',
      customHeaders: [{ id: 'h1', key: 'X-A', value: '1', enabled: true }],
      settings: { ...useSocketIOStore.getState().settings, retryCount: 3 },
      events: [{ id: 'e1', direction: 'in', event: 'hello', data: 1, timestamp: 1 }],
      connectionId: 'c1',
      connectionState: 'connected',
    })

    await useSocketIOStore.getState().disconnect()

    const s = useSocketIOStore.getState()
    expect(s.connectionState).toBe('disconnected')
    expect(s.connectionId).toBeNull()
    // request-model config survives
    expect(s.emitEvent).toBe('chat')
    expect(s.emitArgs[0].content).toBe('{"a":1}')
    expect(s.emitAck).toBe(true)
    expect(s.listeners.map((l) => l.name)).toEqual(['evtA'])
    expect(s.newListener).toBe('draft')
    expect(s.customHeaders[0].key).toBe('X-A')
    expect(s.settings.retryCount).toBe(3)
    expect(s.url).toBe('wss://example.test')
    expect(s.namespace).toBe('/ns')
    // Issue #283: the timeline stays, with a closing connection row.
    expect(s.events.map((e) => e.event)).toEqual(['hello', 'disconnected'])
  })
})

describe('socketio.store: Cancel during the handshake (issue #283)', () => {
  it('the cancelled connect fails quietly: disconnected, no error, no error row', async () => {
    let settle: (r: { success: false; error: string }) => void = () => {}
    const api = (
      globalThis as unknown as { window: { api: { socketio: Record<string, unknown> } } }
    ).window.api.socketio
    const connect = vi.fn(
      () =>
        new Promise((r) => {
          settle = r
        }),
    )
    api.connect = connect
    api.onEvent = vi.fn(() => () => {})
    api.onClosed = vi.fn(() => () => {})
    useSocketIOStore.setState({
      ...useSocketIOStore.getState(),
      url: 'http://slow.test',
      bearerToken: '',
      bearerTokenWithheld: false,
      withheldCredentials: [],
      customHeaders: [],
      params: [],
      events: [],
      connectionId: null,
      connectionState: 'disconnected',
      errorMessage: null,
    })

    const connecting = useSocketIOStore.getState().connect()
    await vi.waitFor(() => expect(connect).toHaveBeenCalled())
    expect(useSocketIOStore.getState().connectionState).toBe('connecting')

    await useSocketIOStore.getState().disconnect()
    expect(api.cancelConnect).toHaveBeenCalled()
    // Main rejects the cancelled handshake (it no longer hangs).
    settle({ success: false, error: 'Connection cancelled' })
    await connecting

    const s = useSocketIOStore.getState()
    expect(s.connectionState).toBe('disconnected')
    expect(s.errorMessage).toBeNull()
    expect(s.events.some((e) => e.event === 'error')).toBe(false)
  })
})
