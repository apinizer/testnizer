/**
 * Saved-request metadata of the WebSocket, Socket.IO and MQTT editors (issues
 * #282 / #283 / #284) — ONE writer and ONE reader per protocol, used by Ctrl+S /
 * Save As (`snapshotProtocol`), the History row's `configured` (the store's
 * connect) and every reopen path (`applyProtocolMetadata`, History restore,
 * the tab snapshot loader) — and by the Postman v3 import / export in main
 * (issues #276 / #277). Pure TS, no store / node / DOM imports: compiled
 * into both bundles (`src/renderer/lib/realtime-meta.ts` re-exports it).
 *
 * Old rows (no new keys) read back exactly as they behaved before:
 *   - Socket.IO `subscriptions: string[]` → listeners with `listen: true`, and
 *     `listenAll: true` — a reopened request used to show EVERY event on
 *     connect (the saved list was never sent to the engine);
 *   - Socket.IO `emitPayload` → one argument, JSON when it parsed (it was sent
 *     parsed), else text;
 *   - WebSocket `composerMode` widens from `'json' | 'text'` to every format;
 *   - missing settings take the pre-settings defaults (`shared/realtime.ts`).
 *
 * And the other way round: a row written here still opens on an OLDER build
 * (a teammate pulling a shared project). Next to the new keys the writers
 * keep the keys that build reads — Socket.IO `subscriptions` (the listened
 * names) and `emitPayload` (the first argument), WebSocket `composerMode` as
 * `'json' | 'text'` (the full format lives in `composerType`). The readers
 * here prefer the new keys. Pinned by `tests/main/realtime-meta-legacy.test.ts`.
 */
import {
  isRtContentType,
  isSioArgContentType,
  readSioSettings,
  readWsSettings,
  type RtContentType,
  type SioArg,
  type SioListener,
  type SioSavedMessage,
  type SioSettings,
  type WsSavedMessage,
  type WsSettings,
} from './realtime'
import {
  isMqttVersion,
  normalizeMqttSaved,
  normalizeTopics,
  readConnectProperties,
  readLastWill,
  readMqttSettings,
  readPublishDraft,
  type MqttConnectProperties,
  type MqttLastWill,
  type MqttPublishDraft,
  type MqttSavedMessage,
  type MqttSettings,
  type MqttTopic,
  type MqttVersion,
} from './mqtt'

/**
 * A key / value row as the editors keep it (structurally the renderer's
 * `KeyValuePair`; extra fields such as `description` ride along).
 */
export interface RtKeyValue {
  id: string
  key: string
  value: string
  enabled: boolean
  description?: string
}
type KeyValuePair = RtKeyValue

let idSeq = 0
/** Row / message id. Only uniqueness within a request matters. */
function makeId(): string {
  idSeq += 1
  return `rt${Date.now().toString(36)}${idSeq.toString(36)}${Math.random().toString(36).slice(2, 6)}`
}

/**
 * Saved rows → editor rows: a list keeps its rows (missing ids filled), a
 * `{key: value}` map becomes rows. Same rule as History's `toKeyValueRows`.
 */
export function toKeyValueRows(v: unknown): KeyValuePair[] {
  if (Array.isArray(v)) {
    return v.filter(isRecord).map((r) => ({
      ...(r as Partial<KeyValuePair>),
      id: typeof r.id === 'string' && r.id ? r.id : makeId(),
      key: typeof r.key === 'string' ? r.key : typeof r.name === 'string' ? r.name : '',
      value: r.value == null ? '' : String(r.value),
      enabled: r.enabled !== false,
    }))
  }
  if (isRecord(v)) {
    return Object.entries(v).map(([key, value]) => ({
      id: makeId(),
      key,
      value: value == null ? '' : String(value),
      enabled: true,
    }))
  }
  return []
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)
const str = (v: unknown, d = ''): string => (typeof v === 'string' ? v : d)
const idOf = (v: unknown): string => (typeof v === 'string' && v ? v : makeId())

// ─── Normalizers ────────────────────────────────────────────────────────

/** A JSON-looking text is a JSON argument (what the pre-#283 emit did with it). */
export function guessArgType(content: string): 'json' | 'text' {
  try {
    JSON.parse(content)
    return 'json'
  } catch {
    return 'text'
  }
}

export function normalizeArgs(raw: unknown): SioArg[] {
  if (!Array.isArray(raw)) return []
  return raw.filter(isRecord).map((a) => ({
    id: idOf(a.id),
    content: str(a.content),
    contentType: isSioArgContentType(a.contentType) ? a.contentType : 'text',
  }))
}

export function normalizeListeners(raw: unknown): SioListener[] {
  if (!Array.isArray(raw)) return []
  return raw.filter(isRecord).map((l) => ({
    id: idOf(l.id),
    name: str(l.name),
    description: str(l.description),
    listen: l.listen !== false,
  }))
}

export function normalizeSioSaved(raw: unknown): SioSavedMessage[] {
  if (!Array.isArray(raw)) return []
  return raw.filter(isRecord).map((m) => ({
    id: idOf(m.id),
    name: str(m.name, 'message'),
    ...(typeof m.description === 'string' && m.description ? { description: m.description } : {}),
    eventName: str(m.eventName, 'message'),
    acknowledgement: m.acknowledgement === true,
    args: normalizeArgs(m.args),
  }))
}

export function normalizeWsSaved(raw: unknown): WsSavedMessage[] {
  if (!Array.isArray(raw)) return []
  return raw.filter(isRecord).map((m) => ({
    id: idOf(m.id),
    name: str(m.name, 'message'),
    content: str(m.content),
    contentType: isRtContentType(m.contentType) ? m.contentType : 'text',
  }))
}

// ─── Socket.IO ──────────────────────────────────────────────────────────

/** The Socket.IO editor fields that are part of the saved request. */
export interface SioRequestFields {
  url: string
  namespace: string
  bearerToken: string
  customHeaders: KeyValuePair[]
  params: KeyValuePair[]
  settings: SioSettings
  listeners: SioListener[]
  listenAll: boolean
  emitEvent: string
  emitArgs: SioArg[]
  emitAck: boolean
  savedMessages: SioSavedMessage[]
}

/** The `metadata.socketio` block (Ctrl+S, Save As, History `configured`). */
export function sioMetaOf(s: SioRequestFields): Record<string, unknown> {
  return {
    url: s.url,
    namespace: s.namespace,
    bearerToken: s.bearerToken,
    customHeaders: s.customHeaders,
    params: s.params,
    settings: s.settings,
    listeners: s.listeners,
    listenAll: s.listenAll,
    emitEvent: s.emitEvent,
    emitArgs: s.emitArgs,
    emitAck: s.emitAck,
    savedMessages: s.savedMessages,
    // Mirrors for builds before issue #283, which read only these two.
    subscriptions: s.listeners.filter((l) => l.listen && l.name.trim()).map((l) => l.name),
    emitPayload: s.emitArgs[0]?.content ?? '',
  }
}

/**
 * A `metadata.socketio` block → the editor fields it defines. Keys the block
 * does not carry are absent from the result (the caller keeps its own),
 * except the two whose absence MEANS something for an old row: `listenAll`
 * (true) and `emitArgs` (from `emitPayload`).
 */
export function readSioMeta(raw: unknown): Partial<SioRequestFields> {
  const s = isRecord(raw) ? raw : {}
  const out: Partial<SioRequestFields> = {}
  if (typeof s.url === 'string') out.url = s.url
  if (typeof s.namespace === 'string') out.namespace = s.namespace
  if (typeof s.bearerToken === 'string') out.bearerToken = s.bearerToken
  if (s.customHeaders !== undefined) out.customHeaders = toKeyValueRows(s.customHeaders)
  if (s.params !== undefined) out.params = toKeyValueRows(s.params)
  out.settings = readSioSettings(s.settings)
  if (Array.isArray(s.listeners)) {
    out.listeners = normalizeListeners(s.listeners)
  } else if (Array.isArray(s.subscriptions)) {
    out.listeners = s.subscriptions
      .filter((x): x is string => typeof x === 'string' && x.trim() !== '')
      .map((name) => ({ id: makeId(), name, description: '', listen: true }))
  }
  out.listenAll = typeof s.listenAll === 'boolean' ? s.listenAll : true
  if (typeof s.emitEvent === 'string') out.emitEvent = s.emitEvent
  if (Array.isArray(s.emitArgs)) {
    out.emitArgs = normalizeArgs(s.emitArgs)
  } else if (typeof s.emitPayload === 'string') {
    out.emitArgs = [
      { id: makeId(), content: s.emitPayload, contentType: guessArgType(s.emitPayload) },
    ]
  }
  if (typeof s.emitAck === 'boolean') out.emitAck = s.emitAck
  if (s.savedMessages !== undefined) out.savedMessages = normalizeSioSaved(s.savedMessages)
  return out
}

// ─── WebSocket ──────────────────────────────────────────────────────────

export interface WsRequestFields {
  url: string
  customHeaders: KeyValuePair[]
  params: KeyValuePair[]
  settings: WsSettings
  composerContent: string
  /** The composer's format (pre-#282 rows: `'json' | 'text'` only). */
  composerMode: RtContentType
  autoScroll: boolean
  savedMessages: WsSavedMessage[]
}

/** The `metadata.websocket` block. */
export function wsMetaOf(s: WsRequestFields): Record<string, unknown> {
  return {
    url: s.url,
    customHeaders: s.customHeaders,
    params: s.params,
    settings: s.settings,
    composerContent: s.composerContent,
    composerType: s.composerMode,
    // Mirror for builds before issue #282: they read `composerMode` and accept
    // only json / text — every other format is closest to text.
    composerMode: s.composerMode === 'json' ? 'json' : 'text',
    autoScroll: s.autoScroll,
    savedMessages: s.savedMessages,
  }
}

export function readWsMeta(raw: unknown): Partial<WsRequestFields> {
  const w = isRecord(raw) ? raw : {}
  const out: Partial<WsRequestFields> = {}
  if (typeof w.url === 'string') out.url = w.url
  if (w.customHeaders !== undefined) out.customHeaders = toKeyValueRows(w.customHeaders)
  if (w.params !== undefined) out.params = toKeyValueRows(w.params)
  out.settings = readWsSettings(w.settings)
  if (typeof w.composerContent === 'string') out.composerContent = w.composerContent
  // `composerType` (issue #282) wins over the legacy `composerMode` mirror.
  if (isRtContentType(w.composerType)) out.composerMode = w.composerType
  else if (isRtContentType(w.composerMode)) out.composerMode = w.composerMode
  if (typeof w.autoScroll === 'boolean') out.autoScroll = w.autoScroll
  if (w.savedMessages !== undefined) out.savedMessages = normalizeWsSaved(w.savedMessages)
  return out
}

// ─── MQTT (issue #284) ──────────────────────────────────────────────────

/** The MQTT editor fields that are part of the saved request. */
export interface MqttRequestFields {
  url: string
  /** Empty = a random id is generated at connect. */
  clientId: string
  version: MqttVersion
  username: string
  password: string
  settings: MqttSettings
  /** MQTT 5 CONNECT properties. */
  properties: MqttConnectProperties
  lastWill: MqttLastWill
  topics: MqttTopic[]
  composer: MqttPublishDraft
  savedMessages: MqttSavedMessage[]
}

/**
 * The `metadata.mqtt` block (Ctrl+S, Save As, History `configured`, the
 * Postman v3 import). Key names are the v3 `mqtt-request` ones.
 */
export function mqttMetaOf(s: MqttRequestFields): Record<string, unknown> {
  return {
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
  }
}

/**
 * A `metadata.mqtt` block → the editor fields it defines. Keys the block does
 * not carry are absent from the result (the caller keeps its own); a present
 * key of the wrong shape reads as that field's default, never throws.
 */
export function readMqttMeta(raw: unknown): Partial<MqttRequestFields> {
  const m = isRecord(raw) ? raw : {}
  const out: Partial<MqttRequestFields> = {}
  if (typeof m.url === 'string') out.url = m.url
  if (typeof m.clientId === 'string') out.clientId = m.clientId
  if (m.version !== undefined) out.version = isMqttVersion(m.version) ? m.version : 5
  if (typeof m.username === 'string') out.username = m.username
  if (typeof m.password === 'string') out.password = m.password
  if (m.settings !== undefined) out.settings = readMqttSettings(m.settings)
  if (m.properties !== undefined) out.properties = readConnectProperties(m.properties)
  if (m.lastWill !== undefined) out.lastWill = readLastWill(m.lastWill)
  if (m.topics !== undefined) out.topics = normalizeTopics(m.topics)
  if (m.composer !== undefined) out.composer = readPublishDraft(m.composer)
  if (m.savedMessages !== undefined) out.savedMessages = normalizeMqttSaved(m.savedMessages)
  return out
}
