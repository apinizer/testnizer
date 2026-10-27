/**
 * Issue #284 — the MQTT request in the renderer: what Ctrl+S saves and a
 * reopen restores (one writer / reader, `mqttMetaOf` / `readMqttMeta`), what
 * a malformed or partial block opens as, what reaches Connect / Publish
 * (`{{var}}` resolved, the template kept for History), where events land
 * (the owning tab, issue #76), and what never reaches localStorage (the
 * password, credential-named user properties, URL userinfo) — with the
 * restart + Ctrl+S data-loss trap (issue #244) for a saved request.
 *
 * Fail-before: there was no MQTT store, snapshot branch or withheld spec.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useMqttStore } from '../../src/renderer/stores/mqtt.store'
import { useEnvironmentStore } from '../../src/renderer/stores/environment.store'
import { useTabsStore } from '../../src/renderer/stores/tabs.store'
import { useWorkspaceStore } from '../../src/renderer/stores/workspace.store'
import {
  restoreProtocolFromMetadata,
  snapshotProtocol,
} from '../../src/renderer/lib/save-active-request'
import { mqttMetaOf, readMqttMeta } from '../../src/renderer/lib/realtime-meta'
import { DEFAULT_MQTT_SETTINGS } from '../../src/shared/mqtt'
import type { Tab } from '../../src/renderer/types'

const PASSWORD = 'mqtt-LITERAL-pw-7f3a'
const KEY = 'testnizer-mqtt'

type Listener = (e: unknown) => void
const listeners = { event: new Set<Listener>(), closed: new Set<Listener>() }
const connect = vi.fn(async (_opts: Record<string, unknown>) => ({
  success: true,
  data: {
    connectionId: 'c1',
    clientId: 'cid',
    url: 'mqtt://b.test',
    sessionPresent: false,
    reasonCode: 0,
  },
}))
const publish = vi.fn(async () => ({ success: true, data: true }))
const subscribe = vi.fn(async () => ({ success: true, data: [] }))
const unsubscribe = vi.fn(async () => ({ success: true, data: true }))
const disconnect = vi.fn(async () => ({ success: true, data: true }))

function installApi(): void {
  ;(window as unknown as { api: unknown }).api = {
    mqtt: {
      connect,
      publish,
      subscribe,
      unsubscribe,
      disconnect,
      cancelConnect: vi.fn(async () => ({ success: true, data: { canceled: true } })),
      onEvent: (cb: Listener) => {
        listeners.event.add(cb)
        return () => listeners.event.delete(cb)
      },
      onClosed: (cb: Listener) => {
        listeners.closed.add(cb)
        return () => listeners.closed.delete(cb)
      },
    },
  }
}
const push = (kind: 'event' | 'closed', e: unknown): void => {
  for (const l of [...listeners[kind]]) l(e)
}

const mq = () => useMqttStore.getState()
const tab = (id: string): Tab => ({ id, protocol: 'mqtt' }) as unknown as Tab
function openTab(id: string): void {
  useTabsStore.setState({ tabs: [tab(id)], activeTabId: id })
}

beforeEach(() => {
  window.localStorage.clear()
  for (const f of [connect, publish, subscribe, unsubscribe, disconnect]) f.mockClear()
  listeners.event.clear()
  listeners.closed.clear()
  installApi()
  useEnvironmentStore.setState({
    getActiveVariables: () => ({ host: 'b.test', pw: 'from-env', room: 'r1' }),
  })
  useWorkspaceStore.setState({ activeProjectId: 'p1', activeWorkspaceId: 'w1' } as never)
  useTabsStore.setState({ tabs: [], activeTabId: null })
  useMqttStore.setState({ _tabStates: new Map(), _currentTabId: null })
  useMqttStore.getState().switchToTab('t-new')
})

function fillRequest(): void {
  const s = mq()
  s.setUrl('mqtt://{{host}}:1883')
  s.setClientId('dev-1')
  s.setVersion(5)
  s.setUsername('ann')
  s.setPassword('{{pw}}')
  s.setSettings({ keepAlive: 30, autoReconnect: true })
  s.setProperties({
    sessionExpiryInterval: 60,
    userProperties: [{ id: 'u1', key: 'tenant', value: 'acme', enabled: true }],
  })
  s.setLastWill({ topic: 'dev/{{room}}/status', payload: 'offline', retain: true, qos: 1 })
  s.setWillProperties({ willDelayInterval: 5 })
  s.addTopic()
  const id = mq().topics[0].id
  s.updateTopic(id, { name: 'dev/{{room}}/#', qos: 1, description: 'all', noLocal: true })
  s.setComposer({ topic: 'dev/{{room}}/cmd', content: '{"on":true}', contentType: 'json', qos: 2 })
  s.setComposerProperties({ contentType: 'application/json', correlationData: 'c-{{room}}' })
  s.saveCurrentMessage('Turn on')
}

describe('a new MQTT request', () => {
  it('defaults: MQTT 5, MQTT.js settings, empty client id (random at connect)', () => {
    expect(mq().version).toBe(5)
    expect(mq().clientId).toBe('')
    expect(mq().settings).toEqual(DEFAULT_MQTT_SETTINGS)
    expect(mq().topics).toEqual([])
  })
})

describe('save → reopen (one writer / reader)', () => {
  it('round-trips every request field through the endpoint metadata', () => {
    fillRequest()
    const meta = snapshotProtocol(tab('t-new')).protocolMeta
    expect(Object.keys(meta)).toEqual(['mqtt'])
    openTab('t-reopen')
    restoreProtocolFromMetadata('mqtt', JSON.parse(JSON.stringify(meta)))
    const r = mq()
    expect(r._currentTabId).toBe('t-reopen')
    expect(mqttMetaOf(r)).toEqual(JSON.parse(JSON.stringify(meta)).mqtt)
    expect(r.savedMessages).toHaveLength(1)
    expect(r.savedMessages[0]).toMatchObject({ name: 'Turn on', topic: 'dev/{{room}}/cmd', qos: 2 })
    expect(r.topics[0]).toMatchObject({ name: 'dev/{{room}}/#', noLocal: true, subscribe: true })
  })

  it('a partial or malformed block opens with defaults, never throws', () => {
    expect(readMqttMeta(null)).toEqual({})
    expect(readMqttMeta({ url: 'mqtt://x' })).toEqual({ url: 'mqtt://x' })
    const odd = readMqttMeta({
      version: 3,
      settings: 'nope',
      topics: [{ name: 't', qos: 9 }, 'junk'],
      composer: { contentType: 'yaml', qos: '1' },
      lastWill: 42,
      properties: { receiveMaximum: 0, userProperties: [{ key: 'k', value: 7 }] },
    })
    expect(odd.version).toBe(5)
    expect(odd.settings).toEqual(DEFAULT_MQTT_SETTINGS)
    expect(odd.topics).toHaveLength(1)
    expect(odd.topics?.[0]).toMatchObject({ name: 't', qos: 0, subscribe: true })
    expect(odd.composer).toMatchObject({ contentType: 'text', qos: 0 })
    expect(odd.lastWill?.topic).toBe('')
    expect(odd.properties?.receiveMaximum).toBe(1)
    expect(odd.properties?.userProperties[0]).toMatchObject({ key: 'k', value: '7' })

    openTab('t-odd')
    mq().switchToTab('t-odd')
    useMqttStore.setState({ username: 'kept' })
    restoreProtocolFromMetadata('mqtt', { mqtt: { url: 'mqtt://only.url' } })
    expect(mq().url).toBe('mqtt://only.url')
    expect(mq().username).toBe('kept')
  })
})

describe('connect / publish', () => {
  it('resolves {{var}} everywhere; History gets the template; topics subscribe on connect', async () => {
    fillRequest()
    await mq().connect()
    const opts = connect.mock.calls[0][0]
    expect(opts).toMatchObject({
      url: 'mqtt://b.test:1883',
      clientId: 'dev-1',
      username: 'ann',
      password: 'from-env',
      version: 5,
      subscriptions: [{ topic: 'dev/r1/#', qos: 1, noLocal: true }],
      will: { topic: 'dev/r1/status', content: 'offline', qos: 1, retain: true },
      _projectId: 'p1',
    })
    const configured = opts._configured as { meta: { mqtt: Record<string, unknown> } }
    expect(configured.meta.mqtt.password).toBe('{{pw}}')
    expect(configured.meta.mqtt.url).toBe('mqtt://{{host}}:1883')
    expect(mq().connectionState).toBe('connected')

    await mq().publish()
    expect(publish).toHaveBeenCalledWith('c1', {
      topic: 'dev/r1/cmd',
      content: '{"on":true}',
      contentType: 'json',
      qos: 2,
      retain: false,
      properties: expect.objectContaining({
        contentType: 'application/json',
        correlationData: 'c-r1',
      }),
    })
  })

  it('a topic toggle while connected subscribes / unsubscribes at once', async () => {
    mq().setUrl('mqtt://b.test')
    mq().addTopic()
    const id = mq().topics[0].id
    mq().updateTopic(id, { name: 'a/{{room}}' })
    await mq().connect()
    await mq().toggleTopic(id)
    expect(unsubscribe).toHaveBeenCalledWith('c1', ['a/r1'])
    await mq().toggleTopic(id)
    expect(subscribe).toHaveBeenCalledWith('c1', [expect.objectContaining({ topic: 'a/r1' })])
  })

  it('events land on the tab that connected, even after a tab switch (issue #76)', async () => {
    openTab('t-a')
    mq().switchToTab('t-a')
    mq().setUrl('mqtt://b.test')
    await mq().connect()
    openTab('t-b')
    mq().switchToTab('t-b')
    push('event', {
      connectionId: 'c1',
      type: 'message',
      direction: 'in',
      topic: 'x/y',
      payload: '{"n":1}',
      binary: false,
      qos: 1,
      retain: true,
      timestamp: 5,
    })
    push('event', {
      connectionId: 'other',
      type: 'system',
      event: 'error',
      detail: 'x',
      timestamp: 6,
    })
    expect(mq().log).toEqual([])
    const a = mq()._tabStates.get('t-a')!
    const msg = a.log.find((r) => r.direction === 'received')
    expect(msg).toMatchObject({ topic: 'x/y', contentType: 'json', qos: 1, retain: true })
    expect(a.log.some((r) => r.content === 'x')).toBe(false)
  })

  it('a broker-side close returns the tab to disconnected with the reason', async () => {
    mq().setUrl('mqtt://b.test')
    await mq().connect()
    push('closed', { connectionId: 'c1', reason: 'server DISCONNECT (reason 142)' })
    expect(mq().connectionState).toBe('disconnected')
    expect(mq().connectionId).toBeNull()
    expect(mq().log.at(-1)).toMatchObject({ event: 'disconnected', content: /142/ })
  })

  it('closing the tab and switching project both disconnect', async () => {
    openTab('t-a')
    mq().switchToTab('t-a')
    mq().setUrl('mqtt://b.test')
    await mq().connect()
    useWorkspaceStore.setState({ activeProjectId: 'p2' } as never)
    expect(disconnect).toHaveBeenCalledWith('c1')
    expect(mq().connectionState).toBe('disconnected')

    disconnect.mockClear()
    await mq().connect()
    mq().removeTabState('t-a')
    expect(disconnect).toHaveBeenCalledWith('c1')
  })
})

describe('localStorage', () => {
  it('withholds the password, URL userinfo and credential-named user properties', () => {
    mq().setUrl(`mqtt://ann:${PASSWORD}-url@b.test`)
    mq().setPassword(PASSWORD)
    mq().setProperties({
      userProperties: [
        { id: 'u1', key: 'Authorization', value: `Bearer ${PASSWORD}-up`, enabled: true },
        { id: 'u2', key: 'tenant', value: 'acme', enabled: true },
      ],
    })
    mq().setLastWill({ topic: 'w', payload: 'bye' })
    mq().setWillProperties({
      userProperties: [{ id: 'w1', key: 'X-Api-Key', value: `${PASSWORD}-will`, enabled: true }],
    })
    const stored = window.localStorage.getItem(KEY) ?? ''
    expect(stored).not.toContain(PASSWORD)
    expect(stored).toContain('acme')
    expect(stored).toContain('b.test')
    // Memory keeps them for the session.
    expect(mq().password).toBe(PASSWORD)
    expect(mq().withheldCredentials).toEqual([])
  })

  it('a {{var}} password is stored as typed', () => {
    mq().setPassword('{{mqttPw}}')
    expect(window.localStorage.getItem(KEY)).toContain('{{mqttPw}}')
  })
})

// ─── Restart + Ctrl+S (issue #244 data-loss trap) ─────────────────────

type Row = Record<string, unknown>

async function launch() {
  vi.resetModules()
  const [tabs, store, save, ws] = await Promise.all([
    import('../../src/renderer/stores/tabs.store'),
    import('../../src/renderer/stores/mqtt.store'),
    import('../../src/renderer/lib/save-active-request'),
    import('../../src/renderer/stores/workspace.store'),
  ])
  ws.useWorkspaceStore.setState({ refreshTree: async () => {} } as never)
  return {
    useTabsStore: tabs.useTabsStore,
    useMqttStore: store.useMqttStore,
    saveActiveRequestInPlace: save.saveActiveRequestInPlace,
  }
}

describe('restart: the saved password is reloaded, never overwritten', () => {
  it('Ctrl+S after a restart keeps the row password; Connect sends it', async () => {
    const endpoints = new Map<string, Row>()
    const api = {
      endpoint: {
        update: vi.fn(async (id: string, patch: Row) => {
          endpoints.set(id, { ...endpoints.get(id), ...patch })
          return { success: true, data: true }
        }),
        get: vi.fn(async (id: string) => ({ success: true, data: endpoints.get(id) ?? null })),
      },
      mqtt: (window as unknown as { api: { mqtt: unknown } }).api.mqtt,
    }
    ;(window as unknown as { api: unknown }).api = api
    const pw = (): unknown => {
      const schema = JSON.parse(String(endpoints.get('ep-1')?.request_schema ?? '{}')) as Row
      return ((schema.metadata as Row | undefined)?.mqtt as Row | undefined)?.password
    }

    const s1 = await launch()
    s1.useTabsStore.setState({
      tabs: [
        {
          id: 'tab-mq',
          name: 'Broker',
          protocol: 'mqtt',
          method: 'GET',
          url: 'mqtt://b.test',
          isDirty: false,
          endpointId: 'ep-1',
        } as Tab,
      ],
      activeTabId: 'tab-mq',
    })
    s1.useMqttStore.getState().switchToTab('tab-mq')
    s1.useMqttStore.getState().setUrl('mqtt://b.test')
    s1.useMqttStore.getState().setPassword(PASSWORD)
    expect(await s1.saveActiveRequestInPlace()).toEqual({ success: true })
    expect(pw()).toBe(PASSWORD)
    expect(window.localStorage.getItem(KEY) ?? '').not.toContain(PASSWORD)

    const s2 = await launch()
    expect(s2.useMqttStore.getState().password).toBe('')
    expect(s2.useMqttStore.getState().withheldCredentials).toEqual(['password'])
    expect(await s2.saveActiveRequestInPlace()).toEqual({ success: true })
    expect(pw()).toBe(PASSWORD)
    expect(s2.useMqttStore.getState().password).toBe(PASSWORD)

    // A fresh restart: Connect reloads the withheld password before sending.
    const s3 = await launch()
    connect.mockClear()
    await s3.useMqttStore.getState().connect()
    expect(connect.mock.calls[0][0]).toMatchObject({ password: PASSWORD })
  })
})
