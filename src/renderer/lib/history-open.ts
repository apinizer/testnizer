/**
 * ONE way to put an HTTP / WebSocket / gRPC / GraphQL History row on a tab —
 * the History sidebar and the welcome page's recent list both call it (the
 * MCP twin is `protocols/mcp/history-open.ts`; the two lists used to differ).
 * The tab must already be open and active.
 *
 * Issue #182: WebSocket, gRPC and GraphQL rows used to fall through to the
 * HTTP loader and opened a blank editor. Issue #195: rows carrying the
 * `configured` template reopen from it, so `{{var}}` auth works on re-send.
 */
import { useRequestStore } from '../stores/request.store'
import { useGrpcStore, type GrpcService } from '../stores/grpc.store'
import { useHistoryHiddenStore } from '../stores/history-hidden.store'
import { restoreProtocolFromMetadata } from './save-active-request'
import {
  httpHistoryRestore,
  isHistoryMetaProtocol,
  protocolHistoryRestore,
} from './history-restore'
import type { HistoryEntry } from '../types'

type Row = Pick<HistoryEntry, 'url' | 'method' | 'protocol' | 'request_snapshot'>

/**
 * A History row's gRPC call is always unary (only `grpc:execute` writes
 * History), so the service + method it names can be offered before the proto
 * is reloaded: the editor shows the selection and Send works against the
 * stored `protoPath`. A loaded proto that already lists the service wins.
 */
function restoreGrpcSelection(grpc: Record<string, unknown>): void {
  const service = typeof grpc.selectedService === 'string' ? grpc.selectedService : ''
  const method = typeof grpc.selectedMethod === 'string' ? grpc.selectedMethod : ''
  const protoPath = typeof grpc.protoPath === 'string' ? grpc.protoPath : ''
  if (!service || !method) return
  const store = useGrpcStore.getState()
  const known = store.services.some(
    (s) => s.name === service && s.methods.some((m) => m.name === method),
  )
  const services: GrpcService[] = known
    ? store.services
    : [
        {
          name: service,
          methods: [{ name: method, type: 'unary', requestType: '', responseType: '' }],
        },
      ]
  useGrpcStore.setState({
    services,
    selectedService: service,
    selectedMethod: method,
    ...(protoPath ? { protoPath, protoLoaded: true } : {}),
  })
}

/**
 * Restore `entry` into the (already active) tab `tabId`. SOAP and MCP rows
 * have their own paths and never come here.
 */
export function openHistoryEntryInTab(entry: Row, tabId: string): void {
  const protocol = entry.protocol || 'http'
  if (isHistoryMetaProtocol(protocol)) {
    const restored = protocolHistoryRestore(entry, protocol)
    // Keep the HTTP store on this tab too, as a tab switch would.
    useRequestStore.getState().switchToTab(tabId)
    restoreProtocolFromMetadata(protocol, restored.meta)
    if (protocol === 'grpc') {
      restoreGrpcSelection(restored.meta.grpc as Record<string, unknown>)
    }
    useHistoryHiddenStore.getState().setHidden(tabId, restored.hidden)
    return
  }
  // HTTP — and every other protocol without its own restore (SSE, Socket.IO),
  // which reopened through the request editor before too.
  const r = httpHistoryRestore(entry)
  const store = useRequestStore.getState()
  store.switchToTab(tabId)
  store.loadFromEndpoint({
    method: r.method,
    url: r.url,
    params: r.params,
    headers: r.headers,
    body: r.body,
    auth: r.auth,
  })
  useHistoryHiddenStore.getState().setHidden(tabId, r.hidden)
}
