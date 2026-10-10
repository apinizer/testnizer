/**
 * Collection exports (Postman v2.1, Insomnia v4, OpenAPI 3) — what they can
 * carry and how a left-out item is reported (issue #197).
 *
 * All three formats describe HTTP requests. A protocol that is not plain HTTP
 * on the wire (MCP, WebSocket, Socket.IO, gRPC, AI Chat) has no faithful
 * representation there: exporting it as an HTTP request produced a broken
 * entry (a `GET ws://…`, an RPC name as the method). Those rows are left out
 * of the file and returned as `skipped`, so the renderer can tell the user
 * which items did not make it — never a silent drop.
 *
 * SOAP, GraphQL and SSE ARE carried: each is an ordinary HTTP request (SOAP is
 * a POST with an XML envelope, GraphQL a POST with a query body, SSE a GET),
 * which is how Postman / Insomnia themselves store them, and the Apinizer
 * interop (`x-apinizer`, testType WSDL for SOAP) relies on SOAP being present.
 *
 * Pure TS: no node / electron / DOM imports — compiled into both bundles.
 */

export type CollectionExportFormat = 'postman' | 'insomnia' | 'openapi'

/**
 * Why an item is not in the exported file:
 *  - `unsupported-protocol`: the format cannot hold this protocol;
 *  - `duplicate-operation`: OpenAPI keys an operation by path + method, and an
 *    earlier item already took that slot.
 */
export type ExportSkipReason = 'unsupported-protocol' | 'duplicate-operation'

export interface ExportSkippedItem {
  name: string
  protocol: string
  reason: ExportSkipReason
}

export interface CollectionExportResult {
  /** The file content (JSON text). */
  content: string
  /** Items left out of `content` — unsupported protocols first (tree order),
   *  then OpenAPI path + method collisions. Empty when everything fitted. */
  skipped: ExportSkippedItem[]
}

/** Protocols every collection format can carry as an HTTP request. */
const HTTP_CARRIED_PROTOCOLS: ReadonlySet<string> = new Set(['http', 'graphql', 'soap', 'sse'])

/** Normalised protocol of a row; a missing protocol is a plain HTTP request. */
export function exportProtocolOf(protocol: string | null | undefined): string {
  const p = (protocol ?? '').trim().toLowerCase()
  return p.length > 0 ? p : 'http'
}

/** True when a Postman / Insomnia / OpenAPI export can carry `protocol`. */
export function isCollectionExportable(protocol: string | null | undefined): boolean {
  return HTTP_CARRIED_PROTOCOLS.has(exportProtocolOf(protocol))
}

/** Display name of a format, used in the "not exported" message. */
export function collectionExportFormatLabel(format: CollectionExportFormat): string {
  switch (format) {
    case 'postman':
      return 'Postman v2.1'
    case 'insomnia':
      return 'Insomnia'
    case 'openapi':
      return 'OpenAPI'
  }
}

/** Display name of a protocol, used in the "not exported" message. */
export function exportProtocolLabel(protocol: string): string {
  switch (exportProtocolOf(protocol)) {
    case 'websocket':
      return 'WebSocket'
    case 'socketio':
      return 'Socket.IO'
    case 'grpc':
      return 'gRPC'
    case 'graphql':
      return 'GraphQL'
    default:
      return exportProtocolOf(protocol).toUpperCase()
  }
}
