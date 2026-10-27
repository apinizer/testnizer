/**
 * Issue #284 audit (P3) — Duplicate Tab copies the protocol's own editor
 * state, not just the request store.
 *
 * `handleDuplicateTab` only called `useRequestStore.cloneTabState`: an MQTT /
 * WebSocket / Socket.IO / SSE / gRPC / GraphQL / SOAP / MCP tab duplicated
 * with an empty protocol slice (the broker URL, topics, composer… gone). And a
 * BOUND duplicate (opened from its new row first, so already the current
 * tab) lost even the request-store copy: it went to the cache, and the next
 * switch saved the live slice over it.
 *
 * Now `cloneTabStores` (lib/activate-tab.ts) copies the request store and the
 * tab protocol's store through one helper (`lib/tab-clone.ts`), onto the live
 * slice when the destination is current. Connection / runtime state is not
 * copied: the duplicate starts disconnected and the source's connection is
 * untouched.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Tab } from '../../src/renderer/types'

vi.setConfig({ testTimeout: 30_000 })

async function launch() {
  vi.resetModules()
  ;(window as unknown as { api: unknown }).api = {}
  const [tabs, req, activate, mqtt, ws, sio, sse, grpc, gql, soap, mcp] = await Promise.all([
    import('../../src/renderer/stores/tabs.store'),
    import('../../src/renderer/stores/request.store'),
    import('../../src/renderer/lib/activate-tab'),
    import('../../src/renderer/stores/mqtt.store'),
    import('../../src/renderer/stores/websocket.store'),
    import('../../src/renderer/stores/socketio.store'),
    import('../../src/renderer/stores/sse.store'),
    import('../../src/renderer/stores/grpc.store'),
    import('../../src/renderer/stores/graphql.store'),
    import('../../src/renderer/stores/soap.store'),
    import('../../src/renderer/stores/mcp.store'),
  ])
  return {
    useTabsStore: tabs.useTabsStore,
    useRequestStore: req.useRequestStore,
    activateTabStores: activate.activateTabStores,
    cloneTabStores: activate.cloneTabStores,
    stores: {
      mqtt: mqtt.useMqttStore,
      websocket: ws.useWebSocketStore,
      socketio: sio.useSocketIOStore,
      sse: sse.useSseStore,
      grpc: grpc.useGrpcStore,
      graphql: gql.useGraphQLStore,
      soap: soap.useSoapStore,
      mcp: mcp.useMcpStore,
    },
  }
}
type App = Awaited<ReturnType<typeof launch>>
type ProtocolKey = keyof App['stores']

interface Store {
  getState: () => Record<string, unknown>
  setState: (patch: Record<string, unknown>) => void
}
const storeOf = (app: App, p: ProtocolKey) => app.stores[p] as unknown as Store

/** Per protocol: an unsaved edit (field → value) and the live connection fields. */
const CASES: Array<{
  protocol: ProtocolKey
  edit: Record<string, unknown>
  live: Record<string, unknown>
  idle: Record<string, unknown>
}> = [
  {
    protocol: 'mqtt',
    edit: { url: 'mqtt://edited.test:1883', clientId: 'cid-edit' },
    live: { connectionId: 'c-src', connectionState: 'connected' },
    idle: { connectionId: null, connectionState: 'disconnected', log: [] },
  },
  {
    protocol: 'websocket',
    edit: { url: 'wss://edited.test/ws', composerContent: '{"edited":true}' },
    live: { connectionId: 'c-src', connectionState: 'connected' },
    idle: { connectionId: null, connectionState: 'disconnected', messages: [] },
  },
  {
    protocol: 'socketio',
    edit: { url: 'http://edited.test', namespace: '/edited' },
    live: { connectionId: 'c-src', connectionState: 'connected' },
    idle: { connectionId: null, connectionState: 'disconnected', events: [] },
  },
  {
    protocol: 'sse',
    edit: { url: 'https://edited.test/stream' },
    live: { connectionId: 'c-src', connectionState: 'connected' },
    idle: { connectionId: null, connectionState: 'disconnected', events: [] },
  },
  {
    protocol: 'grpc',
    edit: { address: 'edited.test:443' },
    live: { activeStreamId: 's-src', isStreaming: true },
    idle: { activeStreamId: null, isStreaming: false },
  },
  {
    protocol: 'graphql',
    edit: { url: 'https://edited.test/graphql', query: '{ edited }' },
    live: { isLoading: true },
    idle: { isLoading: false },
  },
  {
    protocol: 'soap',
    edit: { wsdlUrl: 'https://edited.test/svc?wsdl', manualSoapAction: 'urn:edited' },
    live: {},
    idle: {},
  },
  {
    protocol: 'mcp',
    edit: { url: 'https://edited.test/mcp' },
    live: { connectionId: 'c-src', connectionState: 'connected' },
    idle: { connectionId: null, connectionState: 'disconnected' },
  },
]

function openTabs(app: App, protocol: ProtocolKey, ids: string[]) {
  app.useTabsStore.setState({
    tabs: ids.map(
      (id) => ({ id, name: id, protocol, method: 'GET', url: '', isDirty: false }) as Tab,
    ),
    activeTabId: ids[0],
  })
}

let app: App
beforeEach(async () => {
  window.localStorage.clear()
  app = await launch()
})

describe('Duplicate Tab copies the protocol slice (issue #284 audit)', () => {
  for (const c of CASES) {
    it(`${c.protocol}: scratch duplicate (switched to after the copy)`, () => {
      openTabs(app, c.protocol, ['src', 'dup'])
      app.activateTabStores('src')
      const store = storeOf(app, c.protocol)
      store.setState({ ...c.edit, ...c.live })
      app.useRequestStore.getState().setUrl('https://request-edit.test')

      app.cloneTabStores('src', 'dup', c.protocol)
      app.activateTabStores('dup')

      expect(store.getState()).toMatchObject({ ...c.edit, ...c.idle })
      expect(app.useRequestStore.getState().url).toBe('https://request-edit.test')
      // The source keeps its edits and its live connection.
      app.activateTabStores('src')
      expect(store.getState()).toMatchObject({ ...c.edit, ...c.live })
    })

    it(`${c.protocol}: bound duplicate (already the current tab) keeps the copy across a switch`, () => {
      openTabs(app, c.protocol, ['src', 'dup', 'other'])
      app.activateTabStores('src')
      const store = storeOf(app, c.protocol)
      store.setState({ ...c.edit, ...c.live })
      app.useRequestStore.getState().setUrl('https://request-edit.test')
      // The bound path opens the new row first: every store is on `dup`.
      app.activateTabStores('dup')

      app.cloneTabStores('src', 'dup', c.protocol)
      expect(store.getState()).toMatchObject({ ...c.edit, ...c.idle })

      app.activateTabStores('other')
      app.activateTabStores('dup')
      expect(store.getState()).toMatchObject({ ...c.edit, ...c.idle })
      expect(app.useRequestStore.getState().url).toBe('https://request-edit.test')
    })
  }

  it('a dirty source makes the duplicate dirty, so a bound (preview) duplicate is not replaced by the next tree open', () => {
    // The bound path: the duplicate is opened from its new row as the preview tab.
    app.useTabsStore.setState({
      tabs: [
        {
          id: 'src',
          name: 'src',
          protocol: 'mqtt',
          method: 'GET',
          url: '',
          isDirty: true,
          endpointId: 'ep-src',
        } as Tab,
      ],
      activeTabId: 'src',
    })
    app.useTabsStore.getState().openPreviewTab({
      id: 'tab-ep-dup',
      name: 'src (copy)',
      protocol: 'mqtt',
      method: 'GET',
      url: '',
      endpointId: 'ep-dup',
    })
    app.cloneTabStores('src', 'tab-ep-dup', 'mqtt')
    const dup = () => app.useTabsStore.getState().tabs.find((t) => t.id === 'tab-ep-dup')
    expect(dup()?.isDirty).toBe(true)
    // A single click on another request reuses the preview slot — not this one.
    app.useTabsStore.getState().openPreviewTab({
      id: 'tab-ep-other',
      name: 'other',
      protocol: 'http',
      method: 'GET',
      url: '',
      endpointId: 'ep-other',
    })
    expect(dup()).toBeTruthy()
  })

  it('a clean source leaves the duplicate clean', () => {
    openTabs(app, 'mqtt', ['src', 'dup'])
    app.cloneTabStores('src', 'dup', 'mqtt')
    expect(app.useTabsStore.getState().tabs.find((t) => t.id === 'dup')?.isDirty).toBe(false)
  })

  it('the Workbench duplicates through cloneTabStores', () => {
    const src = readFileSync(
      resolve(__dirname, '../../src/renderer/components/layout/Workbench.tsx'),
      'utf8',
    )
    expect(src).not.toContain('useRequestStore.getState().cloneTabState(')
    expect(src.match(/cloneTabStores\(tabId, \w+, src\.protocol\)/g)).toHaveLength(2)
  })
})
