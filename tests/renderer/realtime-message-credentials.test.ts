/**
 * Issue #284 audit (security) — a credential typed into a realtime message
 * body never reaches localStorage.
 *
 * The MQTT will payload, the composer drafts of MQTT / WebSocket / Socket.IO,
 * their saved messages, Socket.IO emit arguments and MQTT message user
 * properties were persisted as typed: `{"password":"…"}` in a will payload
 * sat in the `testnizer-mqtt` snapshot in clear text. They now follow the
 * HTTP JSON body rule (#247) through the one mechanism
 * (`lib/credential-withhold.ts` `texts` / `rows`, list items included):
 * credential-named string members of JSON-looking text are blanked in the
 * snapshot, the rest of the text and `{{var}}`-only values stay, and the saved
 * row keeps the value — Ctrl+S after a restart writes it back, and Publish /
 * Send / Emit after a restart reload it before going out.
 *
 * Fail-before: the canaries were in localStorage; Ctrl+S after a restart
 * wrote the (then unprotected) value only because it was never withheld.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Tab } from '../../src/renderer/types'

const toastMock = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  warning: vi.fn(),
}))
vi.mock('../../src/renderer/lib/toast', () => ({ toast: toastMock }))

vi.setConfig({ testTimeout: 30_000 })

const CANARY = 'CANARY-rt-msg-284'

type Row = Record<string, unknown>
type Call = { name: string; args: unknown[] }

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
            return Promise.resolve({ success: true, data: {} })
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
  const [tabs, ws, sio, mqtt, save, workspace, activate] = await Promise.all([
    import('../../src/renderer/stores/tabs.store'),
    import('../../src/renderer/stores/websocket.store'),
    import('../../src/renderer/stores/socketio.store'),
    import('../../src/renderer/stores/mqtt.store'),
    import('../../src/renderer/lib/save-active-request'),
    import('../../src/renderer/stores/workspace.store'),
    import('../../src/renderer/lib/activate-tab'),
  ])
  workspace.useWorkspaceStore.setState({ refreshTree: async () => {} } as never)
  return {
    useTabsStore: tabs.useTabsStore,
    useWebSocketStore: ws.useWebSocketStore,
    useSocketIOStore: sio.useSocketIOStore,
    useMqttStore: mqtt.useMqttStore,
    saveActiveRequestInPlace: save.saveActiveRequestInPlace,
    activateTabStores: activate.activateTabStores,
  }
}
type App = Awaited<ReturnType<typeof launch>>

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

function allStorage(): string {
  const out: string[] = []
  for (let i = 0; i < window.localStorage.length; i++) {
    const k = window.localStorage.key(i)
    if (k) out.push(`${k}=${window.localStorage.getItem(k) ?? ''}`)
  }
  return out.join('\n')
}

const secretBody = (tag: string) =>
  `{\n  "user": "alice-${tag}",\n  "password": "${CANARY}-${tag}",\n  "n": {{count}}\n}`

let api: ReturnType<typeof installApi>

beforeEach(() => {
  vi.clearAllMocks()
  window.localStorage.clear()
  api = installApi()
})

// ─── Per protocol ───────────────────────────────────────────────────────

interface Case {
  protocol: Tab['protocol']
  /** Session 1: type credentials into every message body field. */
  setup: (app: App) => void
  /** Text that must stay in the snapshot (non-credential, `{{var}}`). */
  kept: string[]
  /** Session 2: make the path sendable, then publish / send / emit. */
  send: (app: App) => Promise<unknown>
  engine: string
  /** The tags whose canary the engine call must carry. */
  sentTags: string[]
}

const CASES: Case[] = [
  {
    protocol: 'mqtt',
    setup: (app) => {
      const s = app.useMqttStore.getState()
      s.setUrl('mqtt://broker.test:1883')
      s.setLastWill({ topic: 'will/t', payload: secretBody('will') })
      s.setComposer({ topic: 'a/b', content: secretBody('composer') })
      s.setComposerProperties({
        userProperties: [
          { id: 'up1', key: 'x-api-key', value: `${CANARY}-prop`, enabled: true },
          { id: 'up2', key: 'trace', value: 'trace-visible', enabled: true },
        ],
      })
      s.saveCurrentMessage('Saved one')
      // The composer moves on; the saved message keeps its own body.
      s.setComposer({ content: secretBody('composer') })
      app.useMqttStore.setState({
        savedMessages: app.useMqttStore
          .getState()
          .savedMessages.map((m) => ({ ...m, content: secretBody('saved') })),
      })
    },
    kept: [
      'alice-will',
      'alice-composer',
      'alice-saved',
      '{{count}}',
      'trace-visible',
      'x-api-key',
    ],
    send: async (app) => {
      app.useMqttStore.setState({ connectionId: 'c1', connectionState: 'connected' })
      await app.useMqttStore.getState().publish()
    },
    engine: 'mqtt.publish',
    sentTags: ['composer', 'prop'],
  },
  {
    protocol: 'websocket',
    setup: (app) => {
      const s = app.useWebSocketStore.getState()
      s.setUrl('wss://ws.test/live')
      s.setComposerContent(secretBody('saved'))
      s.saveCurrentMessage('Saved one')
      s.setComposerContent(secretBody('composer'))
    },
    kept: ['alice-composer', 'alice-saved', '{{count}}'],
    send: async (app) => {
      app.useWebSocketStore.setState({ connectionId: 'c1', connectionState: 'connected' })
      await app.useWebSocketStore.getState().sendMessage()
    },
    engine: 'ws.send',
    sentTags: ['composer'],
  },
  {
    protocol: 'socketio',
    setup: (app) => {
      const s = app.useSocketIOStore.getState()
      s.setUrl('http://sio.test')
      app.useSocketIOStore.setState({
        emitArgs: [
          { id: 'a1', content: secretBody('saved'), contentType: 'json' },
          { id: 'a2', content: 'plain text arg', contentType: 'text' },
        ],
      })
      s.saveCurrentMessage()
      app.useSocketIOStore.setState({
        emitArgs: [
          { id: 'a1', content: secretBody('composer'), contentType: 'json' },
          { id: 'a2', content: 'plain text arg', contentType: 'text' },
        ],
      })
    },
    kept: ['alice-composer', 'alice-saved', '{{count}}', 'plain text arg'],
    send: async (app) => {
      app.useSocketIOStore.setState({ connectionId: 'c1', connectionState: 'connected' })
      await app.useSocketIOStore.getState().emit()
    },
    engine: 'socketio.emitArgs',
    sentTags: ['composer'],
  },
]

describe('realtime message bodies: credentials never reach localStorage (issue #284 audit)', () => {
  for (const c of CASES) {
    it(`${c.protocol}: canaries withheld, the rest of the text kept`, async () => {
      const s1 = await launch()
      openTab(s1, c.protocol)
      c.setup(s1)
      const stored = allStorage()
      expect(stored).not.toContain(CANARY)
      for (const k of c.kept) expect(stored).toContain(k)
      // The live state still holds the value — only the snapshot withholds it.
      const live = JSON.stringify(
        c.protocol === 'mqtt'
          ? s1.useMqttStore.getState()
          : c.protocol === 'websocket'
            ? s1.useWebSocketStore.getState()
            : s1.useSocketIOStore.getState(),
      )
      expect(live).toContain(`${CANARY}-composer`)
      expect(live).toContain(`${CANARY}-saved`)
    })

    it(`${c.protocol}: Ctrl+S after a restart (persisted twice first) keeps the values on the row`, async () => {
      const s1 = await launch()
      openTab(s1, c.protocol)
      c.setup(s1)
      expect(await s1.saveActiveRequestInPlace()).toEqual({ success: true })

      const s2 = await launch()
      openTab(s2, c.protocol)
      // Two snapshot writes before any reload (an unrelated edit, then a
      // re-activation): the markers must survive both.
      if (c.protocol === 'mqtt') s2.useMqttStore.getState().setClientId('cid-2')
      else if (c.protocol === 'websocket') s2.useWebSocketStore.getState().setUrl('wss://ws.test/2')
      else s2.useSocketIOStore.getState().setUrl('http://sio.test/2')
      s2.activateTabStores('tab-x')
      expect(allStorage()).not.toContain(CANARY)
      expect(await s2.saveActiveRequestInPlace()).toEqual({ success: true })
      const row = JSON.stringify(await api.endpoint.get('ep-1'))
      expect(row).toContain(`${CANARY}-composer`)
      expect(row).toContain(`${CANARY}-saved`)
      if (c.protocol === 'mqtt') {
        expect(row).toContain(`${CANARY}-will`)
        expect(row).toContain(`${CANARY}-prop`)
      }
    })

    it(`${c.protocol}: sending right after a restart reloads the withheld body first`, async () => {
      const s1 = await launch()
      openTab(s1, c.protocol)
      c.setup(s1)
      expect(await s1.saveActiveRequestInPlace()).toEqual({ success: true })

      const s2 = await launch()
      api.calls.length = 0
      await c.send(s2)
      const sent = api.calls.filter((x) => x.name === c.engine)
      expect(sent.length).toBeGreaterThan(0)
      const text = JSON.stringify(sent.map((x) => x.args))
      for (const tag of c.sentTags) expect(text).toContain(`${CANARY}-${tag}`)
      expect(toastMock.warning).not.toHaveBeenCalled()
    })
  }

  it('a non-JSON body is stored as typed; a `{{var}}`-only credential member stays', async () => {
    const s1 = await launch()
    openTab(s1, 'mqtt')
    s1.useMqttStore.getState().setComposer({ content: 'hello world, nothing secret' })
    s1.useMqttStore.getState().setLastWill({ payload: '{"password": "{{willPw}}"}' })
    const stored = allStorage()
    expect(stored).toContain('hello world, nothing secret')
    expect(stored).toContain('{{willPw}}')
    expect(s1.useMqttStore.getState().withheldCredentials).toEqual([])
  })
})

describe('list item paths in a CredentialSpec (issue #284 audit)', () => {
  it('withholds per item, keeps the marker across writes, restores by id then by position', async () => {
    const { withholdCredentials, restoreWithheld } =
      await import('../../src/renderer/lib/credential-withhold')
    const { messageCredentialText } = await import('../../src/renderer/lib/credential-text')
    const spec = { fields: [], rows: [], texts: [messageCredentialText('items[].args[].content')] }
    const st = {
      withheldCredentials: [] as string[],
      items: [
        { id: 'm1', args: [{ id: 'a1', content: `{"token":"${CANARY}-1"}` }] },
        { id: 'm2', args: [{ id: 'a2', content: 'plain' }] },
      ],
    }
    const once = withholdCredentials(st, spec)
    const twice = withholdCredentials(once, spec)
    expect(JSON.stringify(twice)).not.toContain(CANARY)
    expect(twice.withheldCredentials).toEqual(['items[m1].args[a1].content'])
    // The saved row's items carry other ids (an older writer): matched by position.
    const source = {
      items: [
        { id: 'x1', args: [{ id: 'y1', content: `{"token":"${CANARY}-1"}` }] },
        { id: 'x2', args: [{ id: 'y2', content: 'plain' }] },
      ],
    }
    const patch = restoreWithheld(twice, source, spec)
    expect(patch.withheldCredentials).toEqual([])
    expect(JSON.stringify(patch.items)).toContain(`${CANARY}-1`)
    expect(JSON.stringify(patch.items)).toContain('"id":"m1"')
  })
})

// ─── Copies inside the tab before the reload (#259 data-loss class) ──────

/** The protocol block of the saved row. */
async function savedMeta(protocol: Tab['protocol']): Promise<Record<string, unknown>> {
  const res = (await api.endpoint.get('ep-1')) as { data: { request_schema: string } }
  const schema = JSON.parse(res.data.request_schema) as { metadata: Record<string, unknown> }
  return schema.metadata[protocol as string] as Record<string, unknown>
}

type MsgStore = {
  getState: () => {
    savedMessages: Array<{ id: string }>
    loadSavedMessage: (id: string) => void | Promise<void>
    saveCurrentMessage: (name?: string) => void | Promise<void>
  }
}
const msgStore = (app: App, protocol: Tab['protocol']): MsgStore =>
  (protocol === 'mqtt'
    ? app.useMqttStore
    : protocol === 'websocket'
      ? app.useWebSocketStore
      : app.useSocketIOStore) as unknown as MsgStore

/** Where each protocol keeps the composer in its saved block. */
const composerOf = (protocol: Tab['protocol'], meta: Record<string, unknown>): string =>
  JSON.stringify(
    protocol === 'mqtt'
      ? (meta.composer as { content: string }).content
      : protocol === 'websocket'
        ? meta.composerContent
        : meta.emitArgs,
  )

describe('a message copied before the restart reload never saves a blank (issue #284 audit)', () => {
  for (const c of CASES) {
    it(`${c.protocol}: Load saved message right after a restart, then Ctrl+S → the row keeps the value`, async () => {
      const s1 = await launch()
      openTab(s1, c.protocol)
      c.setup(s1)
      expect(await s1.saveActiveRequestInPlace()).toEqual({ success: true })

      const s2 = await launch()
      openTab(s2, c.protocol)
      const store = msgStore(s2, c.protocol)
      const savedId = store.getState().savedMessages[0].id
      // No activation reload yet: the saved message body is still blank here.
      await store.getState().loadSavedMessage(savedId)
      expect(await s2.saveActiveRequestInPlace()).toEqual({ success: true })
      const meta = await savedMeta(c.protocol)
      expect(composerOf(c.protocol, meta)).toContain(`${CANARY}-saved`)
      expect(JSON.stringify(meta.savedMessages)).toContain(`${CANARY}-saved`)
    })

    it(`${c.protocol}: Save the composer as a message right after a restart, then Ctrl+S → no blank copy`, async () => {
      const s1 = await launch()
      openTab(s1, c.protocol)
      c.setup(s1)
      expect(await s1.saveActiveRequestInPlace()).toEqual({ success: true })

      const s2 = await launch()
      openTab(s2, c.protocol)
      const store = msgStore(s2, c.protocol)
      await store.getState().saveCurrentMessage('Copy')
      expect(await s2.saveActiveRequestInPlace()).toEqual({ success: true })
      const meta = await savedMeta(c.protocol)
      expect(composerOf(c.protocol, meta)).toContain(`${CANARY}-composer`)
      // The composer went into a saved message: with its value, not a blank.
      expect(JSON.stringify(meta.savedMessages)).toContain(`${CANARY}-composer`)
    })
  }
})
