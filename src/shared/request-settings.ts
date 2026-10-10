/**
 * Per-request settings that ride with a saved request (issue #185): the
 * timeout and — for HTTP — redirects and SSL verification.
 *
 * ONE persisted shape for every protocol and every row kind:
 *  - endpoints / test_suite_items: top-level keys of `request_schema`
 *    (`timeout`, `followRedirects`, `maxRedirects`, `sslVerification`);
 *  - saved_requests (no `request_schema`): the same top-level keys inside the
 *    `metadata` JSON, next to the protocol blocks (`mcp`, `soap`, …).
 * `timeout` is in ms: absent = inherit the general default, `0` = no limit,
 * `>0` = explicit. The Ctrl+S writer is `requestSettingsFor` in
 * `save-active-request.ts`; the readers are the tab-open paths and the
 * Runner (`runner.handler.ts`), all through `readRequestSettings`.
 *
 * Pure TS: no node / electron / DOM imports — compiled into both bundles.
 */

export interface RequestSettings {
  /** ms — absent = inherit, 0 = no limit. */
  timeout?: number
  followRedirects?: boolean
  maxRedirects?: number
  sslVerification?: boolean
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v)

const nonNegative = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : undefined

/**
 * Tolerant reader of the settings keys on a `request_schema` / `metadata`
 * object. A row imported before issue #185 carries only the Apinizer
 * `timeoutSeconds` (nothing read it) — it is honoured as `timeout` × 1000.
 * A legacy `timeoutSeconds: 0` is Apinizer's "use the default", so it reads
 * as NOT SET (inherit) — never as `timeout: 0` (= no limit).
 */
export function readRequestSettings(src: unknown): RequestSettings {
  if (!isRecord(src)) return {}
  const out: RequestSettings = {}
  const timeout = nonNegative(src.timeout)
  const legacySeconds =
    typeof src.timeoutSeconds === 'number' &&
    Number.isFinite(src.timeoutSeconds) &&
    src.timeoutSeconds > 0
      ? src.timeoutSeconds
      : undefined
  if (timeout !== undefined) out.timeout = timeout
  else if (legacySeconds !== undefined) out.timeout = Math.round(legacySeconds * 1000)
  if (typeof src.followRedirects === 'boolean') out.followRedirects = src.followRedirects
  const maxRedirects = nonNegative(src.maxRedirects)
  if (maxRedirects !== undefined) out.maxRedirects = Math.floor(maxRedirects)
  if (typeof src.sslVerification === 'boolean') out.sslVerification = src.sslVerification
  return out
}

/** Parse a JSON column (saved_requests.metadata) and read its settings; malformed → `{}`. */
export function readRequestSettingsJson(json: string | null | undefined): RequestSettings {
  if (!json) return {}
  try {
    return readRequestSettings(JSON.parse(json))
  } catch {
    return {}
  }
}

// ─── HTTP timeout chain ─────────────────────────────────────────────────────

/** The HTTP engine's own default when nothing else is configured (`http.engine.ts`). */
export const HTTP_ENGINE_DEFAULT_TIMEOUT_MS = 30_000

/**
 * The HTTP timeout chain, shared by Send (`request.store.ts`) and Run
 * (`runner.handler.ts` `buildRequestFromEndpoint`):
 *   per-request (incl. 0 = no timeout) → project setting
 *   (`project.<id>.settings.requestTimeout`) → app-wide `defaultTimeout`.
 * `undefined` = nothing configured; the engine then applies
 * `HTTP_ENGINE_DEFAULT_TIMEOUT_MS`.
 */
export function resolveHttpTimeout(
  perRequest: number | null | undefined,
  project: number | null | undefined,
  app: number | null | undefined,
): number | undefined {
  return nonNegative(perRequest) ?? nonNegative(project) ?? nonNegative(app)
}

// ─── MCP timeout ────────────────────────────────────────────────────────────

/**
 * Default bound of ONE MCP call (tools/call, resources/read, prompts/get) —
 * Send and Run alike, re-armed by every `notifications/progress` of a tool
 * call. 120 s, not the SDK's implicit 60 s: Run has always allowed 120 s (a
 * stdio `npx` spawn + a slow tool fit), so the shared value regresses no run
 * that passes today, and Send only becomes more lenient than the 60 s it
 * inherited by accident.
 */
export const MCP_DEFAULT_TIMEOUT_MS = 120_000

/** An MCP request's timeout: its own (0 = no limit) or `MCP_DEFAULT_TIMEOUT_MS`. */
export function resolveMcpTimeout(perRequest: unknown): number {
  return nonNegative(perRequest) ?? MCP_DEFAULT_TIMEOUT_MS
}
