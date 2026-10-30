/**
 * Issue #275 — the Socket.IO store notices a server-initiated close.
 *
 * Main pushes `socketio:closed` {connectionId, reason}. Fail-before: the store
 * had no `onClosed` subscription, so it stayed "connected" with a dead
 * connectionId and every Emit went to a connection main no longer knew.
 * Also pinned: the close lands on the tab that owns the connection even after
 * a tab switch (issue #76 class), and a close pushed before the connect reply
 * (a kick right after the handshake) is not lost.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useSocketIOStore } from '../../src/renderer/stores/socketio.store'

type Handler = (e: unknown) => void

let eventHandlers: Handler[]
let closedHandlers: Handler[]
let connectReply: ((v: unknown) => void) | null
const disconnect = vi.fn(async () => ({ success: true }))
const emitArgs = vi.fn(async () => ({ success: true }))

function installApi(): void {
  eventHandlers = []
  closedHandlers = []
  connectReply = null
  ;(globalThis as unknown as { window: { api: unknown } }).window.api = {
    socketio: {
      connect: vi.fn(() => new Promise((r) => (connectReply = r))),
      disconnect,
      cancelConnect: vi.fn(async () => ({ success: true })),
      emitArgs,
      setListen: vi.fn(async () => ({ success: true })),
      onEvent: (h: Handler) => {
        eventHandlers.push(h)
        return () => (eventHandlers = eventHandlers.filter((x) => x !== h))
      },
      onClosed: (h: Handler) => {
        closedHandlers.push(h)
        return () => (closedHandlers = closedHandlers.filter((x) => x !== h))
      },
    },
  }
}

const pushClosed = (connectionId: string, reason: string): void =>
  closedHandlers.slice().forEach((h) => h({ connectionId, reason }))
const pushEvent = (connectionId: string, event: string, data: unknown): void =>
  eventHandlers
    .slice()
    .forEach((h) => h({ connectionId, direction: 'in', event, data, timestamp: Date.now() }))

async function connectTab(tabId: string, connectionId: string): Promise<void> {
  useSocketIOStore.getState().switchToTab(tabId)
  useSocketIOStore.setState({ url: 'http://sio.test', emitEvent: 'chat' })
  const p = useSocketIOStore.getState().connect()
  await vi.waitFor(() => expect(connectReply).not.toBeNull())
  connectReply!({ success: true, data: { connectionId } })
  connectReply = null
  await p
}

beforeEach(() => {
  installApi()
  disconnect.mockClear()
  emitArgs.mockClear()
  useSocketIOStore.setState({ _tabStates: new Map(), _currentTabId: null })
})

describe('Socket.IO store: server-initiated close (issue #275)', () => {
  it('goes disconnected, drops the connection id, keeps the config and logs the reason', async () => {
    await connectTab('t1', 'c1')
    expect(useSocketIOStore.getState().connectionState).toBe('connected')

    pushClosed('c1', 'io server disconnect')

    const s = useSocketIOStore.getState()
    expect(s.connectionState).toBe('disconnected')
    expect(s.connectionId).toBeNull()
    expect(s.url).toBe('http://sio.test')
    expect(s.emitEvent).toBe('chat')
    const last = s.events[s.events.length - 1]
    expect(last).toMatchObject({
      direction: 'system',
      event: 'disconnected',
      data: 'io server disconnect',
    })
    // Unsubscribed: later pushes for the dead id change nothing.
    expect(closedHandlers).toHaveLength(0)
    expect(eventHandlers).toHaveLength(0)
  })

  it('Emit after the close sends nothing', async () => {
    await connectTab('t1', 'c1')
    pushClosed('c1', 'transport close')
    await useSocketIOStore.getState().emit()
    expect(emitArgs).not.toHaveBeenCalled()
  })

  it('routes the close to the owning tab after a tab switch', async () => {
    await connectTab('t1', 'c1')
    useSocketIOStore.getState().switchToTab('t2')
    pushEvent('c1', 'news', { n: 1 })
    pushClosed('c1', 'io server disconnect')

    // The live (t2) slice is untouched.
    expect(useSocketIOStore.getState().events).toEqual([])
    expect(useSocketIOStore.getState().connectionState).toBe('disconnected')
    const owner = useSocketIOStore.getState()._tabStates.get('t1')!
    expect(owner.connectionState).toBe('disconnected')
    expect(owner.connectionId).toBeNull()
    expect(owner.events.map((e) => e.event)).toEqual(['connected', 'news', 'disconnected'])
  })

  it('a close pushed before the connect reply is applied once the id is known', async () => {
    useSocketIOStore.getState().switchToTab('t1')
    useSocketIOStore.setState({ url: 'http://sio.test' })
    const p = useSocketIOStore.getState().connect()
    await vi.waitFor(() => expect(connectReply).not.toBeNull())
    pushEvent('c9', 'welcome', 'hi')
    pushClosed('c9', 'io server disconnect')
    connectReply!({ success: true, data: { connectionId: 'c9' } })
    await p

    const s = useSocketIOStore.getState()
    expect(s.connectionState).toBe('disconnected')
    expect(s.events.map((e) => e.event)).toEqual(['connected', 'welcome', 'disconnected'])
  })

  it('a push for another connection id is ignored', async () => {
    await connectTab('t1', 'c1')
    pushClosed('other', 'io server disconnect')
    expect(useSocketIOStore.getState().connectionState).toBe('connected')
  })
})
