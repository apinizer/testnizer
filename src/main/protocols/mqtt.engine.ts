/**
 * MQTT client engine (issue #284) on MQTT.js — MQTT 3.1.1 and 5.0 over
 * `mqtt://`, `mqtts://`, `ws://` and `wss://`.
 *
 * Node only (no `electron` import): the handler (`ipc/mqtt.handler.ts`)
 * routes the callbacks to the renderer, the tests drive the engine against a
 * real broker. Everything that happens on a connection becomes an event —
 * messages in / out, SUBACK grants and refusals, a server DISCONNECT with its
 * reason code, the connection dropping, each reconnection attempt — and a
 * close the user did not ask for is reported once through `onClose` (the
 * #275 rule: the editor must never stay "connected" to a dead broker).
 *
 * MQTT.js traps handled here:
 *  - `reconnectPeriod` defaults to 1 s, so a refused or unauthorised connect
 *    would retry forever and the connect promise never settle. The client
 *    starts with 0 and reconnection is switched on only after CONNACK (MQTT.js
 *    reads `options.reconnectPeriod` at run time).
 *  - The connect timeout closes the stream; the promise rejects on the first
 *    `error` OR `close` before CONNACK, and our own timer backs it up.
 *  - With protocol 3.1.1 no MQTT 5 field is sent (properties, will
 *    properties, subscription options): MQTT.js would otherwise encode them.
 */
import { connect as mqttConnectClient, type IClientOptions, type MqttClient } from 'mqtt'
import { randomUUID } from 'crypto'
import {
  DEFAULT_MQTT_SETTINGS,
  MQTT_RECONNECT_PERIOD_MS,
  isRefusedGrant,
  normalizeMqttUrl,
  randomMqttClientId,
  readMqttSettings,
  userPropertiesMap,
  type MqttConnectProperties,
  type MqttMessageProperties,
  type MqttQos,
  type MqttSettings,
  type MqttVersion,
  type MqttWirePayload,
  type MqttWirePublish,
  type MqttWireSubscription,
  type MqttWireWill,
  type MqttWillProperties,
} from '../../shared/mqtt'
import { bytesToBase64, decodeBinary, isBinaryContentType } from '../../shared/realtime'

// ─── Types ───────────────────────────────────────────────────────────────

/** TLS material for `mqtts://` / `wss://` (the project's certificates for the host). */
export interface MqttTlsMaterial {
  ca?: Buffer[]
  cert?: Buffer
  key?: Buffer
  pfx?: Buffer
  passphrase?: string
}

/** JSON-safe MQTT 5 properties of a received / sent message (Buffers as text). */
export type MqttEventProperties = Record<string, unknown>

/**
 * One timeline entry.
 *  - `message`: a PUBLISH received (`in`) or sent (`out`). `payload` is the
 *    text, or base64 when `binary` (not valid UTF-8).
 *  - `system`: a connection-level row; `event` names it (`subscribed`,
 *    `subscribe-refused`, `unsubscribed`, `server-disconnect`, `offline`,
 *    `reconnecting`, `reconnected`, `publish-failed`, `error`).
 */
export type MqttEngineEvent =
  | {
      type: 'message'
      direction: 'in' | 'out'
      topic: string
      payload: string
      binary: boolean
      qos: MqttQos
      retain: boolean
      dup?: boolean
      properties?: MqttEventProperties
      timestamp: number
    }
  | {
      type: 'system'
      event: string
      detail: string
      topic?: string
      reasonCode?: number
      timestamp: number
    }

export interface MqttClosedInfo {
  connectionId: string
  reason: string
}

export interface MqttConnectOptions {
  url: string
  /** Empty = a random id. */
  clientId?: string
  version?: MqttVersion
  username?: string
  password?: string
  settings?: Partial<MqttSettings>
  /** MQTT 5 CONNECT properties (ignored on 3.1.1). */
  properties?: MqttConnectProperties
  /** Sent only when its topic is not blank. */
  will?: MqttWireWill | null
  /** Subscribed right after CONNACK. */
  subscriptions?: MqttWireSubscription[]
  tls?: MqttTlsMaterial
  onEvent: (connectionId: string, event: MqttEngineEvent) => void
  /** The connection ended without the user disconnecting it. */
  onClose?: (info: MqttClosedInfo) => void
  /** Renderer-supplied id so `mqttCancelConnect(id)` can abort a pending connect. */
  pendingId?: string
}

export interface MqttConnectResult {
  connectionId: string
  /** The client id actually sent (generated when the request left it empty). */
  clientId: string
  url: string
  sessionPresent: boolean
  reasonCode: number
  /** CONNACK properties (MQTT 5), JSON-safe. */
  properties?: MqttEventProperties
}

interface Connection {
  client: MqttClient
  version: MqttVersion
  url: string
  onEvent: (connectionId: string, event: MqttEngineEvent) => void
  onClose?: (info: MqttClosedInfo) => void
  /** Set by `mqttDisconnect`: the close that follows is the user's. */
  userClosed: boolean
  /** The client reported a server DISCONNECT reason; used as the close reason. */
  lastReason?: string
}

const connections = new Map<string, Connection>()
/** Pending connects keyed by the renderer-supplied id (Cancel). */
const pendingConnects = new Map<string, MqttClient>()

// ─── Helpers ─────────────────────────────────────────────────────────────

/** A payload as typed → what goes on the wire (base64 / hex decoded to bytes). */
export function encodePayload(p: MqttWirePayload, what = 'Payload'): Buffer | string {
  if (isBinaryContentType(p.contentType)) {
    const res = decodeBinary(p.content, p.contentType)
    if (!res.ok) throw new Error(`${what}: ${res.error}`)
    return Buffer.from(res.bytes)
  }
  return p.content
}

const STRICT_UTF8 = new TextDecoder('utf-8', { fatal: true })

/** A received payload → text when it is valid UTF-8, else base64 (`binary`). */
export function decodePayload(buf: Buffer | string): { payload: string; binary: boolean } {
  if (typeof buf === 'string') return { payload: buf, binary: false }
  try {
    return { payload: STRICT_UTF8.decode(buf), binary: false }
  } catch {
    return { payload: bytesToBase64(new Uint8Array(buf)), binary: true }
  }
}

/** Packet properties → JSON-safe (Buffers as UTF-8 text, else base64). */
export function wireProperties(raw: unknown): MqttEventProperties | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const out: MqttEventProperties = {}
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (v === undefined) continue
    out[k] = Buffer.isBuffer(v) ? decodePayload(v).payload : v
  }
  return Object.keys(out).length > 0 ? out : undefined
}

function nonEmpty<T extends Record<string, unknown>>(o: T): T | undefined {
  const out = Object.fromEntries(
    Object.entries(o).filter(([, v]) => v !== undefined && v !== '' && v !== null),
  ) as T
  return Object.keys(out).length > 0 ? out : undefined
}

function userProps(
  rows: MqttMessageProperties['userProperties'],
): Record<string, string | string[]> | undefined {
  const map = userPropertiesMap(rows)
  return Object.keys(map).length > 0 ? map : undefined
}

/** Composer properties → MQTT.js PUBLISH properties (only what is set). */
export function publishProperties(
  p: MqttMessageProperties | undefined,
): Record<string, unknown> | undefined {
  if (!p) return undefined
  return nonEmpty({
    contentType: p.contentType || undefined,
    responseTopic: p.responseTopic || undefined,
    correlationData: p.correlationData ? Buffer.from(p.correlationData, 'utf-8') : undefined,
    messageExpiryInterval: p.messageExpiryInterval ?? undefined,
    topicAlias: p.topicAlias ?? undefined,
    payloadFormatIndicator: p.payloadFormatIndicator || undefined,
    userProperties: userProps(p.userProperties),
  })
}

function willProperties(p: MqttWillProperties | undefined): Record<string, unknown> | undefined {
  if (!p) return undefined
  return nonEmpty({
    willDelayInterval: p.willDelayInterval ?? undefined,
    messageExpiryInterval: p.messageExpiryInterval ?? undefined,
    payloadFormatIndicator: p.payloadFormatIndicator || undefined,
    contentType: p.contentType || undefined,
    responseTopic: p.responseTopic || undefined,
    correlationData: p.correlationData ? Buffer.from(p.correlationData, 'utf-8') : undefined,
    userProperties: userProps(p.userProperties),
  })
}

function connectProperties(
  p: MqttConnectProperties | undefined,
): Record<string, unknown> | undefined {
  if (!p) return undefined
  return nonEmpty({
    sessionExpiryInterval: p.sessionExpiryInterval ?? undefined,
    receiveMaximum: p.receiveMaximum ?? undefined,
    maximumPacketSize: p.maximumPacketSize ?? undefined,
    requestResponseInformation: p.requestResponseInformation || undefined,
    userProperties: userProps(p.userProperties),
  })
}

/** The MQTT.js options of a connect (exported for the tests). */
export function clientOptions(o: MqttConnectOptions, clientId: string): IClientOptions {
  const s = readMqttSettings({ ...DEFAULT_MQTT_SETTINGS, ...(o.settings ?? {}) })
  const v5 = (o.version ?? 5) === 5
  const opts: IClientOptions = {
    protocolVersion: v5 ? 5 : 4,
    clientId,
    clean: s.cleanSession,
    keepalive: s.keepAlive,
    connectTimeout: s.connectionTimeout,
    // Reconnection is switched on after CONNACK (see the module comment).
    reconnectPeriod: 0,
    rejectUnauthorized: s.strictSSL,
    resubscribe: true,
  }
  if (o.username) opts.username = o.username
  if (o.password) opts.password = o.password
  if (v5) {
    const props = connectProperties(o.properties)
    if (props) opts.properties = props
  }
  const will = o.will
  if (will && will.topic.trim()) {
    opts.will = {
      topic: will.topic,
      payload: encodePayload(will, 'Last Will payload'),
      qos: will.qos,
      retain: will.retain,
      ...(v5 && willProperties(will.properties)
        ? { properties: willProperties(will.properties) }
        : {}),
    }
  }
  const tls = o.tls
  if (tls?.ca?.length) opts.ca = tls.ca
  if (tls?.cert) opts.cert = tls.cert
  if (tls?.key) opts.key = tls.key
  if (tls?.pfx) (opts as IClientOptions & { pfx?: Buffer }).pfx = tls.pfx
  if (tls?.passphrase)
    (opts as IClientOptions & { passphrase?: string }).passphrase = tls.passphrase
  return opts
}

function reasonText(err: unknown): string {
  const e = err as { message?: unknown; code?: unknown }
  const msg = typeof e?.message === 'string' && e.message ? e.message : String(err)
  return typeof e?.code === 'string' && !msg.includes(e.code) ? `${msg} (${e.code})` : msg
}

const now = (): number => Date.now()

// ─── Connect ─────────────────────────────────────────────────────────────

export function mqttConnect(o: MqttConnectOptions): Promise<MqttConnectResult> {
  const url = normalizeMqttUrl(o.url)
  const clientId = (o.clientId ?? '').trim() || randomMqttClientId()
  const version: MqttVersion = o.version === 4 ? 4 : 5
  const settings = readMqttSettings({ ...DEFAULT_MQTT_SETTINGS, ...(o.settings ?? {}) })
  let opts: IClientOptions
  try {
    opts = clientOptions({ ...o, version }, clientId)
  } catch (e) {
    return Promise.reject(e instanceof Error ? e : new Error(String(e)))
  }

  return new Promise((resolve, reject) => {
    const connectionId = randomUUID()
    let client: MqttClient
    try {
      client = mqttConnectClient(url, opts)
    } catch (e) {
      reject(new Error(reasonText(e)))
      return
    }
    if (o.pendingId) pendingConnects.set(o.pendingId, client)

    let settled = false
    const fail = (message: string): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (o.pendingId) pendingConnects.delete(o.pendingId)
      client.removeAllListeners()
      client.on('error', () => {})
      client.end(true)
      reject(new Error(message))
    }
    // A second behind MQTT.js's own connack timer, whose error is clearer.
    const timer = setTimeout(
      () => fail(`MQTT connection timeout (${Math.round(settings.connectionTimeout / 100) / 10}s)`),
      settings.connectionTimeout + 1000,
    )

    const onError = (err: Error): void => fail(reasonText(err))
    const onClose = (): void => fail('Connection closed before the broker accepted it')
    client.once('error', onError)
    client.once('close', onClose)

    client.once('connect', (connack) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (o.pendingId) pendingConnects.delete(o.pendingId)
      // Only our own listeners: MQTT.js keeps internal ones (its reconnect
      // runs from its own 'close' listener).
      client.off('error', onError)
      client.off('close', onClose)
      const conn: Connection = {
        client,
        version,
        url,
        onEvent: o.onEvent,
        onClose: o.onClose,
        userClosed: false,
      }
      connections.set(connectionId, conn)
      attachLive(connectionId, conn, settings)
      resolve({
        connectionId,
        clientId,
        url,
        sessionPresent: connack.sessionPresent === true,
        reasonCode: connack.reasonCode ?? connack.returnCode ?? 0,
        ...(wireProperties(connack.properties)
          ? { properties: wireProperties(connack.properties) }
          : {}),
      })
      if (o.subscriptions && o.subscriptions.length > 0) {
        void mqttSubscribe(connectionId, o.subscriptions).catch(() => {
          /* reported as rows by mqttSubscribe */
        })
      }
    })
  })
}

function emit(connectionId: string, conn: Connection, event: MqttEngineEvent): void {
  try {
    conn.onEvent(connectionId, event)
  } catch {
    /* a renderer gone mid-send must not break the client */
  }
}

/** Wire an accepted connection: messages, drops, reconnection, the final close. */
function attachLive(connectionId: string, conn: Connection, settings: MqttSettings): void {
  const { client } = conn
  if (settings.autoReconnect) client.options.reconnectPeriod = MQTT_RECONNECT_PERIOD_MS

  client.on('message', (topic, payload, packet) => {
    emit(connectionId, conn, {
      type: 'message',
      direction: 'in',
      topic,
      ...decodePayload(payload),
      qos: packet.qos,
      retain: packet.retain === true,
      dup: packet.dup === true,
      ...(wireProperties(packet.properties)
        ? { properties: wireProperties(packet.properties) }
        : {}),
      timestamp: now(),
    })
  })
  // MQTT 5: the broker sent DISCONNECT with a reason code.
  client.on('disconnect', (packet) => {
    const rc = packet.reasonCode ?? 0
    const reason = packet.properties?.reasonString
    conn.lastReason = `server DISCONNECT (reason ${rc}${reason ? `: ${reason}` : ''})`
    emit(connectionId, conn, {
      type: 'system',
      event: 'server-disconnect',
      detail: conn.lastReason,
      reasonCode: rc,
      timestamp: now(),
    })
  })
  client.on('error', (err) => {
    conn.lastReason = reasonText(err)
    // A failing reconnection attempt repeats every period: its row says it all.
    if (client.reconnecting) return
    emit(connectionId, conn, {
      type: 'system',
      event: 'error',
      detail: conn.lastReason,
      timestamp: now(),
    })
  })
  client.on('offline', () => {
    if (connections.get(connectionId) !== conn || conn.userClosed) return
    emit(connectionId, conn, {
      type: 'system',
      event: 'offline',
      detail: conn.lastReason ?? 'connection lost',
      timestamp: now(),
    })
  })
  client.on('reconnect', () => {
    if (connections.get(connectionId) !== conn || conn.userClosed) return
    emit(connectionId, conn, {
      type: 'system',
      event: 'reconnecting',
      detail: '',
      timestamp: now(),
    })
  })
  client.on('connect', () => {
    if (connections.get(connectionId) !== conn) return
    conn.lastReason = undefined
    emit(connectionId, conn, {
      type: 'system',
      event: 'reconnected',
      detail: conn.url,
      timestamp: now(),
    })
  })
  client.on('close', () => {
    if (connections.get(connectionId) !== conn || conn.userClosed) return
    // Reconnection configured and not given up (a refused CONNACK suppresses
    // it): the client tries again.
    const suppressed = (client as unknown as { reconnectSuppressed?: boolean }).reconnectSuppressed
    if ((client.options.reconnectPeriod ?? 0) > 0 && !client.disconnecting && !suppressed) return
    connections.delete(connectionId)
    const reason = conn.lastReason ?? 'connection closed'
    client.removeAllListeners()
    client.on('error', () => {})
    client.end(true)
    try {
      conn.onClose?.({ connectionId, reason })
    } catch {
      /* ignore */
    }
  })
}

/** Abort a connect still waiting for CONNACK. */
export function mqttCancelConnect(pendingId: string): boolean {
  const client = pendingConnects.get(pendingId)
  if (!client) return false
  pendingConnects.delete(pendingId)
  try {
    // A forced close: the pending promise rejects through its `close` path.
    client.end(true)
  } catch {
    /* best-effort */
  }
  return true
}

/**
 * The user's disconnect: a DISCONNECT packet is sent, so the broker does not
 * publish the Last Will. Nothing is reported through `onClose`.
 */
export function mqttDisconnect(connectionId: string): boolean {
  const conn = connections.get(connectionId)
  if (!conn) return false
  conn.userClosed = true
  connections.delete(connectionId)
  try {
    conn.client.end(false)
  } catch {
    conn.client.end(true)
  }
  return true
}

function live(connectionId: string): Connection {
  const conn = connections.get(connectionId)
  if (!conn || !conn.client.connected) throw new Error('Not connected')
  return conn
}

/** Publish one message. Resolves when the broker acknowledged it (QoS 1 / 2) or it was written (QoS 0). */
export async function mqttPublish(connectionId: string, msg: MqttWirePublish): Promise<void> {
  const conn = live(connectionId)
  if (!msg.topic.trim() && !(conn.version === 5 && msg.properties?.topicAlias))
    throw new Error('Topic is required')
  const payload = encodePayload(msg)
  const properties = conn.version === 5 ? publishProperties(msg.properties) : undefined
  const sent: MqttEngineEvent = {
    type: 'message',
    direction: 'out',
    topic: msg.topic,
    ...decodePayload(typeof payload === 'string' ? Buffer.from(payload, 'utf-8') : payload),
    qos: msg.qos,
    retain: msg.retain,
    ...(properties ? { properties: wireProperties(properties) } : {}),
    timestamp: now(),
  }
  return new Promise((resolve, reject) => {
    conn.client.publish(
      msg.topic,
      payload,
      { qos: msg.qos, retain: msg.retain, ...(properties ? { properties } : {}) },
      (err) => {
        if (err) {
          const detail = reasonText(err)
          emit(connectionId, conn, {
            type: 'system',
            event: 'publish-failed',
            detail,
            topic: msg.topic,
            timestamp: now(),
          })
          reject(new Error(detail))
          return
        }
        resolve()
      },
    )
    emit(connectionId, conn, sent)
  })
}

export interface MqttGrant {
  topic: string
  qos: number
  refused: boolean
}

/** Subscribe; one `subscribed` / `subscribe-refused` row per topic. */
export function mqttSubscribe(
  connectionId: string,
  subs: MqttWireSubscription[],
): Promise<MqttGrant[]> {
  const conn = live(connectionId)
  const v5 = conn.version === 5
  const list = subs.filter((s) => s.topic.trim())
  if (list.length === 0) return Promise.resolve([])
  const map: Record<string, { qos: MqttQos; nl?: boolean; rap?: boolean; rh?: number }> = {}
  for (const s of list) {
    map[s.topic] = v5
      ? {
          qos: s.qos,
          nl: s.noLocal === true,
          rap: s.retainAsPublished === true,
          rh: s.retainHandling ?? 0,
        }
      : { qos: s.qos }
  }
  return new Promise((resolve, reject) => {
    conn.client.subscribe(map, (err, granted, packet) => {
      // MQTT.js fails the whole call when ANY grant is a refusal (≥ 0x80), but
      // its SUBACK still says which topics were granted.
      const codes = (packet as { granted?: unknown } | undefined)?.granted
      const grants: MqttGrant[] | null =
        Array.isArray(codes) && codes.length === list.length
          ? list.map((s, i) => ({
              topic: s.topic,
              qos: Number(codes[i]),
              refused: isRefusedGrant(Number(codes[i])),
            }))
          : !err && granted
            ? granted.map((g) => ({ topic: g.topic, qos: g.qos, refused: isRefusedGrant(g.qos) }))
            : null
      if (!grants) {
        const detail = reasonText(err)
        for (const s of list)
          emit(connectionId, conn, {
            type: 'system',
            event: 'subscribe-refused',
            detail,
            topic: s.topic,
            timestamp: now(),
          })
        reject(new Error(detail))
        return
      }
      for (const g of grants)
        emit(connectionId, conn, {
          type: 'system',
          event: g.refused ? 'subscribe-refused' : 'subscribed',
          detail: g.refused ? `reason ${g.qos}` : `QoS ${g.qos}`,
          topic: g.topic,
          reasonCode: g.qos,
          timestamp: now(),
        })
      resolve(grants)
    })
  })
}

export function mqttUnsubscribe(connectionId: string, topics: string[]): Promise<void> {
  const conn = live(connectionId)
  const list = topics.filter((t) => t.trim())
  if (list.length === 0) return Promise.resolve()
  return new Promise((resolve, reject) => {
    conn.client.unsubscribe(list, (err) => {
      if (err) {
        reject(new Error(reasonText(err)))
        return
      }
      for (const topic of list)
        emit(connectionId, conn, {
          type: 'system',
          event: 'unsubscribed',
          detail: '',
          topic,
          timestamp: now(),
        })
      resolve()
    })
  })
}

export function mqttIsConnected(connectionId: string): boolean {
  return connections.get(connectionId)?.client.connected === true
}

export function mqttDisconnectAll(): void {
  for (const id of [...connections.keys()]) mqttDisconnect(id)
  for (const id of [...pendingConnects.keys()]) mqttCancelConnect(id)
}
