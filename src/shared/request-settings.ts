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
 * `>0` = explicit. `critical` (issue #304): `true` = a failing run of this
 * request stops the whole Run (Runner, Test Suite, Quick Run, Scheduler)
 * whatever the run-level "Stop on error" says; written only when true, so an
 * unmarked row stays byte-identical. The Ctrl+S writer is `requestSettingsFor` in
 * `save-active-request.ts`; the readers are the tab-open paths and the
 * Runner (`runner.handler.ts`), all through `readRequestSettings`.
 *
 * SSL verification and redirects are TRI-STATE (issue #287): absent =
 * inherit (project setting → app Settings → on), `false` = explicit off,
 * `true` + `<key>Explicit: true` = explicit on. A bare `true` is the LEGACY
 * shape every pre-fix Ctrl+S wrote for a request nobody touched (the store
 * default was `true`), so it is NOT an override — it shadowed the project's
 * "SSL certificate verification: off" forever. One writer
 * (`encodeSslVerification` / `encodeFollowRedirects`), one meaning
 * (`requestSslVerification` / `requestFollowRedirects`), one chain
 * (`resolveSslVerification` / `resolveFollowRedirects`) — Send and Run alike.
 * The reader drops a legacy ssl `true` itself; `followRedirects` keeps its
 * stored value in the reader output (exporters carry it as written) and the
 * legacy rule lives in `requestFollowRedirects`. The reader keeps the
 * `…Explicit` markers, so spreading its output into a row is lossless.
 *
 * Pure TS: no node / electron / DOM imports — compiled into both bundles.
 */

export interface RequestSettings {
  /** ms — absent = inherit, 0 = no limit. */
  timeout?: number
  /** As stored — use `requestFollowRedirects` for the override it means. */
  followRedirects?: boolean
  /** Issue #287: marks a user-chosen `followRedirects: true` (else a bare true = inherit). */
  followRedirectsExplicit?: true
  maxRedirects?: number
  /** Issue #287: absent = inherit; a legacy bare `true` reads as absent. */
  sslVerification?: boolean
  /** Issue #287: marks a user-chosen `sslVerification: true`. */
  sslVerificationExplicit?: true
  /**
   * Issue #304: the Runner stops the run when this request does not pass —
   * independent of the run-level "Stop on error". Present only when true.
   */
  critical?: boolean
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
  if (typeof src.followRedirects === 'boolean') {
    out.followRedirects = src.followRedirects
    if (src.followRedirects && src.followRedirectsExplicit === true)
      out.followRedirectsExplicit = true
  }
  const maxRedirects = nonNegative(src.maxRedirects)
  if (maxRedirects !== undefined) out.maxRedirects = Math.floor(maxRedirects)
  // Issue #287: false = explicit off; true counts only with its marker (a bare
  // true is what every untouched pre-fix save wrote → inherit).
  if (src.sslVerification === false) out.sslVerification = false
  else if (src.sslVerification === true && src.sslVerificationExplicit === true) {
    out.sslVerification = true
    out.sslVerificationExplicit = true
  }
  if (src.critical === true) out.critical = true
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

// ─── SSL verification + redirects (issue #287) ──────────────────────────────

const bool = (v: unknown): boolean | undefined => (typeof v === 'boolean' ? v : undefined)

/**
 * The persisted keys for a request-level SSL choice: `null` (inherit) writes
 * nothing, `false` writes `sslVerification: false`, `true` writes the value
 * with its marker. Every writer (Ctrl+S, importers) goes through this.
 */
export function encodeSslVerification(
  v: boolean | null | undefined,
): Pick<RequestSettings, 'sslVerification' | 'sslVerificationExplicit'> {
  if (v === false) return { sslVerification: false }
  if (v === true) return { sslVerification: true, sslVerificationExplicit: true }
  return {}
}

/** The redirects twin of `encodeSslVerification`. */
export function encodeFollowRedirects(
  v: boolean | null | undefined,
): Pick<RequestSettings, 'followRedirects' | 'followRedirectsExplicit'> {
  if (v === false) return { followRedirects: false }
  if (v === true) return { followRedirects: true, followRedirectsExplicit: true }
  return {}
}

/** A row's request-level SSL override: `undefined` = inherit. */
export function requestSslVerification(s: RequestSettings): boolean | undefined {
  return s.sslVerification === false ? false : s.sslVerificationExplicit ? true : undefined
}

/**
 * A row's request-level redirects override: `undefined` = inherit. A bare
 * stored `true` (the old store default on every save) is NOT an override.
 */
export function requestFollowRedirects(s: RequestSettings): boolean | undefined {
  if (s.followRedirects === false) return false
  return s.followRedirects === true && s.followRedirectsExplicit ? true : undefined
}

/**
 * TLS certificate verification, shared by Send (`request.store.ts`,
 * `soap.store.ts`, `graphql.store.ts`) and Run (`runner.handler.ts`
 * `buildRequestFromEndpoint`): request → project
 * (`project.<id>.settings.sslVerification`) → app Settings `sslVerification`
 * → `true`. `null`/`undefined` at a tier = not set there.
 */
export function resolveSslVerification(
  request: boolean | null | undefined,
  project: boolean | null | undefined,
  app: boolean | null | undefined,
): boolean {
  return bool(request) ?? bool(project) ?? bool(app) ?? true
}

/** Same chain for "follow redirects": request → project → app → `true`. */
export function resolveFollowRedirects(
  request: boolean | null | undefined,
  project: boolean | null | undefined,
  app: boolean | null | undefined,
): boolean {
  return bool(request) ?? bool(project) ?? bool(app) ?? true
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
