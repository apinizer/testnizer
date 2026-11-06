/**
 * WebSocket, Socket.IO, MQTT and SSE read the proxy with the chain HTTP Send uses
 * (`network-settings.ts`, `resolveProxy`), from the settings as the Proxy panes store
 * them. Reading them takes time, so a connection given up meanwhile must never start,
 * and one whose tab is left meanwhile must still start for its own tab.
 *
 * Fail-before: no store sent a proxy.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useWebSocketStore } from '../../src/renderer/stores/websocket.store'
import { useSocketIOStore } from '../../src/renderer/stores/socketio.store'
import { useMqttStore } from '../../src/renderer/stores/mqtt.store'
import { useSseStore } from '../../src/renderer/stores/sse.store'
import { useGraphQLStore } from '../../src/renderer/stores/graphql.store'
import { useEnvironmentStore } from '../../src/renderer/stores/environment.store'
import { useTabsStore } from '../../src/renderer/stores/tabs.store'
import { useWorkspaceStore } from '../../src/renderer/stores/workspace.store'
import { setLocale } from '../../src/renderer/lib/i18n'
import {
  describeConnectionError,
  type ConnectionErrorInfo,
} from '../../src/renderer/lib/connection-error'
import type { ProxySetting } from '../../src/shared/request-settings'

const connect = vi.fn(async (_opts: Record<string, unknown>) => ({
  success: true,
  data: { connectionId: 'c1' },
}))
const cancelConnect = vi.fn(async (_id: string) => ({ success: true, data: { canceled: false } }))
const bridge = () => ({
  connect,
  cancelConnect,
  disconnect: vi.fn(async () => ({ success: true, data: true })),
  onEvent: () => () => {},
  onClosed: () => () => {},
})

let settings: Record<string, unknown>
/** Held settings reads; a test releases them when it has done its part. */
let holdSettings: Promise<void> | null
const settingsGet = vi.fn(async (key: string) => {
  if (holdSettings) await holdSettings
  return { success: true, data: settings[key] }
})

interface Store {
  getState: () => {
    switchToTab: (id: string) => void
    connect: () => Promise<void>
    disconnect: () => Promise<void>
    setUrl: (url: string) => void
    connectionState: string
  }
  setState: (s: Record<string, unknown>) => void
}
const STORES: Array<[string, Store, string]> = [
  ['WebSocket', useWebSocketStore as unknown as Store, 'ws://server.test/x'],
  ['Socket.IO', useSocketIOStore as unknown as Store, 'http://server.test'],
  ['MQTT', useMqttStore as unknown as Store, 'mqtt://server.test'],
  ['SSE', useSseStore as unknown as Store, 'http://server.test/s'],
]

interface Lifetime {
  store: Store
  fill: () => void
  start: () => Promise<void>
  closeTab: (id: string) => void
  pendingId: (sent: Record<string, unknown>) => string
}
type Closers = { getState: () => Record<string, (id: string) => void> }
const lifetimeOf = (store: Store, url: string): Lifetime => ({
  store,
  fill: () => store.getState().setUrl(url),
  start: () => store.getState().connect(),
  closeTab: (id) => (store as unknown as Closers).getState().removeTabState(id),
  pendingId: (sent) => sent._pendingId as string,
})
const LIFETIMES: Array<[string, Lifetime]> = [
  ['WebSocket', lifetimeOf(useWebSocketStore as unknown as Store, 'ws://server.test/x')],
  ['Socket.IO', lifetimeOf(useSocketIOStore as unknown as Store, 'http://server.test')],
  ['MQTT', lifetimeOf(useMqttStore as unknown as Store, 'mqtt://server.test')],
  ['SSE', lifetimeOf(useSseStore as unknown as Store, 'http://server.test/s')],
  [
    'GraphQL subscription',
    {
      store: useGraphQLStore as unknown as Store,
      fill: () =>
        useGraphQLStore.setState({ url: 'ws://server.test/g', query: 'subscription { t }' }),
      start: () => useGraphQLStore.getState().subscribe(),
      closeTab: (id) => useGraphQLStore.getState().removeTabState(id),
      pendingId: (sent) => sent.connectionId as string,
    },
  ],
]

const custom = (host: string): ProxySetting => ({
  mode: 'custom',
  host,
  port: 8080,
  bypass: 'localhost',
  auth: { username: 'u', password: 'p' },
})

beforeEach(() => {
  connect.mockClear()
  cancelConnect.mockClear()
  settingsGet.mockClear()
  settings = {}
  holdSettings = null
  ;(window as unknown as { api: unknown }).api = {
    ws: bridge(),
    socketio: bridge(),
    mqtt: bridge(),
    sse: bridge(),
    graphqlWs: bridge(),
    settings: { get: settingsGet },
  }
  useEnvironmentStore.setState({ getActiveVariables: () => ({}) })
  useWorkspaceStore.setState({ activeProjectId: 'p', activeWorkspaceId: 'w' } as never)
  useTabsStore.setState({ tabs: [], activeTabId: null })
})

describe.each(STORES)('%s', (_name, store, url) => {
  const s = () => store.getState()
  beforeEach(() => {
    store.setState({ _tabStates: new Map(), _currentTabId: null })
    s().switchToTab('t1')
    s().setUrl(url)
  })

  const sentProxy = () => connect.mock.calls[0][0].proxy

  it('the project proxy wins over the app proxy', async () => {
    settings['project.p.settings'] = { proxy: custom('project.test') }
    settings.proxy = custom('app.test')
    await s().connect()
    expect(sentProxy()).toEqual(custom('project.test'))
  })

  it('the app proxy applies when the project holds the old `system` default', async () => {
    settings['project.p.settings'] = { proxy: { mode: 'system' } }
    settings.proxy = custom('app.test')
    await s().connect()
    expect(sentProxy()).toEqual(custom('app.test'))
  })

  it('"No proxy" on the project reaches main', async () => {
    settings['project.p.settings'] = { proxy: { mode: 'none' } }
    settings.proxy = custom('app.test')
    await s().connect()
    expect(sentProxy()).toEqual({ mode: 'none' })
  })

  it('nothing configured sends no proxy key at all', async () => {
    await s().connect()
    expect(connect.mock.calls[0][0]).not.toHaveProperty('proxy')
  })

  it('Cancel while the settings load: the connection never starts', async () => {
    let release = (): void => {}
    holdSettings = new Promise((r) => (release = r))
    const connecting = s().connect()
    await vi.waitFor(() => expect(settingsGet).toHaveBeenCalled())
    await s().disconnect()
    release()
    await connecting
    expect(connect).not.toHaveBeenCalled()
    expect(s().connectionState).toBe('disconnected')
  })

  it('leaving the tab while the settings load: it starts, for its own tab', async () => {
    settings['project.p.settings'] = { proxy: custom('project.test') }
    let release = (): void => {}
    holdSettings = new Promise((r) => (release = r))
    const connecting = s().connect()
    await vi.waitFor(() => expect(settingsGet).toHaveBeenCalled())

    s().switchToTab('t2')
    release()
    await connecting
    expect(sentProxy()).toEqual(custom('project.test'))
    expect(s().connectionState).toBe('disconnected')

    s().switchToTab('t1')
    expect(s().connectionState).not.toBe('disconnected')
  })
})

/**
 * The realtime-connections.ts rules while the proxy keeps a connect unanswered: the
 * main side of the Cancel this asks for is `realtime-proxy.test.ts`.
 */
describe.each(LIFETIMES)('%s: giving up while the proxy has not answered', (_n, l) => {
  let answer: (v: unknown) => void
  beforeEach(() => {
    connect.mockImplementationOnce(
      () =>
        new Promise((r) => {
          answer = r as (v: unknown) => void
        }) as never,
    )
    l.store.setState({ _tabStates: new Map(), _currentTabId: null })
    l.store.getState().switchToTab('t1')
    l.fill()
  })

  const started = async (): Promise<string> => {
    void l.start()
    await vi.waitFor(() => expect(connect).toHaveBeenCalled())
    return l.pendingId(connect.mock.calls[0][0])
  }

  it('closing its tab cancels the connect', async () => {
    const id = await started()
    expect(cancelConnect).not.toHaveBeenCalled()
    l.closeTab('t1')
    expect(cancelConnect).toHaveBeenCalledWith(id)
    answer({ success: false, error: 'cancelled' })
  })

  it('closing its tab from another tab cancels the connect too', async () => {
    const id = await started()
    l.store.getState().switchToTab('t2')
    l.closeTab('t1')
    expect(cancelConnect).toHaveBeenCalledWith(id)
    answer({ success: false, error: 'cancelled' })
  })

  it('leaving its project cancels the connect', async () => {
    const id = await started()
    useWorkspaceStore.setState({ activeProjectId: 'other' } as never)
    expect(cancelConnect).toHaveBeenCalledWith(id)
    useWorkspaceStore.setState({ activeProjectId: 'p' } as never)
    answer({ success: false, error: 'cancelled' })
  })

  it('leaving its project while the settings load: it never starts', async () => {
    connect.mockReset()
    connect.mockImplementation(async () => ({ success: true, data: { connectionId: 'c1' } }))
    let release = (): void => {}
    holdSettings = new Promise((r) => (release = r))
    const running = l.start()
    await vi.waitFor(() => expect(settingsGet).toHaveBeenCalled())
    useWorkspaceStore.setState({ activeProjectId: 'other' } as never)
    release()
    await running
    expect(connect).not.toHaveBeenCalled()
    useWorkspaceStore.setState({ activeProjectId: 'p' } as never)
  })
})

describe('the failure as the app words it', () => {
  it.each([
    ['en', /Proxy connection failed/, /proxy host/],
    ['tr', /Proxy bağlantısı kurulamadı/, /proxy host/],
  ] as const)('%s', (locale, what, hint) => {
    setLocale(locale)
    const text = describeConnectionError({
      kind: 'proxy',
      target: '127.0.0.1:3128',
      message: '',
    } as ConnectionErrorInfo)
    expect(text).toMatch(what)
    expect(text).toMatch(hint)
    expect(text).toContain('127.0.0.1:3128')
    setLocale('en')
  })
})
