import { create } from 'zustand'
import { loadTabbedState, attachTabbedPersist } from '../lib/persist-helpers'
import { reloadWithheldBeforeSend } from '../lib/withheld-before-send'
import { useWorkspaceStore } from './workspace.store'
import { useEnvironmentStore } from './environment.store'
import { resolveVariables, resolveKeyValuePairs } from '../lib/variable-resolver'
import { makeId } from '../lib/utils'
import { mqttMaskedSendError } from '../lib/masked-send-guard'
import { markActiveTabDirty } from '../lib/mark-dirty'
import {
  credentialRows,
  trackCredentialEdits,
  withholdCredentials,
  type CredentialSpec,
  type WithheldState,
} from '../lib/credential-withhold'
import { urlCredentialText } from '../lib/credential-text'
import {
  DEFAULT_MQTT_SETTINGS,
  DEFAULT_MQTT_VERSION,
  emptyConnectProperties,
  emptyLastWill,
  emptyPublishDraft,
  subscriptionsOf,
  type MqttConnectProperties,
  type MqttKeyValue,
  type MqttLastWill,
  type MqttMessageProperties,
  type MqttPublishDraft,
  type MqttQos,
  type MqttSavedMessage,
  type MqttSettings,
  type MqttTopic,
  type MqttWireSubscription,
} from '../../shared/mqtt'
import { mqttMetaOf, type MqttRequestFields } from '../lib/realtime-meta'

type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error'

/**
 * One message-log row. `sent` / `received` PUBLISH packets (`content` is the
 * text, or base64 when `contentType` is `binary`), and `system` rows whose
 * `event` names them: `connected`, `disconnected`, `error` (written here) and
 * the engine's `subscribed`, `subscribe-refused`, `unsubscribed`,
 * `server-disconnect`, `offline`, `reconnecting`, `reconnected`,
 * `publish-failed` — `content` then holds the detail.
 */
export interface MqttLogRow {
  id: string
  direction: 'sent' | 'received' | 'system'
  topic?: string
  content: string
  contentType: 'text' | 'json' | 'binary'
  qos?: MqttQos
  retain?: boolean
  dup?: boolean
  properties?: Record<string, unknown>
  event?: string
  timestamp: number
}

interface TabMqttState extends WithheldState, MqttRequestFields {
  /** The saved message the composer was loaded from; Save updates it in place. */
  activeSavedMessageId: string | null
  log: MqttLogRow[]
  connectionId: string | null
  connectionState: ConnectionState
  /** The broker dropped the connection and the client is reconnecting. */
  reconnecting: boolean
  errorMessage: string | null
  /** The project the live connection was opened in (closed on a project switch). */
  _projectId?: string | null
  /** Renderer-supplied id so a pending connect can be cancelled. */
  _pendingConnectId?: string
  /** Push subscriptions of this tab's connection (events + closed). */
  _unsubscribe?: () => void
}

interface MqttStore extends TabMqttState {
  _tabStates: Map<string, TabMqttState>
  _currentTabId: string | null

  setUrl: (url: string) => void
  setClientId: (clientId: string) => void
  setVersion: (version: MqttRequestFields['version']) => void
  setUsername: (username: string) => void
  setPassword: (password: string) => void
  setSettings: (patch: Partial<MqttSettings>) => void
  setProperties: (patch: Partial<MqttConnectProperties>) => void
  setLastWill: (patch: Partial<MqttLastWill>) => void
  setWillProperties: (patch: Partial<MqttLastWill['properties']>) => void
  addTopic: () => void
  updateTopic: (id: string, patch: Partial<Omit<MqttTopic, 'id'>>) => void
  removeTopic: (id: string) => void
  /** Turn a topic's Subscribe toggle; subscribes / unsubscribes at once while connected. */
  toggleTopic: (id: string) => Promise<void>
  setComposer: (patch: Partial<Omit<MqttPublishDraft, 'properties'>>) => void
  setComposerProperties: (patch: Partial<MqttMessageProperties>) => void
  /** `name`: the new message's name (the editor passes a translated default). */
  saveCurrentMessage: (name?: string) => void
  addSavedMessage: (name?: string) => void
  loadSavedMessage: (id: string) => void
  renameSavedMessage: (id: string, name: string) => void
  deleteSavedMessage: (id: string) => void
  saveLoggedMessage: (rowId: string, name?: string) => void
  connect: () => Promise<void>
  disconnect: () => Promise<void>
  publish: () => Promise<void>
  clearLog: () => void
  switchToTab: (tabId: string) => void
  removeTabState: (tabId: string) => void
}

function getMqttApi() {
  return window.api?.mqtt
}

function emptyState(): TabMqttState {
  return {
    withheldCredentials: [],
    url: '',
    clientId: '',
    version: DEFAULT_MQTT_VERSION,
    username: '',
    password: '',
    settings: { ...DEFAULT_MQTT_SETTINGS },
    properties: emptyConnectProperties(),
    lastWill: emptyLastWill(),
    topics: [],
    composer: emptyPublishDraft(),
    savedMessages: [],
    activeSavedMessageId: null,
    log: [],
    connectionId: null,
    connectionState: 'disconnected',
    reconnecting: false,
    errorMessage: null,
    _projectId: null,
    _pendingConnectId: undefined,
    _unsubscribe: undefined,
  }
}

function extractState(s: MqttStore): TabMqttState {
  return {
    withheldCredentials: s.withheldCredentials,
    url: s.url,
    clientId: s.clientId,
    version: s.version,
    username: s.username,
    password: s.password,
    settings: s.settings,
    properties: s.properties,
    lastWill: s.lastWill,
    topics: s.topics,
    composer: s.composer,
    savedMessages: s.savedMessages,
    activeSavedMessageId: s.activeSavedMessageId,
    log: s.log,
    connectionId: s.connectionId,
    connectionState: s.connectionState,
    reconnecting: s.reconnecting,
    errorMessage: s.errorMessage,
    _projectId: s._projectId,
    _pendingConnectId: s._pendingConnectId,
    _unsubscribe: s._unsubscribe,
  }
}

/**
 * Issues #244 / #247 / #284: the password, credential-named CONNECT / will
 * user properties and `user:pass@` / `?token=…` in the broker URL never hold
 * a literal value in the localStorage snapshot (the row and its name stay;
 * `{{var}}`-only values are kept). The saved row keeps the value —
 * `lib/withheld-credentials.ts` reloads it.
 */
export const MQTT_CREDENTIALS: CredentialSpec = {
  fields: ['password'],
  rows: [
    credentialRows('properties.userProperties'),
    credentialRows('lastWill.properties.userProperties'),
  ],
  texts: [urlCredentialText('url')],
}

/**
 * On-disk view of a tab: the request fields and the composer draft — never
 * the message log (broker output, and resolved outgoing payloads) or the
 * error. The connection does not survive a reload: stored as disconnected.
 */
function persistableMqtt(st: TabMqttState): TabMqttState {
  const idle = emptyState()
  return {
    ...withholdCredentials(st, MQTT_CREDENTIALS),
    log: idle.log,
    errorMessage: idle.errorMessage,
    connectionId: idle.connectionId,
    connectionState: idle.connectionState,
    reconnecting: false,
    _projectId: null,
    _pendingConnectId: undefined,
    _unsubscribe: undefined,
  }
}

const STORAGE_KEY = 'testnizer-mqtt'
const persisted = loadTabbedState<TabMqttState>(STORAGE_KEY, emptyState, persistableMqtt)

function systemRow(event: string, detail: string, topic?: string): MqttLogRow {
  return {
    id: makeId(),
    direction: 'system',
    event,
    content: detail,
    contentType: 'text',
    ...(topic ? { topic } : {}),
    timestamp: Date.now(),
  }
}

/** Engine event (IPC) → a log row. */
export function logRowOf(e: MqttEventLike): MqttLogRow {
  if (e.type === 'system')
    return { ...systemRow(e.event, e.detail, e.topic), timestamp: e.timestamp }
  let contentType: MqttLogRow['contentType'] = e.binary ? 'binary' : 'text'
  if (!e.binary) {
    try {
      JSON.parse(e.payload)
      contentType = 'json'
    } catch {
      /* text */
    }
  }
  return {
    id: makeId(),
    direction: e.direction === 'in' ? 'received' : 'sent',
    topic: e.topic,
    content: e.payload,
    contentType,
    qos: e.qos,
    retain: e.retain,
    ...(e.dup ? { dup: true } : {}),
    ...(e.properties ? { properties: e.properties } : {}),
    timestamp: e.timestamp,
  }
}

type MqttEventLike =
  | {
      type: 'message'
      direction: 'in' | 'out'
      topic: string
      payload: string
      binary: boolean
      qos: MqttQos
      retain: boolean
      dup?: boolean
      properties?: Record<string, unknown>
      timestamp: number
    }
  | { type: 'system'; event: string; detail: string; topic?: string; timestamp: number }

const resolveRows = (rows: MqttKeyValue[], vars: Record<string, string>): MqttKeyValue[] =>
  resolveKeyValuePairs(rows, vars) as MqttKeyValue[]

/** Message properties with every text `{{var}}`-resolved. */
function resolveMessageProps(
  p: MqttMessageProperties,
  vars: Record<string, string>,
): MqttMessageProperties {
  return {
    ...p,
    contentType: resolveVariables(p.contentType, vars),
    responseTopic: resolveVariables(p.responseTopic, vars),
    correlationData: resolveVariables(p.correlationData, vars),
    userProperties: resolveRows(p.userProperties, vars),
  }
}

/** The topics a live connection subscribes to, names resolved. */
function resolvedSubscriptions(
  topics: MqttTopic[],
  vars: Record<string, string>,
): MqttWireSubscription[] {
  return subscriptionsOf(topics).map((s) => ({ ...s, topic: resolveVariables(s.topic, vars) }))
}

export const useMqttStore = create<MqttStore>((set, get) => {
  const sliceOf = (tabId: string | null): TabMqttState | undefined => {
    const s = get()
    if (s._currentTabId === tabId) return s
    return tabId === null ? undefined : s._tabStates.get(tabId)
  }
  /** Patch `tabId`'s slice wherever it lives (issue #76: async writers name their tab). */
  const patchTab = (
    tabId: string | null,
    patch: (slice: TabMqttState) => Partial<TabMqttState> | null,
  ): void => {
    const s = get()
    if (s._currentTabId === tabId) {
      const p = patch(s)
      if (p) set(p as Partial<MqttStore>)
      return
    }
    if (tabId === null) return
    const cached = s._tabStates.get(tabId)
    if (!cached) return
    const p = patch(cached)
    if (!p) return
    const map = new Map(s._tabStates)
    map.set(tabId, { ...cached, ...p })
    set({ _tabStates: map })
  }
  const edit = (patch: Partial<TabMqttState>): void => {
    set(patch as Partial<MqttStore>)
    markActiveTabDirty()
  }
  const vars = (): Record<string, string> => useEnvironmentStore.getState().getActiveVariables()

  /** Subscribe / unsubscribe one row on the live connection; a failure lands in the error box. */
  const applyTopic = async (topic: MqttTopic, on: boolean): Promise<void> => {
    const s = get()
    const api = getMqttApi()
    if (!api || !s.connectionId || s.connectionState !== 'connected' || !topic.name.trim()) return
    const owner = s._currentTabId
    const name = resolveVariables(topic.name.trim(), vars())
    const res = on
      ? await api.subscribe(
          s.connectionId,
          resolvedSubscriptions([{ ...topic, subscribe: true }], vars()),
        )
      : await api.unsubscribe(s.connectionId, [name])
    if (!res?.success) patchTab(owner, () => ({ errorMessage: res?.error ?? 'Request failed' }))
  }

  return {
    ...persisted.current,
    _tabStates: persisted._tabStates,
    _currentTabId: persisted._currentTabId,
    // transient — never restored from disk
    connectionId: null,
    connectionState: 'disconnected',
    reconnecting: false,
    errorMessage: null,
    log: [],
    _unsubscribe: undefined,

    setUrl: (url) => edit({ url }),
    setClientId: (clientId) => edit({ clientId }),
    setVersion: (version) => edit({ version }),
    setUsername: (username) => edit({ username }),
    setPassword: (password) => edit({ password }),
    setSettings: (patch) => edit({ settings: { ...get().settings, ...patch } }),
    setProperties: (patch) => edit({ properties: { ...get().properties, ...patch } }),
    setLastWill: (patch) => edit({ lastWill: { ...get().lastWill, ...patch } }),
    setWillProperties: (patch) =>
      edit({
        lastWill: {
          ...get().lastWill,
          properties: { ...get().lastWill.properties, ...patch },
        },
      }),

    // While connected (or connecting — Connect already took its subscription
    // list) a new row starts with Subscribe off: a subscribed row is locked (its
    // name can't change under a live subscription), and an empty name can't be
    // subscribed anyway — the user types it, then flips Subscribe. Disconnected
    // or after a failed Connect it starts on, so the next Connect subscribes it.
    addTopic: () =>
      edit({
        topics: [
          ...get().topics,
          {
            id: makeId(),
            name: '',
            qos: 0,
            subscribe:
              get().connectionState !== 'connected' && get().connectionState !== 'connecting',
            description: '',
            noLocal: false,
            retainAsPublished: false,
            retainHandling: 0,
          },
        ],
      }),
    updateTopic: (id, patch) =>
      edit({ topics: get().topics.map((t) => (t.id === id ? { ...t, ...patch } : t)) }),
    removeTopic: (id) => {
      const topic = get().topics.find((t) => t.id === id)
      edit({ topics: get().topics.filter((t) => t.id !== id) })
      if (topic?.subscribe) void applyTopic(topic, false)
    },
    toggleTopic: async (id) => {
      const topic = get().topics.find((t) => t.id === id)
      if (!topic) return
      const next = { ...topic, subscribe: !topic.subscribe }
      edit({ topics: get().topics.map((t) => (t.id === id ? next : t)) })
      await applyTopic(next, next.subscribe)
    },

    setComposer: (patch) => edit({ composer: { ...get().composer, ...patch } }),
    setComposerProperties: (patch) =>
      edit({
        composer: {
          ...get().composer,
          properties: { ...get().composer.properties, ...patch },
        },
      }),

    saveCurrentMessage: (name) => {
      const s = get()
      const body = structuredClone(s.composer)
      const existing = s.savedMessages.find((m) => m.id === s.activeSavedMessageId)
      if (existing) {
        edit({
          savedMessages: s.savedMessages.map((m) => (m.id === existing.id ? { ...m, ...body } : m)),
        })
        return
      }
      const msg: MqttSavedMessage = {
        id: makeId(),
        name: name ?? `Message ${s.savedMessages.length + 1}`,
        ...body,
      }
      edit({ savedMessages: [...s.savedMessages, msg], activeSavedMessageId: msg.id })
    },
    addSavedMessage: (name) => {
      const draft = { ...emptyPublishDraft(), topic: get().composer.topic }
      const msg: MqttSavedMessage = {
        id: makeId(),
        name: name ?? `Message ${get().savedMessages.length + 1}`,
        ...structuredClone(draft),
      }
      edit({
        savedMessages: [...get().savedMessages, msg],
        activeSavedMessageId: msg.id,
        composer: draft,
      })
    },
    loadSavedMessage: (id) => {
      const msg = get().savedMessages.find((m) => m.id === id)
      if (!msg) return
      const { id: _id, name: _name, description: _d, ...draft } = msg
      void _id
      void _name
      void _d
      edit({ activeSavedMessageId: id, composer: structuredClone(draft) })
    },
    renameSavedMessage: (id, name) =>
      edit({ savedMessages: get().savedMessages.map((m) => (m.id === id ? { ...m, name } : m)) }),
    deleteSavedMessage: (id) =>
      edit({
        savedMessages: get().savedMessages.filter((m) => m.id !== id),
        activeSavedMessageId: get().activeSavedMessageId === id ? null : get().activeSavedMessageId,
      }),
    saveLoggedMessage: (rowId, name) => {
      const row = get().log.find((r) => r.id === rowId)
      if (!row || row.direction === 'system') return
      const msg: MqttSavedMessage = {
        id: makeId(),
        name: name ?? `Message ${get().savedMessages.length + 1}`,
        ...emptyPublishDraft(),
        topic: row.topic ?? '',
        content: row.content,
        contentType: row.contentType === 'binary' ? 'base64' : row.contentType,
        qos: row.qos ?? 0,
        retain: row.retain === true,
      }
      edit({ savedMessages: [...get().savedMessages, msg] })
    },

    connect: async () => {
      // Issue #244: a credential still withheld after a restart is reloaded first.
      if (get().withheldCredentials.length > 0) await reloadWithheldBeforeSend()
      const start = get()
      if (!start.url.trim()) return
      // Issue #195: a History mask left in a credential field is never sent.
      const masked = mqttMaskedSendError({
        url: start.url,
        password: start.password,
        userProperties: start.properties.userProperties.filter((r) => r.enabled),
        willUserProperties: start.lastWill.properties.userProperties.filter((r) => r.enabled),
        willPayload: start.lastWill.payload,
      })
      if (masked) {
        set({ connectionState: 'error', errorMessage: masked })
        return
      }
      const api = getMqttApi()
      if (!api) {
        set({ connectionState: 'error', errorMessage: 'API not available' })
        return
      }
      const ownerTabId = start._currentTabId
      const pendingConnectId = makeId()
      const projectId = useWorkspaceStore.getState().activeProjectId
      start._unsubscribe?.()
      set({
        connectionState: 'connecting',
        reconnecting: false,
        errorMessage: null,
        log: [],
        _pendingConnectId: pendingConnectId,
        _unsubscribe: undefined,
        _projectId: projectId,
      })

      const v = vars()
      const r = (x: string): string => resolveVariables(x, v)
      const resolvedUrl = r(start.url.trim())
      const will = start.lastWill
      const willOn = will.topic.trim() !== ''

      // Subscribe BEFORE awaiting connect: SUBACK rows and retained messages
      // can arrive before the connect reply. Until the id is known they wait.
      let connId: string | null = null
      const early: Array<() => void> = []
      const append = (row: MqttLogRow, extra?: Partial<TabMqttState>): void =>
        patchTab(ownerTabId, (sl) =>
          sl.connectionId === connId ? { log: [...sl.log, row], ...(extra ?? {}) } : null,
        )
      const onEvent = (raw: unknown): void => {
        const e = raw as { connectionId: string } & MqttEventLike
        const deliver = (): void => {
          if (e.connectionId !== connId) return
          const extra: Partial<TabMqttState> | undefined =
            e.type !== 'system'
              ? undefined
              : e.event === 'offline' || e.event === 'reconnecting'
                ? { connectionState: 'connecting', reconnecting: true }
                : e.event === 'reconnected'
                  ? { connectionState: 'connected', reconnecting: false }
                  : undefined
          append(logRowOf(e), extra)
        }
        if (connId === null) early.push(deliver)
        else deliver()
      }
      const onClosed = (raw: unknown): void => {
        const c = raw as { connectionId: string; reason?: string }
        const deliver = (): void => {
          if (c.connectionId !== connId) return
          unsubscribe()
          patchTab(ownerTabId, (sl) =>
            sl.connectionId === connId
              ? {
                  connectionState: 'disconnected',
                  reconnecting: false,
                  connectionId: null,
                  _unsubscribe: undefined,
                  log: [...sl.log, systemRow('disconnected', c.reason ?? '')],
                }
              : null,
          )
        }
        if (connId === null) early.push(deliver)
        else deliver()
      }
      const offEvent = api.onEvent(onEvent)
      const offClosed = api.onClosed(onClosed)
      const unsubscribe = (): void => {
        offEvent()
        offClosed()
      }
      patchTab(ownerTabId, () => ({ _unsubscribe: unsubscribe }))

      const ws = useWorkspaceStore.getState()
      const res = await api.connect({
        url: resolvedUrl,
        clientId: r(start.clientId),
        version: start.version,
        username: r(start.username),
        password: r(start.password),
        settings: start.settings,
        properties: {
          ...start.properties,
          userProperties: resolveRows(start.properties.userProperties, v),
        },
        will: willOn
          ? {
              topic: r(will.topic),
              content: r(will.payload),
              contentType: will.type,
              qos: will.qos,
              retain: will.retain,
              properties: {
                ...will.properties,
                contentType: r(will.properties.contentType),
                responseTopic: r(will.properties.responseTopic),
                correlationData: r(will.properties.correlationData),
                userProperties: resolveRows(will.properties.userProperties, v),
              },
            }
          : null,
        subscriptions: resolvedSubscriptions(start.topics, v),
        _tabId: ownerTabId ?? undefined,
        _workspaceId: ws.activeWorkspaceId || undefined,
        _projectId: projectId || undefined,
        _pendingId: pendingConnectId,
        // Editor state with `{{var}}` kept — the History row reopens from it
        // (issues #182, #195). The same block `snapshotProtocol` saves.
        _configured: { url: start.url, meta: { mqtt: mqttMetaOf(start) } },
      })

      if (res?.success && res.data) {
        connId = res.data.connectionId
        const detail = `${res.data.url} · ${res.data.clientId}`
        patchTab(ownerTabId, (sl) => ({
          connectionId: connId,
          connectionState: 'connected',
          errorMessage: null,
          _pendingConnectId: undefined,
          log: [...sl.log, systemRow('connected', detail)],
        }))
        for (const run of early.splice(0)) run()
      } else {
        unsubscribe()
        const message = res?.error ?? 'Connection failed'
        patchTab(ownerTabId, (sl) => ({
          connectionState: 'error',
          errorMessage: message,
          _pendingConnectId: undefined,
          _unsubscribe: undefined,
          log: [...sl.log, systemRow('error', message)],
        }))
      }
    },

    disconnect: async () => {
      const { connectionId, _unsubscribe, _pendingConnectId, connectionState } = get()
      const api = getMqttApi()
      if (api) {
        if (connectionState === 'connecting' && _pendingConnectId) {
          try {
            await api.cancelConnect(_pendingConnectId)
          } catch {
            // Already settled — disconnect catches it.
          }
        }
        if (connectionId) await api.disconnect(connectionId)
      }
      _unsubscribe?.()
      // The request configuration stays (issue #21); the log keeps a closing row.
      set((s) => ({
        connectionId: null,
        connectionState: 'disconnected',
        reconnecting: false,
        errorMessage: null,
        _pendingConnectId: undefined,
        _unsubscribe: undefined,
        log: connectionId ? [...s.log, systemRow('disconnected', 'client disconnect')] : s.log,
      }))
    },

    publish: async () => {
      const s = get()
      if (!s.connectionId || s.connectionState !== 'connected') return
      const c = s.composer
      const masked = mqttMaskedSendError({
        payload: c.content,
        userProperties: c.properties.userProperties.filter((row) => row.enabled),
      })
      if (masked) {
        set({ errorMessage: masked })
        return
      }
      set({ errorMessage: null })
      const owner = s._currentTabId
      const v = vars()
      const api = getMqttApi()
      if (!api) return
      const res = await api.publish(s.connectionId, {
        topic: resolveVariables(c.topic.trim(), v),
        content: resolveVariables(c.content, v),
        contentType: c.contentType,
        qos: c.qos,
        retain: c.retain,
        properties: resolveMessageProps(c.properties, v),
      })
      if (!res?.success) patchTab(owner, () => ({ errorMessage: res?.error ?? 'Publish failed' }))
    },

    clearLog: () => set({ log: [] }),

    switchToTab: (tabId) => {
      const state = get()
      const tabStates = new Map(state._tabStates)
      if (state._currentTabId) tabStates.set(state._currentTabId, extractState(state))
      const target = tabStates.get(tabId) ?? emptyState()
      set({ ...target, _tabStates: tabStates, _currentTabId: tabId })
    },

    removeTabState: (tabId) => {
      const slice = sliceOf(tabId)
      if (slice?.connectionId) {
        void getMqttApi()
          ?.disconnect(slice.connectionId)
          .catch(() => {})
      } else if (slice?._pendingConnectId) {
        void getMqttApi()
          ?.cancelConnect(slice._pendingConnectId)
          .catch(() => {})
      }
      slice?._unsubscribe?.()
      if (get()._currentTabId === tabId) {
        set({
          connectionId: null,
          connectionState: 'disconnected',
          reconnecting: false,
          _unsubscribe: undefined,
        })
      }
      const tabStates = new Map(get()._tabStates)
      tabStates.delete(tabId)
      set({ _tabStates: tabStates })
    },
  }
})

/**
 * Close every connection opened in another project when the active project
 * changes: its tab is no longer on screen, and a connection nobody sees must
 * not keep receiving (and keep a broker session).
 */
export function closeConnectionsOutsideProject(projectId: string | null): void {
  const s = useMqttStore.getState()
  const live: Array<[string | null, TabMqttState]> = [[s._currentTabId, s]]
  for (const [id, sl] of s._tabStates) if (id !== s._currentTabId) live.push([id, sl])
  for (const [, sl] of live) {
    if (!sl.connectionId && !sl._pendingConnectId) continue
    if ((sl._projectId ?? null) === projectId) continue
    if (sl.connectionId)
      void getMqttApi()
        ?.disconnect(sl.connectionId)
        .catch(() => {})
    else if (sl._pendingConnectId)
      void getMqttApi()
        ?.cancelConnect(sl._pendingConnectId)
        .catch(() => {})
    sl._unsubscribe?.()
  }
  const reset = (sl: TabMqttState): TabMqttState =>
    (sl.connectionId || sl._pendingConnectId) && (sl._projectId ?? null) !== projectId
      ? {
          ...sl,
          connectionId: null,
          connectionState: 'disconnected',
          reconnecting: false,
          _pendingConnectId: undefined,
          _unsubscribe: undefined,
          log: sl.connectionId
            ? [...sl.log, systemRow('disconnected', 'project switched')]
            : sl.log,
        }
      : sl
  const map = new Map<string, TabMqttState>()
  for (const [id, sl] of s._tabStates) map.set(id, reset(sl))
  const current = reset(extractState(s))
  useMqttStore.setState({ ...current, _tabStates: map })
}

attachTabbedPersist(
  useMqttStore,
  STORAGE_KEY,
  extractState,
  (s) => ({ _tabStates: s._tabStates, _currentTabId: s._currentTabId }),
  persistableMqtt,
)
// Issue #244: a user edit to a withheld value drops its marker.
trackCredentialEdits(useMqttStore, MQTT_CREDENTIALS)
// A project switch closes the connections of the project left behind.
useWorkspaceStore.subscribe((next, prev) => {
  if (next.activeProjectId !== prev.activeProjectId)
    closeConnectionsOutsideProject(next.activeProjectId ?? null)
})
