/**
 * MQTT request model shared by main (engine, handler, Postman v3 import /
 * export) and the renderer (store, editor). Issue #284.
 *
 * Field names follow the Postman collection v3 `mqtt-request` schema (the
 * vendored v3.0.0 JSON Schema) so the v3 boundary maps 1:1:
 *   - `version`: 4 = MQTT 3.1.1, 5 = MQTT 5.0 (Postman offers no 3.1);
 *   - settings: `cleanSession`, `keepAlive` (s), `autoReconnect`,
 *     `connectionTimeout` (ms), `strictSSL`;
 *   - connect `properties`: `sessionExpiryInterval`, `receiveMaximum`,
 *     `maximumPacketSize`, `requestResponseInformation`, `userProperties`;
 *   - `lastWill`: `topic`, `payload`, `type`, `qos`, `retain`, `properties`
 *     (`willDelayInterval` in seconds, like mqtt-packet);
 *   - topics: `name`, `qos`, `subscribe`, `description` + the MQTT 5
 *     subscription options `noLocal`, `retainAsPublished`, `retainHandling`;
 *   - message: `topic`, `content`, `contentType`, `qos`, `retain`, `properties`.
 * Two content types never mix: `contentType` of a message (and the will's
 * `type`) is how the payload is ENCODED in the editor (text / json / … /
 * base64 / hex); `properties.contentType` is the MQTT 5 MIME type sent on the
 * wire.
 *
 * Pure TS, zero runtime imports beyond the shared realtime helpers: compiled
 * into both bundles.
 */
import { WS_CONTENT_TYPES, isRtContentType, type RtContentType } from './realtime'

// ─── Scalars ────────────────────────────────────────────────────────────

/** 4 = MQTT 3.1.1, 5 = MQTT 5.0. */
export type MqttVersion = 4 | 5
export const MQTT_VERSIONS: readonly MqttVersion[] = [5, 4]
export const DEFAULT_MQTT_VERSION: MqttVersion = 5

export type MqttQos = 0 | 1 | 2
export const MQTT_QOS: readonly MqttQos[] = [0, 1, 2]

/** Retain handling of an MQTT 5 subscription (0 send at subscribe, 1 only if new, 2 never). */
export type MqttRetainHandling = 0 | 1 | 2

/**
 * Payload encodings of the composer and the will — the WebSocket composer's
 * list (Text, JSON, XML, HTML, Binary as Base64 / Hex). Postman v3 stores
 * only text / json / hex / base64; XML and HTML export as text.
 */
export type MqttContentType = RtContentType
export const MQTT_CONTENT_TYPES: readonly MqttContentType[] = WS_CONTENT_TYPES
export const isMqttContentType = isRtContentType

export function isMqttQos(v: unknown): v is MqttQos {
  return v === 0 || v === 1 || v === 2
}

export function isMqttVersion(v: unknown): v is MqttVersion {
  return v === 4 || v === 5
}

// ─── Key / value rows ───────────────────────────────────────────────────

/** A user-property row as the editors keep it (structurally `KeyValuePair`). */
export interface MqttKeyValue {
  id: string
  key: string
  value: string
  enabled: boolean
  description?: string
}

// ─── Settings ───────────────────────────────────────────────────────────

export interface MqttSettings {
  /** Verify the broker's TLS certificate (mqtts:// / wss://). */
  strictSSL: boolean
  /** How long to wait for CONNACK, in ms. */
  connectionTimeout: number
  /** Keep-alive ping interval, in seconds (0 = off). */
  keepAlive: number
  /** Clean session (3.1.1) / clean start (5.0). */
  cleanSession: boolean
  /** Reconnect after the connection drops unexpectedly. */
  autoReconnect: boolean
}

/** MQTT.js's own defaults (30 s connect timeout, 60 s keep-alive, clean session). */
export const DEFAULT_MQTT_SETTINGS: MqttSettings = {
  strictSSL: true,
  connectionTimeout: 30_000,
  keepAlive: 60,
  cleanSession: true,
  autoReconnect: false,
}

/** Delay between automatic reconnection attempts (Postman has no field for it). */
export const MQTT_RECONNECT_PERIOD_MS = 1_000

const MAX_TIMEOUT_MS = 600_000
/** The MQTT keep-alive field is 16 bits. */
const MAX_KEEPALIVE_S = 65_535
/** 32-bit unsigned (session expiry, message expiry, will delay, max packet size). */
const MAX_U32 = 4_294_967_295
const MAX_U16 = 65_535

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

function intIn(v: unknown, min: number, max: number, fallback: number): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, Math.round(n)))
}

/** An optional integer property: `null` = not sent. */
function optInt(v: unknown, min: number, max: number): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN
  if (!Number.isFinite(n)) return null
  return Math.min(max, Math.max(min, Math.round(n)))
}

/** Saved / IPC settings → complete, clamped settings (missing keys take the defaults). */
export function readMqttSettings(raw: unknown): MqttSettings {
  const r = isRecord(raw) ? raw : {}
  const d = DEFAULT_MQTT_SETTINGS
  return {
    strictSSL: typeof r.strictSSL === 'boolean' ? r.strictSSL : d.strictSSL,
    connectionTimeout: intIn(r.connectionTimeout, 1, MAX_TIMEOUT_MS, d.connectionTimeout),
    keepAlive: intIn(r.keepAlive, 0, MAX_KEEPALIVE_S, d.keepAlive),
    cleanSession: typeof r.cleanSession === 'boolean' ? r.cleanSession : d.cleanSession,
    autoReconnect: typeof r.autoReconnect === 'boolean' ? r.autoReconnect : d.autoReconnect,
  }
}

// ─── Properties ─────────────────────────────────────────────────────────

/** MQTT 5 CONNECT properties (the Properties tab). `null` = not sent. */
export interface MqttConnectProperties {
  sessionExpiryInterval: number | null
  receiveMaximum: number | null
  maximumPacketSize: number | null
  requestResponseInformation: boolean
  userProperties: MqttKeyValue[]
}

/** MQTT 5 PUBLISH properties (composer, saved messages). */
export interface MqttMessageProperties {
  contentType: string
  responseTopic: string
  correlationData: string
  messageExpiryInterval: number | null
  topicAlias: number | null
  payloadFormatIndicator: boolean
  userProperties: MqttKeyValue[]
}

/** MQTT 5 will properties. */
export interface MqttWillProperties {
  willDelayInterval: number | null
  messageExpiryInterval: number | null
  payloadFormatIndicator: boolean
  contentType: string
  responseTopic: string
  correlationData: string
  userProperties: MqttKeyValue[]
}

export function emptyConnectProperties(): MqttConnectProperties {
  return {
    sessionExpiryInterval: null,
    receiveMaximum: null,
    maximumPacketSize: null,
    requestResponseInformation: false,
    userProperties: [],
  }
}

export function emptyMessageProperties(): MqttMessageProperties {
  return {
    contentType: '',
    responseTopic: '',
    correlationData: '',
    messageExpiryInterval: null,
    topicAlias: null,
    payloadFormatIndicator: false,
    userProperties: [],
  }
}

export function emptyWillProperties(): MqttWillProperties {
  return {
    willDelayInterval: null,
    messageExpiryInterval: null,
    payloadFormatIndicator: false,
    contentType: '',
    responseTopic: '',
    correlationData: '',
    userProperties: [],
  }
}

// ─── Topics, will, messages ─────────────────────────────────────────────

/** A row of the Topics tab. `subscribe` = subscribed on connect / while the toggle is on. */
export interface MqttTopic {
  id: string
  name: string
  qos: MqttQos
  subscribe: boolean
  description: string
  /** MQTT 5 subscription options. */
  noLocal: boolean
  retainAsPublished: boolean
  retainHandling: MqttRetainHandling
}

/** The Last Will tab. Sent only when `topic` is not blank. */
export interface MqttLastWill {
  topic: string
  payload: string
  type: MqttContentType
  qos: MqttQos
  retain: boolean
  properties: MqttWillProperties
}

export function emptyLastWill(): MqttLastWill {
  return {
    topic: '',
    payload: '',
    type: 'text',
    qos: 0,
    retain: false,
    properties: emptyWillProperties(),
  }
}

/** What the composer publishes. */
export interface MqttPublishDraft {
  topic: string
  content: string
  contentType: MqttContentType
  qos: MqttQos
  retain: boolean
  properties: MqttMessageProperties
}

export function emptyPublishDraft(): MqttPublishDraft {
  return {
    topic: '',
    content: '',
    contentType: 'text',
    qos: 0,
    retain: false,
    properties: emptyMessageProperties(),
  }
}

export interface MqttSavedMessage extends MqttPublishDraft {
  id: string
  name: string
  description?: string
}

// ─── URL ────────────────────────────────────────────────────────────────

const SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i
export const MQTT_SCHEMES: readonly string[] = ['mqtt', 'mqtts', 'ws', 'wss']

/**
 * A broker address as typed → a URL MQTT.js connects to. Postman accepts a
 * bare `broker.hivemq.com` or `host:1883`: those get `mqtt://`. A `{{var}}`
 * at the very start is left alone (it may hold the scheme).
 */
export function normalizeMqttUrl(raw: string): string {
  const url = raw.trim()
  if (!url || SCHEME.test(url) || url.startsWith('{{')) return url
  return `mqtt://${url}`
}

/** The URL's scheme (`mqtt`, `mqtts`, `ws`, `wss`), lower case; '' when none. */
export function mqttScheme(url: string): string {
  const m = /^([a-z][a-z0-9+.-]*):\/\//i.exec(url.trim())
  return m ? m[1].toLowerCase() : ''
}

/** TLS transports — the only ones that use certificates. */
export function isSecureMqttUrl(url: string): boolean {
  const s = mqttScheme(url)
  return s === 'mqtts' || s === 'wss' || s === 'ssl' || s === 'tls'
}

/** A random client id like Postman's default (`testnizer-` + 8 hex digits). */
export function randomMqttClientId(): string {
  let hex = ''
  for (let i = 0; i < 8; i++) hex += Math.floor(Math.random() * 16).toString(16)
  return `testnizer-${hex}`
}

// ─── Normalizers (saved / imported JSON → model) ────────────────────────

let idSeq = 0
function makeId(): string {
  idSeq += 1
  return `mq${Date.now().toString(36)}${idSeq.toString(36)}${Math.random().toString(36).slice(2, 6)}`
}
const str = (v: unknown, d = ''): string => (typeof v === 'string' ? v : d)
const idOf = (v: unknown): string => (typeof v === 'string' && v ? v : makeId())
const qosOf = (v: unknown): MqttQos => (isMqttQos(v) ? v : 0)

export function normalizeKeyValues(raw: unknown): MqttKeyValue[] {
  if (!Array.isArray(raw)) return []
  return raw.filter(isRecord).map((r) => ({
    id: idOf(r.id),
    key: str(r.key),
    value: r.value == null ? '' : String(r.value),
    enabled: r.enabled !== false && r.disabled !== true,
    ...(typeof r.description === 'string' && r.description ? { description: r.description } : {}),
  }))
}

export function readConnectProperties(raw: unknown): MqttConnectProperties {
  const r = isRecord(raw) ? raw : {}
  return {
    sessionExpiryInterval: optInt(r.sessionExpiryInterval, 0, MAX_U32),
    receiveMaximum: optInt(r.receiveMaximum, 1, MAX_U16),
    maximumPacketSize: optInt(r.maximumPacketSize, 1, MAX_U32),
    requestResponseInformation: r.requestResponseInformation === true,
    userProperties: normalizeKeyValues(r.userProperties),
  }
}

export function readMessageProperties(raw: unknown): MqttMessageProperties {
  const r = isRecord(raw) ? raw : {}
  return {
    contentType: str(r.contentType),
    responseTopic: str(r.responseTopic),
    correlationData: str(r.correlationData),
    messageExpiryInterval: optInt(r.messageExpiryInterval, 0, MAX_U32),
    topicAlias: optInt(r.topicAlias, 1, MAX_U16),
    payloadFormatIndicator: r.payloadFormatIndicator === true,
    userProperties: normalizeKeyValues(r.userProperties),
  }
}

export function readWillProperties(raw: unknown): MqttWillProperties {
  const r = isRecord(raw) ? raw : {}
  return {
    willDelayInterval: optInt(r.willDelayInterval, 0, MAX_U32),
    messageExpiryInterval: optInt(r.messageExpiryInterval, 0, MAX_U32),
    payloadFormatIndicator: r.payloadFormatIndicator === true,
    contentType: str(r.contentType),
    responseTopic: str(r.responseTopic),
    correlationData: str(r.correlationData),
    userProperties: normalizeKeyValues(r.userProperties),
  }
}

export function readLastWill(raw: unknown): MqttLastWill {
  const r = isRecord(raw) ? raw : {}
  return {
    topic: str(r.topic),
    payload: str(r.payload),
    type: isMqttContentType(r.type) ? r.type : 'text',
    qos: qosOf(r.qos),
    retain: r.retain === true,
    properties: readWillProperties(r.properties),
  }
}

export function normalizeTopics(raw: unknown): MqttTopic[] {
  if (!Array.isArray(raw)) return []
  return raw.filter(isRecord).map((t) => ({
    id: idOf(t.id),
    name: str(t.name),
    qos: qosOf(t.qos),
    subscribe: t.subscribe !== false,
    description: str(t.description),
    noLocal: t.noLocal === true,
    retainAsPublished: t.retainAsPublished === true,
    retainHandling: t.retainHandling === 1 || t.retainHandling === 2 ? t.retainHandling : 0,
  }))
}

export function readPublishDraft(raw: unknown): MqttPublishDraft {
  const r = isRecord(raw) ? raw : {}
  return {
    topic: str(r.topic),
    content: str(r.content),
    contentType: isMqttContentType(r.contentType) ? r.contentType : 'text',
    qos: qosOf(r.qos),
    retain: r.retain === true,
    properties: readMessageProperties(r.properties),
  }
}

export function normalizeMqttSaved(raw: unknown): MqttSavedMessage[] {
  if (!Array.isArray(raw)) return []
  return raw.filter(isRecord).map((m) => ({
    id: idOf(m.id),
    name: str(m.name, 'message'),
    ...(typeof m.description === 'string' && m.description ? { description: m.description } : {}),
    ...readPublishDraft(m),
  }))
}

// ─── Wire shapes (renderer → main, everything `{{var}}`-resolved) ───────

/** Enabled user-property rows → MQTT.js's `{ name: value | value[] }` map. */
export function userPropertiesMap(
  rows: readonly MqttKeyValue[],
): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {}
  for (const r of rows) {
    if (!r.enabled || !r.key.trim()) continue
    const prev = out[r.key]
    if (prev === undefined) out[r.key] = r.value
    else out[r.key] = Array.isArray(prev) ? [...prev, r.value] : [prev, r.value]
  }
  return out
}

/** A payload on the wire: content + its encoding. */
export interface MqttWirePayload {
  content: string
  contentType: MqttContentType
}

export interface MqttWireSubscription {
  topic: string
  qos: MqttQos
  noLocal?: boolean
  retainAsPublished?: boolean
  retainHandling?: MqttRetainHandling
}

export interface MqttWirePublish extends MqttWirePayload {
  topic: string
  qos: MqttQos
  retain: boolean
  properties?: MqttMessageProperties
}

export interface MqttWireWill extends MqttWirePayload {
  topic: string
  qos: MqttQos
  retain: boolean
  properties?: MqttWillProperties
}

/** Topics subscribed on connect: the enabled, named rows. */
export function subscriptionsOf(topics: readonly MqttTopic[]): MqttWireSubscription[] {
  return topics
    .filter((t) => t.subscribe && t.name.trim())
    .map((t) => ({
      topic: t.name.trim(),
      qos: t.qos,
      noLocal: t.noLocal,
      retainAsPublished: t.retainAsPublished,
      retainHandling: t.retainHandling,
    }))
}

/** A SUBACK grant of 128 (or an MQTT 5 reason code ≥ 0x80) is a refusal. */
export function isRefusedGrant(qos: number): boolean {
  return qos >= 0x80
}
