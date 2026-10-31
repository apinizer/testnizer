/**
 * Issue #253 — what the user SEES. A failed connect arrives as
 * `{ success:false, error:'<English>', errorInfo }` (and, for WebSocket / SSE,
 * as an `error` event carrying `errorInfo`); every realtime store shows
 * `describeConnectionError(errorInfo, error)` — the active locale's text with
 * the host:port — instead of the raw English string. Old payloads without
 * `errorInfo` still show `error` unchanged.
 *
 * Contract: see `connection-error-i18n.test.ts`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useWebSocketStore } from '../../src/renderer/stores/websocket.store'
import { useSseStore } from '../../src/renderer/stores/sse.store'
import { useSocketIOStore } from '../../src/renderer/stores/socketio.store'
import { useMqttStore } from '../../src/renderer/stores/mqtt.store'
import { useMcpStore } from '../../src/renderer/stores/mcp.store'
import { useEnvironmentStore } from '../../src/renderer/stores/environment.store'
import { useTabsStore } from '../../src/renderer/stores/tabs.store'
import { setLocale, valuesInAllLocales } from '../../src/renderer/lib/i18n'
import type { ConnectionErrorInfo } from '../../src/shared/connection-error'

const EN_ERROR = 'Connection refused — 127.0.0.1:3100. Check that the server is running'
const INFO: ConnectionErrorInfo = {
  kind: 'refused',
  target: '127.0.0.1:3100',
  message: 'Connection refused — 127.0.0.1:3100',
  hint: 'Check that the server is running',
}
const FAILED = { success: false, error: EN_ERROR, errorInfo: INFO }
const LEGACY_FAILED = { success: false, error: 'Plain old error' }

// valuesInAllLocales: [en, tr] — `undefined` until the keys exist.
const TR_REFUSED = valuesInAllLocales('connError.refused.what')[1] ?? '__missing_tr_key__'

type Listener = (e: unknown) => void
const wsListeners: Listener[] = []
const sseListeners: Listener[] = []
const connectResult = { current: FAILED as Record<string, unknown> }
const connect = vi.fn(async (..._a: unknown[]) => connectResult.current)
const quiet = vi.fn(async () => ({ success: true, data: { canceled: false } }))

beforeEach(() => {
  wsListeners.length = 0
  sseListeners.length = 0
  connectResult.current = FAILED
  connect.mockClear()
  ;(globalThis as unknown as { window: { api: unknown } }).window.api = {
    ws: {
      connect,
      disconnect: quiet,
      cancelConnect: quiet,
      onEvent: (h: Listener) => {
        wsListeners.push(h)
        return () => {}
      },
    },
    sse: {
      connect,
      disconnect: quiet,
      cancelConnect: quiet,
      onEvent: (h: Listener) => {
        sseListeners.push(h)
        return () => {}
      },
    },
    socketio: {
      connect,
      disconnect: quiet,
      cancelConnect: quiet,
      onEvent: () => () => {},
      onClosed: () => () => {},
    },
    mqtt: {
      connect,
      disconnect: quiet,
      cancelConnect: quiet,
      onEvent: () => () => {},
      onClosed: () => () => {},
    },
    mcp: {
      connect,
      disconnect: quiet,
      cancelConnect: quiet,
      onEvent: () => () => {},
      onNotification: () => () => {},
      onFrame: () => () => {},
    },
  }
  useEnvironmentStore.setState({ getActiveVariables: () => ({}) })
  useTabsStore.setState({ tabs: [], activeTabId: null })
})
afterEach(() => setLocale('en'))

interface Case {
  name: string
  /** Connect with the failing mock; resolves once the attempt is over. */
  run: () => Promise<string | null>
}

const cases: Case[] = [
  {
    name: 'WebSocket',
    run: async () => {
      useWebSocketStore.setState({ _tabStates: new Map(), _currentTabId: null })
      useWebSocketStore.getState().switchToTab('t-ws')
      useWebSocketStore.getState().setUrl('ws://127.0.0.1:3100')
      await useWebSocketStore.getState().connect()
      return useWebSocketStore.getState().errorMessage
    },
  },
  {
    name: 'SSE',
    run: async () => {
      useSseStore.setState({ _tabStates: new Map(), _currentTabId: null })
      useSseStore.getState().switchToTab('t-sse')
      useSseStore.getState().setUrl('http://127.0.0.1:3100/stream')
      await useSseStore.getState().connect()
      return useSseStore.getState().errorMessage
    },
  },
  {
    name: 'Socket.IO',
    run: async () => {
      useSocketIOStore.setState({ _tabStates: new Map(), _currentTabId: null })
      useSocketIOStore.getState().switchToTab('t-sio')
      useSocketIOStore.getState().setUrl('http://127.0.0.1:3100')
      await useSocketIOStore.getState().connect()
      return useSocketIOStore.getState().errorMessage
    },
  },
  {
    name: 'MQTT',
    run: async () => {
      useMqttStore.setState({ _tabStates: new Map(), _currentTabId: null })
      useMqttStore.getState().switchToTab('t-mqtt')
      useMqttStore.getState().setUrl('mqtt://127.0.0.1:3100')
      await useMqttStore.getState().connect()
      return useMqttStore.getState().errorMessage
    },
  },
  {
    name: 'MCP',
    run: async () => {
      useMcpStore.setState({ _tabStates: new Map(), _currentTabId: null })
      useMcpStore.getState().switchToTab('t-mcp')
      useMcpStore.setState({ transport: 'http', url: 'http://127.0.0.1:3100/mcp' })
      await useMcpStore.getState().connect()
      return useMcpStore.getState().errorMessage
    },
  },
]

describe.each(cases)('$name store shows the classified connect error', ({ run }) => {
  it('EN: the English text with host:port', async () => {
    setLocale('en')
    const shown = await run()
    expect(shown).toBe(EN_ERROR)
    expect(connect).toHaveBeenCalled()
  })

  it('TR: the translated text, same host:port — not the English string', async () => {
    setLocale('tr')
    const shown = await run()
    expect(TR_REFUSED).not.toBe('__missing_tr_key__')
    expect(shown).toContain(TR_REFUSED)
    expect(shown).toContain('127.0.0.1:3100')
    expect(shown).not.toContain('Connection refused')
  })

  it('a payload without errorInfo (old build / non-connection failure) shows `error` as is', async () => {
    connectResult.current = LEGACY_FAILED
    setLocale('tr')
    expect(await run()).toBe('Plain old error')
  })
})

describe('error EVENTS (WebSocket, SSE) are localized too', () => {
  it('WebSocket: an `error` event with errorInfo', async () => {
    setLocale('tr')
    connectResult.current = { success: true, data: { connectionId: 'w1' } }
    useWebSocketStore.setState({ _tabStates: new Map(), _currentTabId: null })
    useWebSocketStore.getState().switchToTab('t-ws2')
    useWebSocketStore.getState().setUrl('ws://127.0.0.1:3100')
    const p = useWebSocketStore.getState().connect()
    wsListeners.forEach((h) =>
      h({ connectionId: 'w1', type: 'error', data: EN_ERROR, errorInfo: INFO, timestamp: 1 }),
    )
    await p
    expect(useWebSocketStore.getState().errorMessage).toContain(TR_REFUSED)
    expect(useWebSocketStore.getState().errorMessage).toContain('127.0.0.1:3100')
  })

  it('SSE: an `error` event with errorInfo', async () => {
    setLocale('tr')
    connectResult.current = { success: true, data: { connectionId: 's1' } }
    useSseStore.setState({ _tabStates: new Map(), _currentTabId: null })
    useSseStore.getState().switchToTab('t-sse2')
    useSseStore.getState().setUrl('http://127.0.0.1:3100/stream')
    const p = useSseStore.getState().connect()
    sseListeners.forEach((h) =>
      h({
        connectionId: 's1',
        type: 'error',
        data: EN_ERROR,
        errorInfo: INFO,
        closed: 'failed',
        timestamp: 1,
      }),
    )
    await p
    expect(useSseStore.getState().errorMessage).toContain(TR_REFUSED)
    expect(useSseStore.getState().errorMessage).toContain('127.0.0.1:3100')
  })
})
