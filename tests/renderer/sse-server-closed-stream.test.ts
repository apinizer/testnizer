/**
 * The server ending an SSE stream for good must leave the tab, not keep it
 * "Connected" forever (issue #221 review).
 *
 * Per the SSE spec a reconnect answered with HTTP 204 means "stop
 * reconnecting"; `eventsource@3` closes the source and reports one error. Main
 * marks such terminal errors `closed` (`'ended'` for a 204) (as it does for the fetch path's
 * clean end of stream). Before this fix the store only switched to `error`
 * while still connecting, so a connected tab ignored the close: the state
 * stayed `connected`, Disconnect stayed on screen and the message was hidden.
 *
 * Routing follows the owner-tab rule (issue #76): the close lands in the tab
 * that opened the connection even after the user switched to another tab.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { useSseStore } from '../../src/renderer/stores/sse.store'

type Payload = {
  connectionId: string
  type: 'open' | 'event' | 'error'
  data?: string
  httpStatus?: number
  closed?: 'ended' | 'failed'
  eventType?: string
  id?: string
  timestamp: number
}

let listeners: Array<(e: Payload) => void> = []
const emit = (e: Omit<Payload, 'timestamp'>): void => {
  for (const l of [...listeners]) l({ ...e, timestamp: Date.now() })
}

function installBridge(): void {
  const sse = {
    onEvent: (cb: (e: Payload) => void) => {
      listeners.push(cb)
      return () => {
        listeners = listeners.filter((l) => l !== cb)
      }
    },
    connect: async () => {
      emit({ connectionId: 'c1', type: 'open' })
      return { success: true, data: { connectionId: 'c1' } }
    },
    cancelConnect: async () => ({ success: true, data: { canceled: false } }),
    disconnect: async () => ({ success: true, data: true }),
  }
  ;(window as unknown as { api: { sse: typeof sse } }).api = { sse }
}

async function connectTab(tabId: string): Promise<void> {
  useSseStore.getState().switchToTab(tabId)
  useSseStore.getState().setUrl('http://127.0.0.1:3200/events')
  await useSseStore.getState().connect()
  expect(useSseStore.getState().connectionState).toBe('connected')
}

beforeEach(() => {
  listeners = []
  installBridge()
  useSseStore.setState({
    _tabStates: new Map(),
    _currentTabId: null,
    connectionId: null,
    connectionState: 'disconnected',
    errorMessage: null,
    events: [],
    _unsubscribe: undefined,
    _pendingConnectId: undefined,
  })
})

afterEach(() => {
  delete (window as unknown as { api?: unknown }).api
})

describe('sse.store — the server closes the stream', () => {
  it('a reconnect refused with HTTP 204 leaves the connected state, with a visible message', async () => {
    await connectTab('tab-a')
    emit({
      connectionId: 'c1',
      type: 'error',
      data: 'HTTP 204 Server sent HTTP 204, not reconnecting',
      httpStatus: 204,
      closed: 'ended',
    })
    const s = useSseStore.getState()
    expect(s.connectionState).toBe('disconnected')
    expect(s.connectionId).toBeNull()
    expect(s.errorMessage).toBe('The server closed the stream (HTTP 204)')
    // The subscription is gone — a stale listener would accept every connection's events.
    expect(listeners).toHaveLength(0)
    expect(s._unsubscribe).toBeUndefined()
  })

  it('the fetch path ending the stream cleanly also disconnects', async () => {
    await connectTab('tab-a')
    emit({ connectionId: 'c1', type: 'error', data: 'SSE stream closed', closed: 'ended' })
    const s = useSseStore.getState()
    expect(s.connectionState).toBe('disconnected')
    expect(s.errorMessage).toBe('The server closed the stream')
  })

  it('a terminal non-204 failure while connected switches to error with its message', async () => {
    await connectTab('tab-a')
    emit({
      connectionId: 'c1',
      type: 'error',
      data: 'HTTP 503 Service Unavailable',
      httpStatus: 503,
      closed: 'failed',
    })
    const s = useSseStore.getState()
    expect(s.connectionState).toBe('error')
    expect(s.errorMessage).toBe('HTTP 503 Service Unavailable')
    expect(listeners).toHaveLength(0)
  })

  it('a transient error while connected (the client reconnects) keeps the connection', async () => {
    await connectTab('tab-a')
    emit({ connectionId: 'c1', type: 'error', data: 'Connection refused — ECONNREFUSED' })
    const s = useSseStore.getState()
    expect(s.connectionState).toBe('connected')
    expect(s.errorMessage).toBe('Connection refused — ECONNREFUSED')
    expect(listeners).toHaveLength(1)
  })

  it('routes the close to the owner tab after the user switched away (issue #76)', async () => {
    await connectTab('tab-a')
    useSseStore.getState().switchToTab('tab-b')
    emit({
      connectionId: 'c1',
      type: 'error',
      data: 'HTTP 204 Server sent HTTP 204, not reconnecting',
      httpStatus: 204,
      closed: 'ended',
    })
    // The live slice is tab B's — untouched.
    expect(useSseStore.getState().connectionState).toBe('disconnected')
    expect(useSseStore.getState().errorMessage).toBeNull()
    const cached = useSseStore.getState()._tabStates.get('tab-a')
    expect(cached?.connectionState).toBe('disconnected')
    expect(cached?.connectionId).toBeNull()
    expect(cached?.errorMessage).toBe('The server closed the stream (HTTP 204)')
    expect(cached?._unsubscribe).toBeUndefined()
    // Back on tab A the close is what the user sees.
    useSseStore.getState().switchToTab('tab-a')
    expect(useSseStore.getState().connectionState).toBe('disconnected')
    expect(useSseStore.getState().errorMessage).toBe('The server closed the stream (HTTP 204)')
  })

  it('a refusal on the first connect stays an error (nothing was ever connected)', async () => {
    const api = (window as unknown as { api: { sse: Record<string, unknown> } }).api
    api.sse.connect = async () => {
      emit({
        connectionId: 'c2',
        type: 'error',
        data: 'HTTP 204 Server sent HTTP 204, not reconnecting',
        httpStatus: 204,
        closed: 'ended',
      })
      return { success: false, error: 'HTTP 204 Server sent HTTP 204, not reconnecting' }
    }
    useSseStore.getState().switchToTab('tab-a')
    useSseStore.getState().setUrl('http://127.0.0.1:3200/events')
    await useSseStore.getState().connect()
    const s = useSseStore.getState()
    expect(s.connectionState).toBe('error')
    expect(s.errorMessage).toMatch(/HTTP 204/)
  })
})
