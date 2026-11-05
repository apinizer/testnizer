/**
 * GraphQL subscriptions over WebSocket: IPC over `graphql-ws.engine.ts`, every
 * handler `{success, data?, error?}`.
 *
 *  - The renderer picks the connection id, so it can filter events before the
 *    connect returns. Events go to the renderer that connected (`event.sender`)
 *    tagged with that id; the store routes them to the tab that started.
 *  - That renderer reloading, crashing or closing ends its sockets
 *    (`lib/sender-lifecycle.ts`).
 *  - One History row per attempt, Console entries for the connection and every
 *    frame, all through the shared masking. Beyond the name rule, the connection's
 *    credential values go along by value (`extra_secrets`, Console `secrets`), so a
 *    server that echoes one under a neutral name is masked too.
 *  - Failure text sent to the renderer is scrubbed of those values as well. Data
 *    frames are not: the live log shows what the server sent, like a response pane.
 *  - SSL verification and TLS come resolved by the chain GraphQL Send uses
 *    (`networkPayload`); certificates by the loader HTTP and MQTT use.
 */
import { ipcMain, type IpcMainInvokeEvent } from 'electron'
import {
  gqlWsCancelConnect,
  gqlWsConnect,
  gqlWsDisconnect,
  gqlWsFailureOf,
  type GqlWsConnectOptions,
} from '../protocols/graphql-ws.engine'
import { logEvent, logRequestResponse } from '../lib/console-logger'
import { getConnectionErrorInfo, type ConnectionErrorInfo } from '../lib/error-classifier'
import {
  collectCredentialValues,
  proxySecretValues,
  scrubberFor,
  type Scrubber,
} from '../lib/sensitive-scrub'
import { resolveConnectionProxy, type ResolvedProxy } from '../lib/proxy-tunnel'
import type { ProxySetting } from '../../shared/request-settings'
import { resolveTlsPayload, type TlsPayload } from '../lib/tls-presets'
import { onSenderGone, type SenderLike } from '../lib/sender-lifecycle'
import { getDb } from '../db/database'
import * as historyRepo from '../db/history.repo'
import { certificateTlsMaterial, loadCertificatesFor } from './request.handler'
import type { HistoryConfigured } from '../../shared/history-snapshot'
import { subscriptionPayload } from '../../shared/graphql-row'
import {
  gqlWsCloseText,
  gqlWsTextEn,
  parseConnectionInit,
  toGraphqlWsUrl,
  type GqlWsEvent,
  type GqlWsFailure,
} from '../../shared/graphql-ws'

interface GraphqlWsConnectPayload {
  connectionId: string
  url: string
  headers?: Record<string, string>
  query: string
  /** The Variables field as typed, `{{var}}` resolved. */
  variables?: string
  /** The connection_init field as typed, `{{var}}` resolved. */
  connectionInit?: string
  /** Which operation of the document runs; only for a document with several. */
  operationName?: string
  sslVerification?: boolean
  tls?: TlsPayload
  /** The project → app proxy (`effectiveProxy`); absent = the environment's. */
  proxy?: ProxySetting
  _tabId?: string
  _workspaceId?: string
  _projectId?: string
  _endpointId?: string
  /** Editor state (`{{var}}` kept), what reopening the History row restores. */
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

const str = (v: unknown): string => (typeof v === 'string' ? v : '')

function truncate(s: string, max = 80): string {
  return s.length > max ? `${s.slice(0, max)}…` : s
}

function sendTo(event: IpcMainInvokeEvent, payload: GqlWsEvent): void {
  const sender = event.sender as unknown as {
    isDestroyed?: () => boolean
    send: (c: string, p: unknown) => void
  }
  try {
    if (sender.isDestroyed?.()) return
    sender.send('graphqlWs:event', payload)
  } catch {
    /* the window is going away */
  }
}

/** End every socket of a renderer that reloaded, crashed or closed. */
function watchSender(event: IpcMainInvokeEvent): void {
  const sender = event.sender as unknown as SenderLike | undefined
  if (!sender || watched.has(sender.id)) return
  watched.add(sender.id)
  const id = sender.id
  onSenderGone(sender, (destroyed) => {
    for (const [connectionId, ctx] of contexts) {
      if (ctx.senderId !== id) continue
      gqlWsCancelConnect(connectionId)
      gqlWsDisconnect(connectionId)
      contexts.delete(connectionId)
    }
    if (destroyed) watched.delete(id)
  })
}

/** Server text on its way to the renderer. */
function scrubFailure(
  failure: GqlWsFailure | undefined,
  scrub: Scrubber,
): GqlWsFailure | undefined {
  return failure?.serverText ? { ...failure, serverText: scrub.text(failure.serverText) } : failure
}

function scrubInfo(
  info: ConnectionErrorInfo | undefined,
  scrub: Scrubber,
): ConnectionErrorInfo | undefined {
  if (!info) return info
  return {
    ...info,
    message: scrub.text(info.message),
    ...(info.detail ? { detail: scrub.text(info.detail) } : {}),
  }
}

/** Live event → the renderer and the Console, its failure text scrubbed. */
function forward(event: IpcMainInvokeEvent, e: GqlWsEvent, scrub: Scrubber): void {
  const ctx = contexts.get(e.connectionId)
  const common = {
    protocol: 'graphql' as const,
    url: ctx?.url,
    tabId: ctx?.tabId,
    durationMs: ctx ? Date.now() - ctx.connectedAt : undefined,
    secrets: ctx?.secrets,
  }
  if (e.type === 'data') {
    sendTo(event, e)
    logEvent({
      ...common,
      category: 'event',
      direction: 'in',
      message: `GraphQL sub ← ${truncate(e.data)}`,
      body: e.data,
      sizeBytes: Buffer.byteLength(e.data, 'utf-8'),
    })
    return
  }
  if (e.type === 'error') {
    const message = scrub.text(e.message)
    sendTo(event, { ...e, message, ...(e.data ? { data: scrub.text(e.data) } : {}) })
    logEvent({
      ...common,
      category: 'event',
      level: 'error',
      direction: 'in',
      message: `GraphQL sub error: ${message}`,
      body: e.data,
      error: { message },
    })
    return
  }
  const closeReason = e.closeReason ? scrub.text(e.closeReason) : e.closeReason
  sendTo(event, { ...e, ...(closeReason !== undefined ? { closeReason } : {}) })
  logEvent({
    ...common,
    category: 'connection',
    level: e.reason === 'complete' ? 'info' : 'warning',
    direction: 'in',
    message:
      e.reason === 'close'
        ? `GraphQL subscription closed by the server: ${gqlWsCloseText(e.code, closeReason, gqlWsTextEn)}`
        : e.reason === 'complete'
          ? 'GraphQL subscription completed by the server'
          : 'GraphQL subscription ended by a server error',
  })
  contexts.delete(e.connectionId)
}

export function registerGraphqlWsHandlers(): void {
  ipcMain.handle('graphqlWs:connect', async (event, payload: GraphqlWsConnectPayload) => {
    const started = Date.now()
    const url = toGraphqlWsUrl(str(payload?.url))
    const connectionId = str(payload?.connectionId)
    const query = str(payload?.query)
    const variables = str(payload?.variables)
    const connectionInitText = str(payload?.connectionInit)
    const operationName = str(payload?.operationName) || undefined
    const headers = payload?.headers ?? {}
    let proxy: ResolvedProxy | null = null
    let proxyProblem = ''
    try {
      proxy = resolveConnectionProxy(payload?.proxy, url)
    } catch (e) {
      proxyProblem = (e as Error).message
    }
    const secrets = [
      ...collectCredentialValues({
        url,
        headers,
        variables,
        connectionInit: connectionInitText,
      }),
      ...proxySecretValues(proxy),
    ]
    const scrub = scrubberFor(getDb(), secrets)
    const snapshot = {
      url,
      headers,
      query,
      variables,
      ...(operationName ? { operationName } : {}),
      ...(connectionInitText ? { connectionInit: connectionInitText } : {}),
      ...(payload?._configured ? { configured: payload._configured } : {}),
    }
    const history = (status: number, response: unknown): void => {
      try {
        historyRepo.addHistory({
          workspace_id: payload?._workspaceId,
          project_id: payload?._projectId,
          endpoint_id: payload?._endpointId,
          protocol: 'graphql',
          method: 'SUBSCRIBE',
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
    const fail = (
      raw: string,
      errorInfo?: ConnectionErrorInfo,
      failure?: GqlWsFailure,
    ): {
      success: false
      error: string
      errorInfo?: ConnectionErrorInfo
      failure?: GqlWsFailure
    } => {
      const message = scrub.text(raw)
      logRequestResponse({
        protocol: 'graphql',
        method: 'SUBSCRIBE',
        url,
        status: -1,
        statusText: message,
        durationMs: Date.now() - started,
        error: { message },
        tabId: payload?._tabId,
        secrets,
      })
      history(-1, { error: message })
      return {
        success: false,
        error: message,
        ...(errorInfo ? { errorInfo: scrubInfo(errorInfo, scrub) } : {}),
        ...(failure ? { failure: scrubFailure(failure, scrub) } : {}),
      }
    }

    try {
      if (!connectionId) return fail('A connection id is required')
      if (!url) return fail('The GraphQL endpoint URL is required')
      if (proxyProblem) return fail(proxyProblem)
      const init = parseConnectionInit(connectionInitText)
      if (!init.ok) return fail('The connection_init payload is not a JSON object')

      const certs = url.toLowerCase().startsWith('wss:')
        ? loadCertificatesFor(payload?._projectId, url)
        : {}
      if (certs.error) return fail(certs.error)
      const tlsLimits = resolveTlsPayload(payload?.tls)
      const tls: GqlWsConnectOptions['tls'] = {
        ...(certs.certificates ? certificateTlsMaterial(certs.certificates) : {}),
        ...(tlsLimits ?? {}),
      }

      watchSender(event)
      contexts.set(connectionId, {
        url,
        connectedAt: started,
        senderId: (event.sender as unknown as SenderLike).id,
        tabId: payload?._tabId,
        secrets,
      })
      logEvent({
        protocol: 'graphql',
        category: 'connection',
        direction: 'out',
        message: `GraphQL subscription connecting → ${url}`,
        url,
        tabId: payload?._tabId,
        body: JSON.stringify({
          query,
          ...(operationName ? { operationName } : {}),
          variables,
          connectionInit: connectionInitText,
        }),
        secrets,
      })

      let info
      try {
        info = await gqlWsConnect({
          connectionId,
          url,
          headers,
          payload: subscriptionPayload(query, variables, operationName),
          ...(init.value ? { connectionInit: init.value } : {}),
          rejectUnauthorized: payload?.sslVerification !== false,
          tls,
          proxy,
          onEvent: (e) => forward(event, e, scrub),
        })
      } catch (e) {
        contexts.delete(connectionId)
        return fail((e as Error).message, getConnectionErrorInfo(e), gqlWsFailureOf(e))
      }

      const ctx = contexts.get(connectionId)
      if (ctx) ctx.connectedAt = info.connectedAt
      const response = {
        status: 101,
        statusText: 'Switching Protocols',
        connectionId,
        subprotocol: info.protocol,
        connectedAt: info.connectedAt,
      }
      logRequestResponse({
        protocol: 'graphql',
        method: 'SUBSCRIBE',
        url,
        status: 101,
        statusText: 'Switching Protocols',
        durationMs: Date.now() - started,
        requestHeaders: headers,
        tabId: payload?._tabId,
        meta: { subprotocol: info.protocol },
        secrets,
      })
      history(101, response)
      return { success: true, data: info }
    } catch (e) {
      contexts.delete(connectionId)
      return fail((e as Error).message)
    }
  })

  ipcMain.handle('graphqlWs:cancelConnect', (_event, connectionId: string) => {
    // Cancel can cross the ack on its way here: whichever state the id is in, it ends.
    const id = str(connectionId)
    const canceled = gqlWsCancelConnect(id) || gqlWsDisconnect(id)
    const ctx = contexts.get(id)
    contexts.delete(id)
    if (canceled) {
      logEvent({
        protocol: 'graphql',
        category: 'connection',
        direction: 'out',
        message: 'GraphQL subscription cancelled by user',
        url: ctx?.url,
        tabId: ctx?.tabId,
        secrets: ctx?.secrets,
      })
    }
    return { success: true, data: { canceled } }
  })

  ipcMain.handle('graphqlWs:disconnect', (_event, connectionId: string) => {
    try {
      const id = str(connectionId)
      const ctx = contexts.get(id)
      const ok = gqlWsDisconnect(id)
      contexts.delete(id)
      if (ok) {
        logEvent({
          protocol: 'graphql',
          category: 'connection',
          direction: 'out',
          message: `GraphQL unsubscribed${ctx?.url ? ` ← ${ctx.url}` : ''}`,
          url: ctx?.url,
          tabId: ctx?.tabId,
          durationMs: ctx ? Date.now() - ctx.connectedAt : undefined,
          secrets: ctx?.secrets,
        })
      }
      return { success: true, data: ok }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })
}
