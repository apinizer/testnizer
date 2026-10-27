/**
 * Issue #283 follow-up — ONE lifetime rule for the realtime editors'
 * connections (WebSocket, Socket.IO, MQTT), `lib/realtime-connections.ts`:
 *
 *   1. closing a tab closes its connection / cancels its pending handshake;
 *   2. leaving a project closes every connection opened in it.
 *
 * Fail-before: only MQTT applied rule 2. WebSocket and Socket.IO kept a hidden
 * project's connections open, and dropping that project's tab snapshot
 * (closing its header tab, deleting it, switching workspace) never closed
 * them — open in main with no tab left to disconnect them. WebSocket broke
 * rule 1 too: closing the tab only dropped the listener, the socket stayed
 * open; Socket.IO's tab close did not cancel a pending handshake.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useWebSocketStore } from '../../src/renderer/stores/websocket.store'
import { useSocketIOStore } from '../../src/renderer/stores/socketio.store'
import { useMqttStore } from '../../src/renderer/stores/mqtt.store'
import { useEnvironmentStore } from '../../src/renderer/stores/environment.store'
import { useTabsStore } from '../../src/renderer/stores/tabs.store'
import { useWorkspaceStore } from '../../src/renderer/stores/workspace.store'

type Fn = ReturnType<typeof vi.fn>
interface ProtocolApi {
  connect: Fn
  disconnect: Fn
  cancelConnect: Fn
}

let seq = 0
/** Pending connect replies of the current test, settled by `settleAll`. */
let held: Array<(outcome?: 'fail' | 'succeed') => void> = []

function protocolApi(reply: (id: string) => unknown, hold = false): ProtocolApi {
  return {
    connect: vi.fn(() => {
      const id = `conn-${++seq}`
      if (!hold) return Promise.resolve({ success: true, data: reply(id) })
      return new Promise((r) =>
        held.push((outcome = 'fail') =>
          r(
            outcome === 'succeed'
              ? { success: true, data: reply(id) }
              : { success: false, error: 'Connection cancelled' },
          ),
        ),
      )
    }),
    disconnect: vi.fn(async () => ({ success: true, data: true })),
    cancelConnect: vi.fn(async () => ({ success: true, data: { canceled: true } })),
  }
}

function installApi(hold = false): Record<'ws' | 'socketio' | 'mqtt', ProtocolApi> {
  const subscribeNoop = () => () => {}
  const ws = protocolApi((id) => ({ connectionId: id }), hold)
  const socketio = protocolApi(
    (id) => ({ connectionId: id, url: 'http://x', namespace: '/' }),
    hold,
  )
  const mqtt = protocolApi(
    (id) => ({ connectionId: id, clientId: 'c', url: 'mqtt://x', sessionPresent: false }),
    hold,
  )
  ;(window as unknown as { api: unknown }).api = {
    ws: { ...ws, onEvent: subscribeNoop },
    socketio: { ...socketio, onEvent: subscribeNoop, onClosed: subscribeNoop },
    mqtt: { ...mqtt, onEvent: subscribeNoop, onClosed: subscribeNoop },
  }
  return { ws, socketio, mqtt }
}

interface Case {
  name: string
  api: 'ws' | 'socketio' | 'mqtt'
  /** Switch the store to `tabId` and Connect it. */
  connect: (tabId: string) => Promise<void>
  removeTab: (tabId: string) => void
  /** The tab's slice, live or cached. */
  slice: (tabId: string) => { connectionId: string | null; connectionState: string }
  /** The last timeline row's [event, detail]. */
  lastRow: (tabId: string) => [string, unknown]
}

function sliceOf<T>(
  s: { _currentTabId: string | null; _tabStates: Map<string, T> } & T,
  id: string,
): T {
  return s._currentTabId === id ? s : (s._tabStates.get(id) as T)
}

const CASES: Case[] = [
  {
    name: 'WebSocket',
    api: 'ws',
    connect: async (tabId) => {
      useWebSocketStore.getState().switchToTab(tabId)
      useWebSocketStore.getState().setUrl('ws://h.test/live')
      await useWebSocketStore.getState().connect()
    },
    removeTab: (tabId) => useWebSocketStore.getState().removeTabState(tabId),
    slice: (tabId) => sliceOf(useWebSocketStore.getState(), tabId),
    lastRow: (tabId) => {
      const m = sliceOf(useWebSocketStore.getState(), tabId).messages.at(-1)
      return [m?.event ?? '', m?.content]
    },
  },
  {
    name: 'Socket.IO',
    api: 'socketio',
    connect: async (tabId) => {
      useSocketIOStore.getState().switchToTab(tabId)
      useSocketIOStore.getState().setUrl('http://h.test')
      await useSocketIOStore.getState().connect()
    },
    removeTab: (tabId) => useSocketIOStore.getState().removeTabState(tabId),
    slice: (tabId) => sliceOf(useSocketIOStore.getState(), tabId),
    lastRow: (tabId) => {
      const e = sliceOf(useSocketIOStore.getState(), tabId).events.at(-1)
      return [e?.event ?? '', e?.data]
    },
  },
  {
    name: 'MQTT',
    api: 'mqtt',
    connect: async (tabId) => {
      useMqttStore.getState().switchToTab(tabId)
      useMqttStore.getState().setUrl('mqtt://h.test:1883')
      await useMqttStore.getState().connect()
    },
    removeTab: (tabId) => useMqttStore.getState().removeTabState(tabId),
    slice: (tabId) => sliceOf(useMqttStore.getState(), tabId),
    lastRow: (tabId) => {
      const r = sliceOf(useMqttStore.getState(), tabId).log.at(-1)
      return [r?.event ?? '', r?.content]
    },
  },
]

beforeEach(() => {
  window.localStorage.clear()
  held = []
  useEnvironmentStore.setState({ getActiveVariables: () => ({}) })
  useWorkspaceStore.setState({ activeProjectId: 'p1', activeWorkspaceId: 'w1' } as never)
  useTabsStore.setState({ tabs: [], activeTabId: null })
  useWebSocketStore.setState({ _tabStates: new Map(), _currentTabId: null })
  useSocketIOStore.setState({ _tabStates: new Map(), _currentTabId: null })
  useMqttStore.setState({ _tabStates: new Map(), _currentTabId: null })
})

describe.each(CASES)('$name', (c) => {
  it('leaving the project closes its connections, live and cached tabs alike', async () => {
    const api = installApi()[c.api]
    await c.connect('t-a')
    await c.connect('t-b') // t-a is now a cached slice, t-b the live one
    const a = c.slice('t-a').connectionId
    const b = c.slice('t-b').connectionId
    expect(a).toBeTruthy()
    expect(b).toBeTruthy()

    useWorkspaceStore.setState({ activeProjectId: 'p2' } as never)

    expect(api.disconnect).toHaveBeenCalledWith(a)
    expect(api.disconnect).toHaveBeenCalledWith(b)
    for (const id of ['t-a', 't-b']) {
      expect(c.slice(id)).toMatchObject({ connectionId: null, connectionState: 'disconnected' })
      expect(c.lastRow(id)).toEqual(['disconnected', 'project switched'])
    }
  })

  it('Home closes them too; re-entering the same project does not', async () => {
    const api = installApi()[c.api]
    await c.connect('t-a')
    useWorkspaceStore.setState({ activeProjectId: 'p1' } as never)
    expect(api.disconnect).not.toHaveBeenCalled()
    useWorkspaceStore.setState({ activeProjectId: null } as never)
    expect(api.disconnect).toHaveBeenCalledTimes(1)
  })

  it('a handshake still pending when the project is left is cancelled', async () => {
    const api = installApi(true)[c.api]
    const pending = c.connect('t-a')
    await vi.waitFor(() => expect(api.connect).toHaveBeenCalled())
    useWorkspaceStore.setState({ activeProjectId: 'p2' } as never)
    expect(api.cancelConnect).toHaveBeenCalledTimes(1)
    for (const settle of held) settle()
    await pending
    expect(c.slice('t-a').connectionState).not.toBe('connected')
  })

  it('closing the tab closes its connection', async () => {
    const api = installApi()[c.api]
    await c.connect('t-a')
    const id = c.slice('t-a').connectionId
    await c.connect('t-b')
    c.removeTab('t-a') // a cached tab
    expect(api.disconnect).toHaveBeenCalledWith(id)
    const live = c.slice('t-b').connectionId
    c.removeTab('t-b') // the live tab
    expect(api.disconnect).toHaveBeenCalledWith(live)
  })

  it('closing a tab mid-handshake cancels the handshake', async () => {
    const api = installApi(true)[c.api]
    const pending = c.connect('t-a')
    await vi.waitFor(() => expect(api.connect).toHaveBeenCalled())
    c.removeTab('t-a')
    expect(api.cancelConnect).toHaveBeenCalledTimes(1)
    for (const settle of held) settle()
    await pending
  })
})

describe('Socket.IO: a handshake that completes as it is given up', () => {
  it('is closed at once instead of being adopted by a tab that left it', async () => {
    const api = installApi(true).socketio
    const pending = CASES[1].connect('t-a')
    await vi.waitFor(() => expect(api.connect).toHaveBeenCalled())
    useWorkspaceStore.setState({ activeProjectId: 'p2' } as never)
    // The engine finished the handshake before the cancel reached it.
    for (const settle of held) settle('succeed')
    await pending
    expect(api.disconnect).toHaveBeenCalledWith('conn-' + seq)
    expect(CASES[1].slice('t-a')).toMatchObject({
      connectionId: null,
      connectionState: 'disconnected',
    })
  })
})
