/**
 * History row request snapshot — shape shared by main (writers + masking) and
 * the renderer (reopen / re-send). Issue #195.
 *
 * `history.request_snapshot` keeps its flat fields (`method`, `url`, `params`,
 * `headers`, `body`, `auth`, or a protocol's own keys) as the MASKED copy of
 * what was sent — that is what History shows. Next to them, rows written from
 * issue #195 on carry `configured`: the request as the editor held it, with
 * `{{var}}` references kept, so reopening / re-sending a row resolves the
 * variables again and auth keeps working. Credential-named values typed
 * literally (not a `{{var}}`) are masked in `configured` too and come back
 * EMPTY on reopen — the same rule MCP History follows (`hiddenArgs`).
 *
 * Rows written before issue #195 have no `configured`; reopen falls back to
 * the flat fields, as it always did.
 *
 * Pure TS, zero runtime imports: compiled into both bundles.
 */
export interface HistoryConfigured {
  method?: string
  url?: string
  params?: unknown
  headers?: unknown
  body?: unknown
  auth?: unknown
  /**
   * Protocol editor state, keyed by protocol — exactly the `protocolMeta`
   * shape `snapshotProtocol` saves on an endpoint (`{ websocket: {...} }`,
   * `{ grpc: {...} }`, `{ graphql: {...} }`), so reopening reuses
   * `restoreProtocolFromMetadata`.
   */
  meta?: Record<string, unknown>
}

/** The key `configured` lives under inside `request_snapshot`. */
export const HISTORY_CONFIGURED_KEY = 'configured'
