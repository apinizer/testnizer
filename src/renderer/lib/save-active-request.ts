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
import { useWebSocketStore } from '../stores/websocket.store'
import { useSseStore } from '../stores/sse.store'
import { useSocketIOStore } from '../stores/socketio.store'
import { useGrpcStore } from '../stores/grpc.store'
import { useGraphQLStore } from '../stores/graphql.store'
import type { Tab, KeyValuePair } from '../types'

type SseHttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

export interface InPlaceSaveResult {
  success: boolean
  error?: string
  /** True when no in-place row was found (caller should fall back to modal). */
  notApplicable?: boolean
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
          wsSecurity: soap.wsSecurity,
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
      protocolMeta: {
        websocket: {
          url: ws.url,
          customHeaders: ws.customHeaders,
          composerContent: ws.composerContent,
          composerMode: ws.composerMode,
          autoScroll: ws.autoScroll,
        },
      },
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
      protocolMeta: {
        socketio: {
          url: sio.url,
          namespace: sio.namespace,
          bearerToken: sio.bearerToken,
          subscriptions: sio.subscriptions,
          emitEvent: sio.emitEvent,
          emitPayload: sio.emitPayload,
        },
      },
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
  return { effectiveUrl: url, effectiveMethod: method, effectiveBody: body, protocolMeta }
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
  applyProtocolMetadata(protocol, metadata)
  // The setters fired above may have flipped the dirty dot on; restore the
  // pre-hydration value so reopening a saved request reads as clean.
  if (activeTabId) tabs.markDirty(activeTabId, wasDirty)
}

function applyProtocolMetadata(protocol: string, metadata: unknown): void {
  if (!metadata || typeof metadata !== 'object') return
  const meta = metadata as Record<string, unknown>

  if (protocol === 'soap' && meta.soap && typeof meta.soap === 'object') {
    const s = meta.soap as Record<string, unknown>
    useSoapStore.getState().loadFromEndpoint({
      url: (s.endpointUrl as string) || '',
      // loadFromEndpoint reads `body.content` and falls back to
      // `soap.exampleRequest` — we don't write a separate body field
      // since the request body is `effectiveBody = { type:'xml', content: rawXml }`
      // already restored by the request-store branch upstream.
      soap: {
        wsdlUrl: s.wsdlUrl as string | undefined,
        // snapshotProtocol writes `selectedService/Port/Operation`;
        // SoapEndpointMeta wants `serviceName/portName/operationName`.
        // Accept both shapes so older rows still load.
        serviceName: (s.serviceName ?? s.selectedService) as string | undefined,
        portName: (s.portName ?? s.selectedPort) as string | undefined,
        operationName: (s.operationName ?? s.selectedOperation) as string | undefined,
        endpointUrl: s.endpointUrl as string | undefined,
      },
    })
    return
  }

  if (protocol === 'socketio' && meta.socketio && typeof meta.socketio === 'object') {
    const s = meta.socketio as Record<string, unknown>
    const sio = useSocketIOStore.getState()
    if (typeof s.url === 'string') sio.setUrl(s.url)
    if (typeof s.namespace === 'string') sio.setNamespace(s.namespace)
    if (typeof s.bearerToken === 'string') sio.setBearerToken(s.bearerToken)
    if (typeof s.emitEvent === 'string') sio.setEmitEvent(s.emitEvent)
    if (typeof s.emitPayload === 'string') sio.setEmitPayload(s.emitPayload)
    return
  }

  if (protocol === 'websocket' && meta.websocket && typeof meta.websocket === 'object') {
    const w = meta.websocket as Record<string, unknown>
    const ws = useWebSocketStore.getState()
    if (typeof w.url === 'string') ws.setUrl(w.url)
    if (Array.isArray(w.customHeaders)) {
      ws.setHeaders(w.customHeaders as KeyValuePair[])
    }
    if (typeof w.composerContent === 'string') ws.setComposerContent(w.composerContent)
    if (w.composerMode === 'json' || w.composerMode === 'text') ws.setComposerMode(w.composerMode)
    if (typeof w.autoScroll === 'boolean') ws.setAutoScroll(w.autoScroll)
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
}

/**
 * Persist the active tab's edits in place when the tab already maps to a
 * backing row (saved_request or test_suite_item). Returns
 * `{ notApplicable: true }` when the caller should fall back to the
 * "save as" modal (no row exists yet, or the tab type isn't savable).
 */
export async function saveActiveRequestInPlace(): Promise<InPlaceSaveResult> {
  const tabs = useTabsStore.getState()
  const activeTab = tabs.tabs.find((t) => t.id === tabs.activeTabId)
  if (!activeTab) return { success: false, notApplicable: true }

  const req = useRequestStore.getState()
  const { effectiveUrl, effectiveMethod, effectiveBody, protocolMeta } = snapshotProtocol(activeTab)
  const protocol = (activeTab.protocol ?? 'http') as string

  // ─── Test Suite item ─────────────────────────────────────────
  if (activeTab.testSuiteItemId) {
    const schema = {
      params: req.params,
      headers: req.headers,
      body: effectiveBody,
      auth: req.auth,
      preScript: req.preScript,
      postScript: req.postScript,
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
      })) as { success: boolean; error?: string } | undefined
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
      name: activeTab.name,
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
      ...(Object.keys(protocolMeta).length > 0 ? { metadata: JSON.stringify(protocolMeta) } : {}),
    }
    try {
      const result = (await window.api?.savedRequest?.update(activeTab.savedRequestId, payload)) as
        | { success: boolean; error?: string }
        | undefined
      if (result?.success) {
        tabs.markDirty(activeTab.id, false)
        tabs.updateTab(activeTab.id, {
          method: effectiveMethod,
          url: effectiveUrl,
        })
        return { success: true }
      }
      return { success: false, error: result?.error || 'Update failed' }
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : String(e) }
    }
  }

  return { success: false, notApplicable: true }
}
