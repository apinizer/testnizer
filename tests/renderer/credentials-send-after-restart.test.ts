/**
 * Issue #244 — Send / Connect right after a restart never ship a withheld
 * credential.
 *
 * After a restart a saved request's literal credentials are blank (the tab
 * snapshot never holds them) until the Workbench's background reload has read
 * them back from the row. A Send / Connect pressed before that reload finished
 * used to go out with the empty fields — a 401 the user cannot explain. Every
 * send path whose slice still carries a withheld marker now awaits the reload
 * first (`lib/withheld-before-send.ts`).
 *
 * Pinned per path: save with the credential → restart (modules re-imported,
 * stores rehydrate from localStorage) → Send / Connect at once, with no
 * activation reload → the payload handed to the engine carries the
 * credential. An unreadable row does not block the send, and a warning says
 * the fields go out empty.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { KeyValuePair, Tab } from '../../src/renderer/types'

// One object for every module graph `launch()` builds.
const toastMock = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  warning: vi.fn(),
}))
vi.mock('../../src/renderer/lib/toast', () => ({ toast: toastMock }))

// Each test re-imports the whole store graph (`vi.resetModules`) — the first
// cold import can pass vitest's 5 s default when the suite runs in parallel.
vi.setConfig({ testTimeout: 30_000 })

const SECRET = 'LITERAL-send-244-e5'

type Row = Record<string, unknown>
type Call = { name: string; args: unknown[] }

/**
 * Real row IPC (endpoint) + a recording stub for every engine namespace: a
 * call is recorded and answered `{ success: false }`; `on*` subscriptions
 * return an unsubscribe function.
 */
function installApi() {
  const endpoints = new Map<string, Row>()
  const calls: Call[] = []
  const endpoint = {
    update: vi.fn(async (id: string, patch: Row) => {
      endpoints.set(id, { ...endpoints.get(id), ...patch })
      return { success: true, data: true }
    }),
    get: vi.fn(async (id: string) => ({ success: true, data: endpoints.get(id) ?? null })),
  }
  const ns = (name: string) =>
    new Proxy(
      {},
      {
        get: (_t, method: string) => {
          if (method.startsWith('on')) return () => () => {}
          return (...args: unknown[]) => {
            calls.push({ name: `${name}.${method}`, args })
            return Promise.resolve({ success: false, error: 'stub' })
          }
        },
      },
    )
  const api = new Proxy({ endpoint } as Record<string, unknown>, {
    get: (target, key: string) => (key in target ? target[key] : (target[key] = ns(key))),
  })
  ;(window as unknown as { api: unknown }).api = api
  return { endpoint, calls }
}

async function launch() {
  vi.resetModules()
  const [tabs, req, mcp, ws, sse, sio, gql, grpc, save, wsStore, activate, soap] =
    await Promise.all([
      import('../../src/renderer/stores/tabs.store'),
      import('../../src/renderer/stores/request.store'),
      import('../../src/renderer/stores/mcp.store'),
      import('../../src/renderer/stores/websocket.store'),
      import('../../src/renderer/stores/sse.store'),
      import('../../src/renderer/stores/socketio.store'),
      import('../../src/renderer/stores/graphql.store'),
      import('../../src/renderer/stores/grpc.store'),
      import('../../src/renderer/lib/save-active-request'),
      import('../../src/renderer/stores/workspace.store'),
      import('../../src/renderer/lib/activate-tab'),
      import('../../src/renderer/stores/soap.store'),
    ])
  wsStore.useWorkspaceStore.setState({ refreshTree: async () => {} } as never)
  return {
    useTabsStore: tabs.useTabsStore,
    useRequestStore: req.useRequestStore,
    useMcpStore: mcp.useMcpStore,
    useWebSocketStore: ws.useWebSocketStore,
    useSseStore: sse.useSseStore,
    useSocketIOStore: sio.useSocketIOStore,
    useGraphQLStore: gql.useGraphQLStore,
    useGrpcStore: grpc.useGrpcStore,
    useSoapStore: soap.useSoapStore,
    saveActiveRequestInPlace: save.saveActiveRequestInPlace,
    activateTabStores: activate.activateTabStores,
  }
}
type App = Awaited<ReturnType<typeof launch>>

const kv = (id: string, key: string, value: string): KeyValuePair => ({
  id,
  key,
  value,
  enabled: true,
})

function openTab(app: App, protocol: Tab['protocol']) {
  app.useTabsStore.setState({
    tabs: [
      {
        id: 'tab-x',
        name: 'X',
        protocol,
        method: 'GET',
        url: '',
        isDirty: false,
        endpointId: 'ep-1',
      } as Tab,
    ],
    activeTabId: 'tab-x',
  })
  app.activateTabStores('tab-x')
}

const CASES: Array<{
  protocol: Tab['protocol']
  /** Test title when one protocol has several cases. */
  label?: string
  /** Session 1: type the credential (and what the path needs to run). */
  setup: (app: App) => void
  /** Session 2: fill what the snapshot does not keep, then Send / Connect. */
  send: (app: App) => Promise<unknown>
  /** The engine call that carries the credential. */
  engine: string
}> = [
  {
    protocol: 'http',
    setup: (app) => {
      app.useRequestStore.getState().setUrl('https://api.test/a')
      app.useRequestStore.getState().setAuth({ type: 'bearer', bearer: { token: SECRET } })
    },
    send: (app) => app.useRequestStore.getState().sendRequest(),
    engine: 'request.send',
  },
  {
    protocol: 'websocket',
    setup: (app) => {
      app.useWebSocketStore.getState().setUrl('wss://ws.test')
      app.useWebSocketStore.getState().setHeaders([kv('w1', 'Authorization', `Bearer ${SECRET}`)])
    },
    send: (app) => app.useWebSocketStore.getState().connect(),
    engine: 'ws.connect',
  },
  {
    protocol: 'sse',
    setup: (app) => {
      app.useSseStore.getState().setUrl('https://sse.test/stream')
      app.useSseStore.getState().setHeaders([kv('s1', 'X-Api-Token', SECRET)])
    },
    send: (app) => app.useSseStore.getState().connect(),
    engine: 'sse.connect',
  },
  {
    protocol: 'socketio',
    setup: (app) => {
      app.useSocketIOStore.getState().setUrl('http://sio.test')
      app.useSocketIOStore.getState().setBearerToken(SECRET)
    },
    send: (app) => app.useSocketIOStore.getState().connect(),
    engine: 'socketio.connect',
  },
  {
    // Issue #283: handshake headers and query params are withheld rows too.
    protocol: 'socketio',
    label: 'socketio headers + params',
    setup: (app) => {
      app.useSocketIOStore.getState().setUrl(`http://sio.test?token=${SECRET}-p`)
      app.useSocketIOStore.getState().setHeaders([kv('h1', 'Authorization', `Bearer ${SECRET}`)])
    },
    send: (app) => app.useSocketIOStore.getState().connect(),
    engine: 'socketio.connect',
  },
  {
    // Issue #282: query params of a WebSocket URL.
    protocol: 'websocket',
    label: 'websocket params',
    setup: (app) => {
      app.useWebSocketStore.getState().setUrl(`wss://ws.test/live?api_key=${SECRET}`)
    },
    send: (app) => app.useWebSocketStore.getState().connect(),
    engine: 'ws.connect',
  },
  {
    protocol: 'graphql',
    setup: (app) => {
      app.useGraphQLStore.getState().setUrl('https://gql.test/graphql')
      app.useGraphQLStore.getState().setQuery('{ me { id } }')
      app.useGraphQLStore.getState().setHeaders([kv('g1', 'Authorization', `Bearer ${SECRET}`)])
    },
    send: (app) => app.useGraphQLStore.getState().executeQuery(),
    engine: 'request.send',
  },
  {
    protocol: 'grpc',
    setup: (app) => {
      app.useGrpcStore.getState().setAddress('grpc.test:443')
      app.useGrpcStore.setState({ metadata: [kv('m1', 'authorization', `Bearer ${SECRET}`)] })
    },
    send: (app) => {
      app.useGrpcStore.setState({
        selectedService: 'S',
        selectedMethod: 'M',
        services: [{ name: 'S', methods: [{ name: 'M', type: 'unary' }] }],
      } as never)
      return app.useGrpcStore.getState().execute()
    },
    engine: 'grpc.',
  },
  {
    // Issue #298 follow-up: the SOAP editor's Auth tab is the request store's,
    // and SOAP Send now sends it — so it awaits the request store's reload too.
    protocol: 'soap',
    label: 'soap Auth tab',
    setup: (app) => {
      app.useSoapStore.setState({ mode: 'manual', endpointUrl: 'https://soap.test/svc' })
      app.useSoapStore.getState().setRawXml('<soapenv:Envelope/>')
      app.useRequestStore.getState().setAuth({ type: 'bearer', bearer: { token: SECRET } })
    },
    send: (app) => app.useSoapStore.getState().sendSoap(),
    engine: 'request.send',
  },
  {
    // …and its Headers tab (a withheld credential header row) is sent too.
    protocol: 'soap',
    label: 'soap Headers tab',
    setup: (app) => {
      app.useSoapStore.setState({ mode: 'manual', endpointUrl: 'https://soap.test/svc' })
      app.useSoapStore.getState().setRawXml('<soapenv:Envelope/>')
      app.useRequestStore.getState().setHeaders([kv('sh1', 'X-Api-Key', SECRET)])
    },
    send: (app) => app.useSoapStore.getState().sendSoap(),
    engine: 'request.send',
  },
  {
    protocol: 'mcp',
    setup: (app) => {
      app.useMcpStore.getState().setUrl('https://mcp.test/mcp')
      app.useMcpStore.getState().setAuth({ type: 'bearer', bearer: { token: SECRET } })
    },
    send: (app) => app.useMcpStore.getState().connect(),
    engine: 'mcp.connect',
  },
]

/** Every localStorage value. */
function allStorage(): string {
  const out: string[] = []
  for (let i = 0; i < window.localStorage.length; i++) {
    const k = window.localStorage.key(i)
    if (k) out.push(`${k}=${window.localStorage.getItem(k) ?? ''}`)
  }
  return out.join('\n')
}

let api: ReturnType<typeof installApi>

beforeEach(() => {
  vi.clearAllMocks()
  window.localStorage.clear()
  api = installApi()
})

async function saveAndRestart(c: (typeof CASES)[number]): Promise<App> {
  const s1 = await launch()
  openTab(s1, c.protocol)
  c.setup(s1)
  expect(await s1.saveActiveRequestInPlace()).toEqual({ success: true })
  expect(allStorage()).not.toContain(SECRET)
  const s2 = await launch()
  api.calls.length = 0
  return s2
}

const engineCalls = (prefix: string) => api.calls.filter((c) => c.name.startsWith(prefix))

describe('Send / Connect right after a restart carry the saved credential (issue #244)', () => {
  for (const c of CASES) {
    it(`${c.label ?? c.protocol}: the engine gets the credential, no activation reload needed`, async () => {
      const s2 = await saveAndRestart(c)
      await c.send(s2)
      const sent = engineCalls(c.engine)
      expect(sent.length).toBeGreaterThan(0)
      expect(JSON.stringify(sent.map((x) => x.args))).toContain(SECRET)
      expect(toastMock.warning).not.toHaveBeenCalled()
    })
  }

  it('socketio headers + params: Ctrl+S right after a restart keeps them on the row', async () => {
    const c = CASES.find((x) => x.label === 'socketio headers + params')!
    const s2 = await saveAndRestart(c)
    openTab(s2, 'socketio')
    expect(await s2.saveActiveRequestInPlace()).toEqual({ success: true })
    const saved = JSON.stringify(await api.endpoint.get('ep-1'))
    expect(saved).toContain(`Bearer ${SECRET}`)
    expect(saved).toContain(`token=${SECRET}-p`)
  })

  it('an unreadable row does not block the send — it warns that the fields go out empty', async () => {
    const s2 = await saveAndRestart(CASES[0])
    api.endpoint.get.mockResolvedValueOnce({ success: false } as never)
    await s2.useRequestStore.getState().sendRequest()
    const sent = engineCalls('request.send')
    expect(sent).toHaveLength(1)
    expect(JSON.stringify(sent[0].args)).not.toContain(SECRET)
    expect(toastMock.warning).toHaveBeenCalledTimes(1)
    expect(String(toastMock.warning.mock.calls[0][0])).toMatch(/could not be reloaded/)
  })
})
