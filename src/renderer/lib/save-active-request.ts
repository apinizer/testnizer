// In-place save for the active request tab.
//
// Ctrl+S used to always open EndpointSaveModal — even when the tab was
// already backed by a saved_request or test_suite_item. The modal then
// asked the user to pick a folder, and on a Test Suite item the folder
// tree it surfaced was the APIs tree, which made it possible to save a
// Test Suite item into APIs by accident (or save nothing at all when no
// folder was picked). This helper is the "I already know where this row
// lives, just persist the edit" path, shared by the keyboard shortcut
// handler and EndpointSaveModal's update branch.

import { useTabsStore } from '../stores/tabs.store'
import { useRequestStore } from '../stores/request.store'
import { useSoapStore } from '../stores/soap.store'
import { isManualSoapMeta } from '../../shared/soap-transport'
import { useWebSocketStore } from '../stores/websocket.store'
import { useSseStore } from '../stores/sse.store'
import { useSocketIOStore } from '../stores/socketio.store'
import { useMqttStore } from '../stores/mqtt.store'
import { useGrpcStore } from '../stores/grpc.store'
import { useGraphQLStore } from '../stores/graphql.store'
import { restoreMcpCall, useMcpStore, type McpTransport } from '../stores/mcp.store'
import { restoreAiConfig, savedAiConfigOf, useAiChatStore } from '../stores/ai-chat.store'
import { readSavedMcpCall, savedCallOf } from '../stores/mcp-call.slice'
import { normalizeMcpAuth } from '../stores/mcp-auth.slice'
import { normalizeMcpProtocol } from './mcp-protocol'
import { useWorkspaceStore } from '../stores/workspace.store'
import { stripWsSecuritySecrets } from './key-material'
import { autoRequestName } from './endpoint-name'
import {
  ensureWithheldCredentialsLoaded,
  isTabUnloaded,
  NOT_LOADED_ERROR,
} from './withheld-credentials'
import { orphanTab } from './orphan-tab'
import {
  mqttMetaOf,
  readMqttMeta,
  readSioMeta,
  readWsMeta,
  sioMetaOf,
  wsMetaOf,
} from './realtime-meta'
import { mergeParamsFromUrl } from './url-query-sync'
import type { WsSecurityConfig } from '../types'
import type { Tab, KeyValuePair } from '../types'
import type { RequestSettings } from '../../shared/request-settings'
import { isRunnableProtocol } from '../../shared/request-protocols'
import { pathVariablesField, type PathVariableLike } from '../../shared/path-variables'

type SseHttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

export interface InPlaceSaveResult {
  success: boolean
  error?: string
  /** True when no in-place row was found (caller should fall back to modal). */
  notApplicable?: boolean
  /**
   * The tab WAS bound to a row that no longer exists (deleted from the
   * sidebar, dropped by a git switch / pull — issue #269). The tab has been
   * unbound and kept dirty; the caller opens Save As and says why
   * (`toast.requestOrphaned`). Always comes with `notApplicable`.
   */
  orphaned?: boolean
}

/** The update IPC answered that its row does not exist (main's `notFound` marker). */
type UpdateEnvelope = { success: boolean; error?: string; notFound?: boolean } | undefined

/** Unbind the active tab from its vanished row; never marks it clean (issue #269). */
function orphaned(tabId: string): InPlaceSaveResult {
  orphanTab(tabId)
  return { success: false, notApplicable: true, orphaned: true }
}

export interface ProtocolSnapshot {
  effectiveUrl: string
  effectiveMethod: string
  effectiveBody: unknown
  protocolMeta: Record<string, unknown>
}

/**
 * Read the per-protocol overrides off the matching store (SOAP / WS /
 * SSE / Socket.IO / gRPC) and collapse them into the shape the save
 * payload expects. Exported so EndpointSaveModal's "Save As" branch can
 * use the same projection — without sharing this, a new protocol would
 * have to be wired into both places to be persisted correctly.
 */
export function snapshotProtocol(tab: Tab): ProtocolSnapshot {
  const url = useRequestStore.getState().url
  const method = useRequestStore.getState().method
  const body = useRequestStore.getState().body
  const protocol = (tab.protocol ?? 'http') as string
  const protocolMeta: Record<string, unknown> = {}

  if (protocol === 'soap') {
    const soap = useSoapStore.getState()
    return {
      effectiveUrl: soap.endpointUrl || soap.wsdlUrl || url,
      effectiveMethod: 'POST',
      effectiveBody: { type: 'xml', content: soap.rawXml },
      protocolMeta: {
        soap: {
          wsdlUrl: soap.wsdlUrl,
          selectedService: soap.selectedService,
          selectedPort: soap.selectedPort,
          selectedOperation: soap.selectedOperation,
          bodyMode: soap.bodyMode,
          // WSDL-mode transport (Send ≡ Run parity): the Runner has no WSDL
          // to consult, so the operation's action and the document's version
          // travel with the row — `soapTransportFromMeta` reads exactly these.
          soapVersion: soap.parsedWsdl?.soapVersion,
          soapAction: soap.mode === 'manual' ? undefined : soap.getSelectedOperation()?.soapAction,
          // Manual-mode fields (issue #124): endpoint URL, body, SOAPAction /
          // version, operation name + namespace and the editor mode itself.
          // Before these were written, reopening a manual request showed an
          // empty URL/body and landed on WSDL Import.
          mode: soap.mode,
          endpointUrl: soap.endpointUrl,
          rawXml: soap.rawXml,
          manualSoapAction: soap.manualSoapAction,
          manualSoapVersion: soap.manualSoapVersion,
          manualOperationName: soap.manualOperationName,
          manualOperationNamespace: soap.manualOperationNamespace,
          // #60: strip the picker's WRITE-ONLY store/key passwords before the
          // config is written to `endpoints.metadata` (a plain TEXT column).
          // Identity-preserving: a config with no `keySource` is the exact
          // same object the pre-#60 code persisted.
          wsSecurity: stripWsSecuritySecrets(soap.wsSecurity),
        },
      },
    }
  }
  if (protocol === 'websocket') {
    // Carry the custom headers + composer template the user set up in the
    // WebSocket editor so a save → close → reopen restores them. The
    // legacy version dropped these because protocolMeta was empty here —
    // the user lost composer presets and any per-tab auth headers.
    const ws = useWebSocketStore.getState()
    return {
      effectiveUrl: ws.url || url,
      effectiveMethod: 'GET',
      effectiveBody: { type: 'none' },
      // One writer (`lib/realtime-meta.ts`), shared with the History row's
      // `configured`: + params, settings, saved messages (issue #282).
      protocolMeta: { websocket: wsMetaOf(ws) },
    }
  }
  if (protocol === 'sse') {
    // SSE: same gap as WS — bodyType, custom headers, eventTypeFilter
    // and lastEventId define the connection's identity but were never
    // captured. Reopen used to land on default GET/no-headers state.
    const sse = useSseStore.getState()
    return {
      effectiveUrl: sse.url || url,
      effectiveMethod: sse.method || 'GET',
      effectiveBody: { type: sse.bodyType === 'json' ? 'json' : 'text', content: sse.body },
      protocolMeta: {
        sse: {
          url: sse.url,
          method: sse.method,
          body: sse.body,
          bodyType: sse.bodyType,
          customHeaders: sse.customHeaders,
          lastEventId: sse.lastEventId,
          eventTypeFilter: sse.eventTypeFilter,
          autoScroll: sse.autoScroll,
        },
      },
    }
  }
  if (protocol === 'socketio') {
    const sio = useSocketIOStore.getState()
    return {
      effectiveUrl: sio.url || url,
      effectiveMethod: 'GET',
      effectiveBody: { type: 'none' },
      // One writer for the block (`lib/realtime-meta.ts`), shared with the
      // History row's `configured` (issue #283).
      protocolMeta: { socketio: sioMetaOf(sio) },
    }
  }
  if (protocol === 'mqtt') {
    const mqtt = useMqttStore.getState()
    return {
      effectiveUrl: mqtt.url || url,
      effectiveMethod: 'GET',
      effectiveBody: { type: 'none' },
      // One writer for the block (`lib/realtime-meta.ts`), shared with the
      // History row's `configured` and the Postman v3 import (issue #284).
      protocolMeta: { mqtt: mqttMetaOf(mqtt) },
    }
  }
  if (protocol === 'grpc') {
    const grpc = useGrpcStore.getState()
    return {
      effectiveUrl: grpc.address || url,
      effectiveMethod: 'POST',
      effectiveBody: { type: 'json', content: grpc.requestBody },
      protocolMeta: {
        grpc: {
          address: grpc.address,
          useTls: grpc.useTls,
          protoSource: grpc.protoSource,
          protoUrl: grpc.protoUrl,
          protoPath: grpc.protoPath,
          selectedService: grpc.selectedService,
          selectedMethod: grpc.selectedMethod,
          requestBody: grpc.requestBody,
          metadata: grpc.metadata,
        },
      },
    }
  }
  if (protocol === 'graphql') {
    // GraphQL was never captured here (#18) — its query/variables/headers
    // live only in useGraphQLStore, so save → close → reopen dropped the
    // query and dumped the user on the default sample. Snapshot them.
    const gql = useGraphQLStore.getState()
    return {
      effectiveUrl: gql.url || url,
      effectiveMethod: 'POST',
      effectiveBody: { type: 'graphql', content: gql.query },
      protocolMeta: {
        graphql: {
          url: gql.url,
          query: gql.query,
          variables: gql.variables,
          headers: gql.headers,
        },
      },
    }
  }
  if (protocol === 'mcp') {
    // MCP had no branch, so Ctrl+S wrote the (never-edited) request-store URL
    // and nothing else — reopening an MCP request showed a blank server URL,
    // the default transport and, since issue #137, no custom headers.
    // 'GET' matches the method TreeView stamps on a new MCP row.
    const mcp = useMcpStore.getState()
    return {
      // The MCP store is the URL's source of truth on an MCP tab — an
      // intentionally cleared URL is saved empty, not replaced by the request
      // store's stale one (issue #154).
      effectiveUrl: mcp.url,
      effectiveMethod: 'GET',
      effectiveBody: { type: 'none' },
      protocolMeta: {
        mcp: {
          transport: mcp.transport,
          url: mcp.url,
          customHeaders: mcp.customHeaders,
          // stdio server environment (issue #139) — `{{var}}` kept unresolved.
          envVars: mcp.envVars,
          // Authorization tab (MCP Auth) — `{{var}}` kept unresolved. The
          // OAuth 2.1 debugger's secret / token session are never saved.
          auth: mcp.auth,
          // Protocol era negotiation (issue #152): auto / legacy / a pin.
          protocol: mcp.protocol,
          // The call itself (issue #159): capability tab, tool + raw args
          // (`{{var}}` kept), resource URI, prompt + args.
          call: savedCallOf(mcp),
        },
      },
    }
  }
  if (protocol === 'ai') {
    // AI Chat had no branch (issue #187): Ctrl+S saved an empty row and
    // reopening showed a blank chat. The configuration is saved — provider,
    // model, endpoint URL, system prompt, headers minus credential headers,
    // temperature, max tokens. Never the API key (encrypted in main, per
    // provider — issue #188) and never the conversation.
    // 'POST' matches the method TreeView stamps on a new AI row (a chat
    // completion is a POST), so the tree badge does not flip on save.
    const ai = useAiChatStore.getState()
    return {
      effectiveUrl: ai.customUrl,
      effectiveMethod: 'POST',
      effectiveBody: { type: 'none' },
      protocolMeta: { ai: savedAiConfigOf(ai) },
    }
  }
  return { effectiveUrl: url, effectiveMethod: method, effectiveBody: body, protocolMeta }
}

/**
 * Protocols edited in the HTTP RequestEditor, whose Settings tab (timeout,
 * redirects, SSL) the request store holds. An allow-list: a protocol with its
 * own editor must not inherit HTTP's settings by falling through.
 */
const HTTP_SETTINGS_PROTOCOLS = new Set(['http'])

/**
 * The per-request settings Ctrl+S / Save As persist with the row (issue #185):
 * top-level keys of `request_schema` (endpoint, suite item) or of `metadata`
 * (saved_request) — `src/shared/request-settings.ts` documents the shape.
 * HTTP: timeout + redirects + SSL from the request store's Settings tab. MCP:
 * the timeout from the MCP store. Other protocols carry none. A `null`
 * timeout (inherit) is left out, so a cleared value does not survive.
 * `critical` (issue #304): every protocol the Runner runs (HTTP, SOAP,
 * GraphQL, MCP — `isRunnableProtocol`), from the request store; written only
 * when on, so an unmarked row's JSON is unchanged.
 */
export function requestSettingsFor(tab: Tab): RequestSettings {
  const protocol = (tab.protocol ?? 'http') as string
  const critical: RequestSettings =
    isRunnableProtocol(protocol) && useRequestStore.getState().critical ? { critical: true } : {}
  if (protocol === 'mcp') {
    const timeout = useMcpStore.getState().requestTimeout
    return { ...(timeout != null ? { timeout } : {}), ...critical }
  }
  if (!HTTP_SETTINGS_PROTOCOLS.has(protocol)) return critical
  const req = useRequestStore.getState()
  return {
    ...(req.requestTimeout != null ? { timeout: req.requestTimeout } : {}),
    followRedirects: req.followRedirects,
    maxRedirects: req.maxRedirects,
    sslVerification: req.sslVerification,
    ...critical,
  }
}

/**
 * The Path Variables rows Ctrl+S / Save As persist with the row (issue #276):
 * `{pathVariables}` next to the settings — top level of `request_schema`, or
 * of `metadata` on saved_requests. HTTP only (the request store's URL). A URL
 * without `:name` writes no key; a `:name` row left empty is stored empty and
 * still sends `:name` literally (`applyPathVariables`), exactly as before.
 */
export function pathVariablesFor(tab: Tab): { pathVariables?: PathVariableLike[] } {
  const protocol = (tab.protocol ?? 'http') as string
  if (!HTTP_SETTINGS_PROTOCOLS.has(protocol)) return {}
  return pathVariablesField(useRequestStore.getState().pathVariables)
}

/**
 * saved_requests has no `request_schema`: the settings sit at the top of its
 * `metadata` JSON next to the protocol blocks. `undefined` when there is
 * nothing to store (the update then keeps the column as it was).
 */
export function savedRequestMetadata(
  protocolMeta: Record<string, unknown>,
  settings: RequestSettings & { pathVariables?: PathVariableLike[] },
): string | undefined {
  const merged = { ...protocolMeta, ...settings }
  return Object.keys(merged).length > 0 ? JSON.stringify(merged) : undefined
}

/**
 * Settings read off a saved row (`readRequestSettings`) → the request store's
 * `loadFromEndpoint` fields. Absent keys fall back to the store's defaults.
 */
export function requestStoreSettings(s: RequestSettings): {
  requestTimeout: number | null
  followRedirects?: boolean
  maxRedirects?: number
  sslVerification?: boolean
  critical: boolean
} {
  return {
    requestTimeout: s.timeout ?? null,
    followRedirects: s.followRedirects,
    maxRedirects: s.maxRedirects,
    sslVerification: s.sslVerification,
    critical: s.critical === true,
  }
}

/**
 * Put a reopened row's settings on the protocol store that owns them — the
 * MCP store's per-tab timeout (HTTP's go through `loadFromEndpoint`). Uses
 * `setState`, not the dirty-marking setter: a restore is not an edit. Switches
 * the MCP store to the active tab first (the MST-120 race — a row without
 * metadata never reaches `restoreProtocolFromMetadata`'s switch).
 */
export function restoreRequestSettings(protocol: string, settings: RequestSettings): void {
  if (protocol !== 'mcp') return
  const activeTabId = useTabsStore.getState().activeTabId
  if (activeTabId) switchProtocolToTab(protocol, activeTabId)
  useMcpStore.setState({ requestTimeout: settings.timeout ?? null })
}

/**
 * Inverse of `snapshotProtocol`: re-hydrate the matching protocol store
 * from a metadata bag previously written by snapshotProtocol. Called from
 * `openSuiteItemTab` when a Test Suite item is opened so SOAP/Socket.IO/
 * gRPC connection settings (WSDL URL, namespace, proto path, etc.)
 * survive close + reopen. Without this round-trip the save path was
 * persisting metadata that no read path consumed.
 *
 * Tolerant: silently skips unknown protocols or malformed `metadata`.
 *
 * NOTE: this hydration path reuses the protocol stores' user-facing setters,
 * which now flag the active tab dirty (issue #8). Re-hydrating a freshly-opened
 * request must NOT leave it looking edited, so we snapshot the active tab's
 * dirty flag before restoring and put it back afterwards — the restore itself
 * is never a user edit.
 */
export function restoreProtocolFromMetadata(protocol: string, metadata: unknown): void {
  const tabs = useTabsStore.getState()
  const activeTabId = tabs.activeTabId
  const wasDirty = activeTabId
    ? (tabs.tabs.find((t) => t.id === activeTabId)?.isDirty ?? false)
    : false
  // Flip the matching protocol store to the (just-opened) active tab BEFORE
  // applying metadata (MST-120). The protocol stores are tab-scoped: each
  // keeps a `_currentTabId` and a `_tabStates` cache, and the Workbench runs
  // `switchToTab(activeTabId)` from a useEffect *after* the active tab
  // changes. openEndpointTab / openSuiteItemTab call us synchronously inside
  // the same task that set the active tab — before that effect fires — so
  // without this pre-switch our setters write into the *previous* tab's live
  // slice. Then the effect's `switchToTab` loads the new tab id, finds no
  // cache entry, and falls back to `emptyState()` — clobbering the restored
  // url/headers with the protocol default (e.g. wss://echo.websocket.org).
  // Switching first makes `_currentTabId === activeTabId`, so the setters
  // land on the right tab and the later effect call is idempotent (it
  // re-saves and re-loads the same id). Same race existed for every
  // tab-scoped protocol store; fixing it once here covers them all.
  if (activeTabId) switchProtocolToTab(protocol, activeTabId)
  applyProtocolMetadata(protocol, metadata)
  // The setters fired above may have flipped the dirty dot on; restore the
  // pre-hydration value so reopening a saved request reads as clean.
  if (activeTabId) tabs.markDirty(activeTabId, wasDirty)
}

/**
 * Point the tab-scoped store for `protocol` at `tabId` so subsequent setters
 * mutate that tab's live slice. Only the protocols whose stores carry per-tab
 * state need this; HTTP and renderer-only tool protocols are no-ops.
 */
function switchProtocolToTab(protocol: string, tabId: string): void {
  switch (protocol) {
    case 'soap':
      useSoapStore.getState().switchToTab(tabId)
      break
    case 'websocket':
      useWebSocketStore.getState().switchToTab(tabId)
      break
    case 'sse':
      useSseStore.getState().switchToTab(tabId)
      break
    case 'socketio':
      useSocketIOStore.getState().switchToTab(tabId)
      break
    case 'mqtt':
      useMqttStore.getState().switchToTab(tabId)
      break
    case 'grpc':
      useGrpcStore.getState().switchToTab(tabId)
      break
    case 'graphql':
      useGraphQLStore.getState().switchToTab(tabId)
      break
    case 'mcp':
      useMcpStore.getState().switchToTab(tabId)
      break
    case 'ai':
      useAiChatStore.getState().switchToTab(tabId)
      break
    default:
      break
  }
}

/**
 * WS-Security was snapshotted (secrets stripped) but never restored, so a
 * reopened SOAP tab always showed the default config — same "field blank
 * after reopen" class as issue #124.
 */
function restoreWsSecurity(raw: unknown): void {
  if (raw && typeof raw === 'object') {
    useSoapStore.getState().setWsSecurity(raw as Partial<WsSecurityConfig>)
  }
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v)
}

function applyProtocolMetadata(protocol: string, metadata: unknown): void {
  if (!metadata || typeof metadata !== 'object') return
  const meta = metadata as Record<string, unknown>

  if (protocol === 'soap' && meta.soap && typeof meta.soap === 'object') {
    const s = meta.soap as Record<string, unknown>
    const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined)
    // Every caller hydrates the request store BEFORE calling us, and the
    // request row's url/body were always written from the SOAP store
    // (effectiveUrl / effectiveBody). Fall back to them so rows saved before
    // the manual fields were snapshotted (issue #124) still restore their
    // URL and envelope instead of coming back blank.
    const req = useRequestStore.getState()
    const endpointUrl = str(s.endpointUrl) || req.url || ''
    const rawXml = str(s.rawXml) ?? (req.body?.type === 'xml' ? req.body.content || '' : '')
    const wsdlUrl = str(s.wsdlUrl)
    const operationName = str(s.operationName ?? s.selectedOperation)
    // Explicit mode when present; older rows have none (shared rule — the
    // Runner classifies the row with the same `isManualSoapMeta`).
    const manual = isManualSoapMeta(s)
    const soap = useSoapStore.getState()
    // The Manual form fields, restored in BOTH modes: Send falls back to the
    // manual action when the WSDL operation has none (`soapVersionAndAction`),
    // so leaving them out read whatever the tab cache held (issue #298
    // follow-up).
    const restoreManualFields = (): void => {
      const action = str(s.manualSoapAction)
      if (action !== undefined) soap.setManualSoapAction(action)
      const version = str(s.manualSoapVersion)
      if (version === 'soap11' || version === 'soap12') soap.setManualSoapVersion(version)
      const opName = str(s.manualOperationName)
      if (opName !== undefined) soap.setManualOperationName(opName)
      const opNs = str(s.manualOperationNamespace)
      if (opNs !== undefined) soap.setManualOperationNamespace(opNs)
    }

    if (manual) {
      // No `soap` meta → loadFromEndpoint takes the raw-XML branch, so no
      // synthetic WSDL is fabricated and the Manual form + raw body render.
      soap.loadFromEndpoint({ url: endpointUrl, body: { type: 'xml', content: rawXml } })
      soap.setMode('manual')
      restoreWsSecurity(s.wsSecurity)
      restoreManualFields()
      return
    }

    soap.loadFromEndpoint({
      url: endpointUrl,
      body: { type: 'xml', content: rawXml },
      soap: {
        wsdlUrl,
        // snapshotProtocol writes `selectedService/Port/Operation`;
        // SoapEndpointMeta wants `serviceName/portName/operationName`.
        // Accept both shapes so older rows still load.
        serviceName: str(s.serviceName ?? s.selectedService),
        portName: str(s.portName ?? s.selectedPort),
        operationName,
        endpointUrl,
        // The operation's action and the document's version (issue #298
        // follow-up): dropped here before, so a reopened SOAP 1.2 / `urn:Op`
        // row Sent as SOAP 1.1 with `SOAPAction: ""` while Run sent the saved
        // values. Legacy rows may also carry the operation's example/schema.
        soapAction: str(s.soapAction),
        soapVersion:
          s.soapVersion === 'soap12' || s.soapVersion === 'soap11' ? s.soapVersion : undefined,
        exampleRequest: str(s.exampleRequest),
        exampleResponse: str(s.exampleResponse),
        ...(isPlainObject(s.inputSchema) ? { inputSchema: s.inputSchema } : {}),
        ...(isPlainObject(s.outputSchema) ? { outputSchema: s.outputSchema } : {}),
      },
    })
    soap.setMode('wsdl')
    restoreWsSecurity(s.wsSecurity)
    restoreManualFields()
    return
  }

  if (protocol === 'socketio' && meta.socketio && typeof meta.socketio === 'object') {
    // One reader (`lib/realtime-meta.ts`): an old row's `subscriptions` /
    // `emitPayload` migrate, and its missing `listenAll` reads as true — the
    // behaviour it had (issue #283).
    const read = readSioMeta(meta.socketio)
    useSocketIOStore.setState({
      ...read,
      ...(read.url !== undefined && read.params === undefined
        ? { params: mergeParamsFromUrl(read.url, []) }
        : {}),
      ...(read.bearerToken !== undefined ? { bearerTokenWithheld: false } : {}),
      activeSavedMessageId: null,
    })
    return
  }

  if (protocol === 'mqtt' && meta.mqtt && typeof meta.mqtt === 'object') {
    // One reader (`lib/realtime-meta.ts`); keys the block lacks keep the tab's
    // defaults. Not an edit: `setState`, the dirty dot stays.
    useMqttStore.setState({ ...readMqttMeta(meta.mqtt), activeSavedMessageId: null })
    return
  }

  if (protocol === 'websocket' && meta.websocket && typeof meta.websocket === 'object') {
    // One reader (`lib/realtime-meta.ts`); keys an old row lacks keep the
    // tab's defaults, missing settings read as the pre-#282 behaviour.
    const read = readWsMeta(meta.websocket)
    useWebSocketStore.setState({
      ...read,
      ...(read.url !== undefined && read.params === undefined
        ? { params: mergeParamsFromUrl(read.url, []) }
        : {}),
      activeSavedMessageId: null,
    })
    return
  }

  if (protocol === 'sse' && meta.sse && typeof meta.sse === 'object') {
    const s = meta.sse as Record<string, unknown>
    const sse = useSseStore.getState()
    if (typeof s.url === 'string') sse.setUrl(s.url)
    if (typeof s.method === 'string') sse.setMethod(s.method as SseHttpMethod)
    if (typeof s.body === 'string') sse.setBody(s.body)
    if (s.bodyType === 'json' || s.bodyType === 'text') sse.setBodyType(s.bodyType)
    if (Array.isArray(s.customHeaders)) sse.setHeaders(s.customHeaders as KeyValuePair[])
    if (typeof s.lastEventId === 'string') sse.setLastEventId(s.lastEventId)
    if (typeof s.eventTypeFilter === 'string') sse.setEventTypeFilter(s.eventTypeFilter)
    if (typeof s.autoScroll === 'boolean') sse.setAutoScroll(s.autoScroll)
    return
  }

  if (protocol === 'grpc' && meta.grpc && typeof meta.grpc === 'object') {
    const g = meta.grpc as Record<string, unknown>
    const grpc = useGrpcStore.getState()
    if (typeof g.address === 'string') grpc.setAddress(g.address)
    if (typeof g.useTls === 'boolean') grpc.setUseTls(g.useTls)
    if (g.protoSource === 'reflection' || g.protoSource === 'url' || g.protoSource === 'file') {
      grpc.setProtoSource(g.protoSource)
    }
    if (typeof g.protoUrl === 'string') grpc.setProtoUrl(g.protoUrl)
    if (typeof g.requestBody === 'string') grpc.setRequestBody(g.requestBody)
    // Metadata was snapshotted but never restored, so reopened gRPC tabs lost
    // their auth / tracing metadata (found with issue #182).
    if (Array.isArray(g.metadata)) useGrpcStore.setState({ metadata: g.metadata as KeyValuePair[] })
    // `services` and `selectedService/Method` aren't restored here —
    // services need to be re-parsed by reloading the proto, otherwise
    // we'd be writing dropdown selections that the editor can't render.
    // The user clicks "Load Proto" once and selection state comes back
    // via per-tab cache. Tracked as a known limitation.
    return
  }

  if (protocol === 'graphql' && meta.graphql && typeof meta.graphql === 'object') {
    const g = meta.graphql as Record<string, unknown>
    const gql = useGraphQLStore.getState()
    if (typeof g.url === 'string') gql.setUrl(g.url)
    if (typeof g.query === 'string') gql.setQuery(g.query)
    if (typeof g.variables === 'string') gql.setVariables(g.variables)
    if (Array.isArray(g.headers)) gql.setHeaders(g.headers as KeyValuePair[])
    return
  }

  if (protocol === 'mcp' && meta.mcp && typeof meta.mcp === 'object') {
    const m = meta.mcp as Record<string, unknown>
    const mcp = useMcpStore.getState()
    if (m.transport === 'http' || m.transport === 'sse' || m.transport === 'stdio') {
      mcp.setTransport(m.transport as McpTransport)
    }
    // The row's url column is always written from the MCP store
    // (effectiveUrl), and callers hydrate the request store first — fall
    // back to it only when the meta carries no url at all. An empty string is
    // a deliberately cleared URL and is restored as such (issue #154).
    const url = typeof m.url === 'string' ? m.url : useRequestStore.getState().url
    mcp.setUrl(url ?? '')
    if (Array.isArray(m.customHeaders)) mcp.setHeaders(m.customHeaders as KeyValuePair[])
    if (Array.isArray(m.envVars)) mcp.setEnvVars(m.envVars as KeyValuePair[])
    // Rows saved before the Authorization tab carry no `auth` → No Auth.
    mcp.setAuth(normalizeMcpAuth(m.auth))
    // Rows saved before issue #152 carry no `protocol` → Auto.
    mcp.setProtocol(normalizeMcpProtocol(m.protocol))
    // Rows saved before issue #159 carry no `call` → nothing selected, as before.
    restoreMcpCall(readSavedMcpCall(m.call))
    return
  }

  if (protocol === 'ai' && meta.ai && typeof meta.ai === 'object') {
    restoreAiConfig(meta.ai)
    return
  }
}

/**
 * The APIs tree renders from the `treeData` snapshot in workspace.store and
 * is rebuilt only by `refreshTree()`. The Save button next to Send always
 * called it; the Ctrl+S path did not, so a GET→POST edit saved fine in the
 * DB while the sidebar kept showing GET until the project was reloaded.
 * Every in-place save that touches an APIs row goes through here now.
 * Best-effort: a tree refresh failure must not turn a persisted save into
 * a reported failure.
 */
async function refreshApisTree(): Promise<void> {
  try {
    await useWorkspaceStore.getState().refreshTree()
  } catch {
    /* the row is saved; the tree catches up on the next reload */
  }
}

/**
 * Persist the active tab's edits in place when the tab already maps to a
 * backing row (saved_request or test_suite_item). Returns
 * `{ notApplicable: true }` when the caller should fall back to the
 * "save as" modal (no row exists yet, or the tab type isn't savable), plus
 * `orphaned: true` when the tab's row has vanished (issue #269) — the tab is
 * then unbound and stays dirty; it is never reported saved.
 */
export async function saveActiveRequestInPlace(): Promise<InPlaceSaveResult> {
  const tabs = useTabsStore.getState()
  const activeTab = tabs.tabs.find((t) => t.id === tabs.activeTabId)
  if (!activeTab) return { success: false, notApplicable: true }

  // Issues #243 / #244: a tab restored after a restart has empty credential
  // fields — literal credentials are kept out of localStorage — while the row
  // still holds them. Read them back before the snapshot; when the row cannot
  // be read, do not save rather than write the empty fields over them.
  if (activeTab.endpointId || activeTab.savedRequestId || activeTab.testSuiteItemId) {
    const reload = await ensureWithheldCredentialsLoaded(activeTab)
    // The row is gone (issue #269): checked before the not-loaded guard —
    // there is nothing left to overwrite, the edits go to Save As.
    if (!reload.ok && reload.missing) return orphaned(activeTab.id)
    if (!reload.ok) return { success: false, error: reload.error }
    // Belt and braces (P0): a state that was never loaded from the row — the
    // cache cap dropped it, the startup snapshot lacked it — is never written
    // over the row, whatever the reload above reported.
    if (isTabUnloaded(activeTab.id)) return { success: false, error: NOT_LOADED_ERROR }
  }

  const req = useRequestStore.getState()
  const { effectiveUrl, effectiveMethod, effectiveBody, protocolMeta } = snapshotProtocol(activeTab)
  const protocol = (activeTab.protocol ?? 'http') as string
  // Timeout / redirects / SSL (issue #185) — top-level keys, read back by the
  // tab-open paths and the Runner through `readRequestSettings`.
  const settings = requestSettingsFor(activeTab)
  // `:name` path variable values (issue #276) ride next to the settings.
  const pathVars = pathVariablesFor(activeTab)
  // Issue #201: an HTTP request still carrying a placeholder name ('New
  // Endpoint' from the tree's Add Request, 'Yeni Uç Nokta', …) is saved under
  // a name derived from its URL. A name the user typed is never replaced.
  // Not applied to Test Suite items — the issue is about the APIs tree.
  const renameTo = autoRequestName(protocol, activeTab.name, effectiveUrl)

  // ─── Test Suite item ─────────────────────────────────────────
  if (activeTab.testSuiteItemId) {
    const schema = {
      params: req.params,
      headers: req.headers,
      body: effectiveBody,
      auth: req.auth,
      preScript: req.preScript,
      postScript: req.postScript,
      ...settings,
      ...pathVars,
      ...(Object.keys(protocolMeta).length > 0 ? { metadata: protocolMeta } : {}),
    }
    try {
      const result = (await window.api?.testSuiteItem?.update(activeTab.testSuiteItemId, {
        name: activeTab.name,
        protocol,
        method: effectiveMethod,
        url: effectiveUrl,
        request_schema: JSON.stringify(schema),
        assertions: JSON.stringify(req.assertions ?? []),
      })) as UpdateEnvelope
      if (result?.notFound) return orphaned(activeTab.id)
      if (result?.success) {
        tabs.markDirty(activeTab.id, false)
        // Sync the tab badge with the post-save method + URL — symmetric
        // with the saved_request branch below. Without this the tab chip
        // still reads "GET" after a Ctrl+S that turned the request into
        // a POST (or vice versa), until the user closes + reopens the
        // tab. v1.4.4 sweep §4.
        tabs.updateTab(activeTab.id, {
          method: effectiveMethod,
          url: effectiveUrl,
        })
        // Suite items are not in the APIs tree; the Tests sidebar reloads
        // expanded suites on this signal (same one the Save button sends).
        window.dispatchEvent(new CustomEvent('tests:suite-item-changed'))
        return { success: true }
      }
      return { success: false, error: result?.error || 'Update failed' }
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : String(e) }
    }
  }

  // ─── Saved request (lives under APIs folders) ────────────────
  if (activeTab.savedRequestId) {
    const payload = {
      name: renameTo ?? activeTab.name,
      method: effectiveMethod,
      url: effectiveUrl,
      protocol,
      params: JSON.stringify(req.params),
      headers: JSON.stringify(req.headers),
      body: JSON.stringify(effectiveBody),
      auth: JSON.stringify(req.auth),
      pre_script: req.preScript,
      post_script: req.postScript,
      assertions: JSON.stringify(req.assertions ?? []),
      // No request_schema on this table: settings ride in `metadata`.
      metadata: savedRequestMetadata(protocolMeta, { ...settings, ...pathVars }),
    }
    try {
      const result = (await window.api?.savedRequest?.update(
        activeTab.savedRequestId,
        payload,
      )) as UpdateEnvelope
      if (result?.notFound) return orphaned(activeTab.id)
      if (result?.success) {
        tabs.markDirty(activeTab.id, false)
        tabs.updateTab(activeTab.id, {
          method: effectiveMethod,
          url: effectiveUrl,
          ...(renameTo ? { name: renameTo } : {}),
        })
        await refreshApisTree()
        return { success: true }
      }
      return { success: false, error: result?.error || 'Update failed' }
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : String(e) }
    }
  }

  // ─── Endpoint (lives under APIs module tree) ─────────────────
  // Mirrors the Save button's in-place branch in UrlBar so Ctrl+S behaves
  // identically (issue #41): an already-backed endpoint tab saves straight to
  // its row without popping the "Save As" folder picker. The endpoint row keeps
  // assertions INSIDE request_schema (no separate column), unlike saved_request.
  if (activeTab.endpointId) {
    const schema = {
      url: effectiveUrl,
      method: effectiveMethod,
      params: req.params,
      headers: req.headers,
      body: effectiveBody,
      auth: req.auth,
      preScript: req.preScript,
      postScript: req.postScript,
      assertions: req.assertions ?? [],
      ...settings,
      ...pathVars,
      ...(Object.keys(protocolMeta).length > 0 ? { metadata: protocolMeta } : {}),
    }
    try {
      const result = (await window.api?.endpoint?.update(activeTab.endpointId, {
        // The name is sent only when it changes (issue #201), so an imported
        // endpoint whose tab label differs from its row keeps its row name.
        ...(renameTo ? { name: renameTo } : {}),
        method: effectiveMethod,
        path: effectiveUrl,
        request_schema: JSON.stringify(schema),
      })) as UpdateEnvelope
      if (result?.notFound) return orphaned(activeTab.id)
      if (result?.success) {
        tabs.markDirty(activeTab.id, false)
        tabs.updateTab(activeTab.id, {
          method: effectiveMethod,
          url: effectiveUrl,
          ...(renameTo ? { name: renameTo } : {}),
        })
        await refreshApisTree()
        return { success: true }
      }
      return { success: false, error: result?.error || 'Update failed' }
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : String(e) }
    }
  }

  // A tab unbound earlier — its row deleted from the sidebar (issue #269) —
  // still reports why Save As opens.
  return { success: false, notApplicable: true, ...(activeTab.orphaned ? { orphaned: true } : {}) }
}
