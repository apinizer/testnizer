/**
 * MQTT IPC (issue #284): connect / cancel / disconnect / publish / subscribe /
 * unsubscribe over `mqtt.engine.ts`, every handler `{success, data?, error?}`.
 *
 *  - Events go to the renderer that opened the connection (`event.sender`),
 *    tagged with `connectionId` — the store routes them to the owning tab
 *    (issue #76 class). A close the user did not ask for is a dedicated
 *    `mqtt:closed` push (the #275 rule).
 *  - When that renderer reloads, crashes or closes, its connections end
 *    (`lib/sender-lifecycle.ts`) — nothing is left publishing for a page that
 *    is gone.
 *  - History and Console go through the shared masking: the password is never
 *    put in a snapshot and is passed as a secret value to scrub everywhere
 *    (`extra_secrets`, Console `secrets`).
 *  - `mqtts://` / `wss://` use the project's certificates for the host —
 *    THE cert loader the HTTP Send and the Runner use (`loadCertificatesFor`),
 *    which keeps a client chain out of `ca`.
 */
import { ipcMain, type IpcMainInvokeEvent } from 'electron'
import {
  mqttCancelConnect,
  mqttConnect,
  mqttDisconnect,
  mqttPublish,
  mqttSubscribe,
  mqttUnsubscribe,
  type MqttEngineEvent,
  type MqttTlsMaterial,
} from '../protocols/mqtt.engine'
import { logEvent, logRequestResponse } from '../lib/console-logger'
import * as historyRepo from '../db/history.repo'
import { loadCertificatesFor } from './request.handler'
import { onSenderGone, type SenderLike } from '../lib/sender-lifecycle'
import type { HistoryConfigured } from '../../shared/history-snapshot'
import {
  isMqttContentType,
  isMqttQos,
  isSecureMqttUrl,
  normalizeMqttUrl,
  readConnectProperties,
  readMessageProperties,
  readMqttSettings,
  readWillProperties,
  type MqttConnectProperties,
  type MqttSettings,
  type MqttVersion,
  type MqttWirePublish,
  type MqttWireSubscription,
  type MqttWireWill,
} from '../../shared/mqtt'
import { bytesFromBase64, utf8Length } from '../../shared/realtime'

interface MqttConnectPayload {
  url: string
  clientId?: string
  version?: MqttVersion
  username?: string
  password?: string
  settings?: Partial<MqttSettings>
  properties?: MqttConnectProperties
  will?: MqttWireWill | null
  subscriptions?: MqttWireSubscription[]
  _tabId?: string
  _workspaceId?: string
  _projectId?: string
  _endpointId?: string
  /** Renderer-supplied id so `mqtt:cancelConnect(id)` can abort the connect. */
  _pendingId?: string
  /** Editor state (`{{var}}` kept) for History reopen (issues #182, #195). */
  _configured?: HistoryConfigured
}

interface Ctx {
  url: string
  connectedAt: number
  senderId: number
  tabId?: string
  /** Scrubbed from every Console entry of the connection. */
  secrets: string[]
}

const contexts = new Map<string, Ctx>()
const watched = new Set<number>()

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)
const str = (v: unknown): string => (typeof v === 'string' ? v : '')

function truncate(s: string, max = 80): string {
  return s.length > max ? `${s.slice(0, max)}…` : s
}

/** Untrusted IPC → a will the engine accepts (undefined = none). */
function readWill(raw: unknown): MqttWireWill | undefined {
  if (!isRecord(raw) || !str(raw.topic).trim()) return undefined
  return {
    topic: str(raw.topic),
    content: str(raw.content),
    contentType: isMqttContentType(raw.contentType) ? raw.contentType : 'text',
    qos: isMqttQos(raw.qos) ? raw.qos : 0,
    retain: raw.retain === true,
    properties: readWillProperties(raw.properties),
  }
}

function readSubscriptions(raw: unknown): MqttWireSubscription[] {
  if (!Array.isArray(raw)) return []
  return raw
    .filter(isRecord)
    .filter((s) => str(s.topic).trim())
    .map((s) => ({
      topic: str(s.topic).trim(),
      qos: isMqttQos(s.qos) ? s.qos : 0,
      noLocal: s.noLocal === true,
      retainAsPublished: s.retainAsPublished === true,
      retainHandling: s.retainHandling === 1 || s.retainHandling === 2 ? s.retainHandling : 0,
    }))
}

function readPublish(raw: unknown): MqttWirePublish {
  const r = isRecord(raw) ? raw : {}
  return {
    topic: str(r.topic),
    content: str(r.content),
    contentType: isMqttContentType(r.contentType) ? r.contentType : 'text',
    qos: isMqttQos(r.qos) ? r.qos : 0,
    retain: r.retain === true,
    properties: readMessageProperties(r.properties),
  }
}

/** The project's certificates for an mqtts:// / wss:// broker; `{}` for plain transports. */
function tlsFor(
  projectId: string | undefined,
  url: string,
): { tls?: MqttTlsMaterial; error?: string } {
  if (!isSecureMqttUrl(url)) return {}
  const { certificates, error } = loadCertificatesFor(projectId, url)
  if (error) return { error }
  if (!certificates) return {}
  const c = certificates.clientCert
  return {
    tls: {
      ...(certificates.caCerts?.length ? { ca: certificates.caCerts } : {}),
      ...(c?.pfx ? { pfx: c.pfx } : {}),
      ...(c?.cert ? { cert: c.cert } : {}),
      ...(c?.key ? { key: c.key } : {}),
      ...(c?.passphrase ? { passphrase: c.passphrase } : {}),
    },
  }
}

/** Console line of one timeline event (masked in `emitConsoleEntry`). */
function logTimeline(connectionId: string, e: MqttEngineEvent): void {
  const ctx = contexts.get(connectionId)
  const durationMs = ctx ? Date.now() - ctx.connectedAt : undefined
  if (e.type === 'message') {
    const arrow = e.direction === 'in' ? '←' : '→'
    const decoded = e.binary ? bytesFromBase64(e.payload) : null
    const size = decoded?.ok ? decoded.bytes.length : undefined
    logEvent({
      protocol: 'mqtt',
      category: 'event',
      direction: e.direction,
      eventName: e.topic,
      message: e.binary
        ? `MQTT ${arrow} ${e.topic}: <binary ${size ?? 0} bytes>`
        : `MQTT ${arrow} ${e.topic}: ${truncate(e.payload)}`,
      body: e.binary ? undefined : e.payload,
      url: ctx?.url,
      tabId: ctx?.tabId,
      sizeBytes: e.binary ? size : utf8Length(e.payload),
      durationMs,
      meta: { qos: e.qos, retain: e.retain },
      secrets: ctx?.secrets,
    })
    return
  }
  const bad = /refused|failed|error|disconnect|offline/.test(e.event)
  logEvent({
    protocol: 'mqtt',
    category: 'connection',
    level: bad ? 'warning' : 'info',
    message: `MQTT ${e.event}${e.topic ? ` ${e.topic}` : ''}${e.detail ? `: ${e.detail}` : ''}`,
    url: ctx?.url,
    tabId: ctx?.tabId,
    durationMs,
    secrets: ctx?.secrets,
  })
}

function sendTo(event: IpcMainInvokeEvent, channel: string, payload: unknown): void {
  const sender = event.sender as unknown as {
    isDestroyed?: () => boolean
    send: (c: string, p: unknown) => void
  }
  try {
    if (sender.isDestroyed?.()) return
    sender.send(channel, payload)
  } catch {
    /* the window is going away */
  }
}

/** End every connection of a renderer that reloaded, crashed or closed. */
function watchSender(event: IpcMainInvokeEvent): void {
  const sender = event.sender as unknown as SenderLike | undefined
  if (!sender || watched.has(sender.id)) return
  watched.add(sender.id)
  const id = sender.id
  onSenderGone(sender, (destroyed) => {
    for (const [connectionId, ctx] of contexts) {
      if (ctx.senderId !== id) continue
      mqttDisconnect(connectionId)
      contexts.delete(connectionId)
    }
    if (destroyed) watched.delete(id)
  })
}

export function registerMqttHandlers(): void {
  ipcMain.handle('mqtt:connect', async (event, payload: MqttConnectPayload) => {
    const started = Date.now()
    const url = normalizeMqttUrl(str(payload?.url))
    const password = str(payload?.password)
    const secrets = password ? [password] : []
    const settings = readMqttSettings(payload?.settings)
    const subscriptions = readSubscriptions(payload?.subscriptions)
    const version: MqttVersion = payload?.version === 4 ? 4 : 5
    const snapshot = {
      url,
      clientId: str(payload?.clientId),
      version,
      username: str(payload?.username),
      // Never the password itself — only that one was sent.
      hasPassword: password !== '',
      settings,
      subscriptions,
      ...(payload?._configured ? { configured: payload._configured } : {}),
    }
    const history = (status: number, response: unknown): void => {
      try {
        historyRepo.addHistory({
          workspace_id: payload?._workspaceId,
          project_id: payload?._projectId,
          endpoint_id: payload?._endpointId,
          protocol: 'mqtt',
          method: 'CONNECT',
          url,
          status_code: status,
          duration_ms: Date.now() - started,
          request_snapshot: JSON.stringify(snapshot),
          extra_secrets: secrets,
          response_snapshot: JSON.stringify(response),
        })
      } catch {
        /* never propagate history failures */
      }
    }
    const fail = (message: string): { success: false; error: string } => {
      logRequestResponse({
        protocol: 'mqtt',
        method: 'CONNECT',
        url,
        status: -1,
        statusText: message,
        durationMs: Date.now() - started,
        error: { message },
        tabId: payload?._tabId,
        secrets,
      })
      history(-1, { error: message })
      return { success: false, error: message }
    }
    try {
      if (!url) return fail('Broker URL is required')
      const { tls, error } = tlsFor(payload?._projectId, url)
      if (error) return fail(error)
      watchSender(event)
      const res = await mqttConnect({
        url,
        clientId: str(payload?.clientId),
        version,
        username: str(payload?.username) || undefined,
        password: password || undefined,
        settings,
        properties: readConnectProperties(payload?.properties),
        will: readWill(payload?.will) ?? null,
        subscriptions,
        tls,
        pendingId: payload?._pendingId,
        onEvent: (connectionId, e) => {
          sendTo(event, 'mqtt:event', { connectionId, ...e })
          logTimeline(connectionId, e)
        },
        onClose: ({ connectionId, reason }) => {
          const ctx = contexts.get(connectionId)
          contexts.delete(connectionId)
          sendTo(event, 'mqtt:closed', { connectionId, reason })
          logEvent({
            protocol: 'mqtt',
            category: 'connection',
            level: 'warning',
            direction: 'in',
            message: `MQTT connection closed by the broker: ${reason}`,
            url: ctx?.url,
            tabId: ctx?.tabId,
            durationMs: ctx ? Date.now() - ctx.connectedAt : undefined,
            secrets: ctx?.secrets,
          })
        },
      })
      contexts.set(res.connectionId, {
        url,
        connectedAt: Date.now(),
        senderId: (event.sender as unknown as SenderLike).id,
        tabId: payload?._tabId,
        secrets,
      })
      const response = {
        status: 'connected',
        connectionId: res.connectionId,
        clientId: res.clientId,
        sessionPresent: res.sessionPresent,
        reasonCode: res.reasonCode,
        ...(res.properties ? { properties: res.properties } : {}),
      }
      logRequestResponse({
        protocol: 'mqtt',
        method: 'CONNECT',
        url,
        status: 0,
        statusText: 'connected',
        durationMs: Date.now() - started,
        responseBody: JSON.stringify(response),
        tabId: payload?._tabId,
        meta: { clientId: res.clientId, version: version === 5 ? '5.0' : '3.1.1' },
        secrets,
      })
      history(0, response)
      return { success: true, data: res }
    } catch (e) {
      return fail((e as Error).message)
    }
  })

  ipcMain.handle('mqtt:cancelConnect', (_event, pendingId: string) => {
    const ok = mqttCancelConnect(str(pendingId))
    if (ok)
      logEvent({
        protocol: 'mqtt',
        category: 'connection',
        message: 'MQTT connect cancelled by user',
      })
    return { success: true, data: { canceled: ok } }
  })

  ipcMain.handle('mqtt:disconnect', (_event, connectionId: string) => {
    try {
      const ctx = contexts.get(connectionId)
      const ok = mqttDisconnect(connectionId)
      contexts.delete(connectionId)
      if (ok)
        logEvent({
          protocol: 'mqtt',
          category: 'connection',
          direction: 'out',
          message: `MQTT disconnected${ctx?.url ? ` ← ${ctx.url}` : ''}`,
          url: ctx?.url,
          tabId: ctx?.tabId,
          durationMs: ctx ? Date.now() - ctx.connectedAt : undefined,
          secrets: ctx?.secrets,
        })
      return { success: true, data: ok }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })

  ipcMain.handle('mqtt:publish', async (_event, connectionId: string, raw: unknown) => {
    try {
      await mqttPublish(connectionId, readPublish(raw))
      return { success: true, data: true }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })

  ipcMain.handle('mqtt:subscribe', async (_event, connectionId: string, raw: unknown) => {
    try {
      return { success: true, data: await mqttSubscribe(connectionId, readSubscriptions(raw)) }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })

  ipcMain.handle('mqtt:unsubscribe', async (_event, connectionId: string, topics: unknown) => {
    try {
      const list = Array.isArray(topics)
        ? topics.filter((t): t is string => typeof t === 'string')
        : []
      await mqttUnsubscribe(connectionId, list)
      return { success: true, data: true }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })
}
