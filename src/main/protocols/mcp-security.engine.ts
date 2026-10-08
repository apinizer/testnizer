/**
 * MCP Security Scan (issue #142) — first slice: an offline, A–F graded scan
 * of ONE MCP server (Streamable HTTP or legacy HTTP+SSE) the user is
 * authorized to test. Inspired by mcpplaygroundonline.com's scanner.
 *
 * Phases:
 *   1. foundation (sequential) — the unauthenticated probe, the
 *      authenticated session (the tab's headers + OAuth token), and the
 *      advertised inventory (tools/list ×2, prompts, resources). On
 *      Streamable HTTP both handshakes try `server/discover` first: a
 *      2026-07-28 descriptor makes the scan "modern" (stateless requests with
 *      the `_meta` envelope + `Mcp-Method` headers), anything else falls back
 *      to the 2025 `initialize` (issue #152);
 *   2. every check except rate limiting, at most 5 at a time (and at most 5
 *      HTTP requests in flight — `ScanHttp`), each request with a hard
 *      timeout (15 s default);
 *   3. the opt-in rate-limit probe, alone.
 * The session is closed (DELETE) at the end. A cancelled scan reports the
 * unrun checks as `skipped` with `truncated` / `cancelled` set.
 *
 * Secrets discipline: credential headers are redacted by name in every piece
 * of evidence, and every credential VALUE seen on the wire (the user's
 * Authorization / X-API-Key, the OAuth bearer injected by
 * `createMcpOAuthFetch`) is scrubbed from each finding and the report before
 * they leave this module.
 *
 * The 2026-07-28 checks (`server/discover`, `Mcp-Method` validation, cache
 * hints / scope, `requestState` tampering, the legacy fallback) live in
 * `mcp-security/checks-modern.ts` and are `skipped` on a 2025-era session.
 * Out of scope: LLM-assisted analysis.
 *
 * Electron-free (like `mcp.engine.ts`); every dependency is injectable.
 */

import { randomUUID } from 'node:crypto'
import type { FetchLike } from '@modelcontextprotocol/sdk/shared/transport.js'
import { errorMessage, scrub } from './mcp-oauth.engine'
import {
  inspectTls as defaultInspectTls,
  type TlsInspectOptions,
  type TlsInspectResult,
} from './tls-inspect.engine'
import {
  collectInventory,
  isLoopbackHost,
  openSession,
  probeUnauthenticated,
  serverInfoFromResult,
  skipped,
  type CheckDef,
  type CheckOutcome,
  type ScanContext,
} from './mcp-security/context'
import { TRANSPORT_AUTH_CHECKS } from './mcp-security/checks-transport-auth'
import { CORS_CHECKS, HEADER_CHECKS, PROTOCOL_CHECKS } from './mcp-security/checks-protocol'
import { DISCLOSURE_CHECKS, INJECTION_CHECKS, rateLimitChecks } from './mcp-security/checks-content'
import {
  MODERN_AUTH_CHECKS,
  MODERN_DISCLOSURE_CHECKS,
  MODERN_PROTOCOL_CHECKS,
} from './mcp-security/checks-modern'
import { gradeOf, scoreOf, summarize } from './mcp-security/grading'
import { ScanHttp, isCredentialHeader, withoutCredentials } from './mcp-security/wire'
import { applyMcpAuth, type McpAuthOptions } from './mcp-auth'
import type {
  McpSecurityCategory,
  McpSecurityCategoryId,
  McpSecurityFinding,
  McpSecurityProgress,
  McpSecurityReport,
  McpSecurityScanOptions,
  McpSecurityServerInfo,
  McpSecurityTransport,
} from './mcp-security/types'

export * from './mcp-security/types'
export { redactReport } from './mcp-security/redact'
export { buildMcpSecurityHtmlReport, DISCLAIMER } from './mcp-security/report-html'
export {
  SEVERITY_WEIGHT,
  STATUS_FACTOR,
  GRADE_THRESHOLDS,
  gradeOf,
  scoreOf,
} from './mcp-security/grading'

export const DEFAULT_SCAN_TIMEOUT_MS = 15_000
export const SCAN_CONCURRENCY = 5

export const CATEGORY_TITLES: Readonly<Record<McpSecurityCategoryId, string>> = {
  transport: 'Transport security',
  auth: 'Authentication & authorization',
  protocol: 'Protocol conformance',
  injection: 'Prompt injection & tool poisoning',
  disclosure: 'Information disclosure',
  cors: 'CORS',
  headers: 'Security headers',
  ratelimit: 'Rate limiting',
}

const CATEGORY_ORDER = Object.keys(CATEGORY_TITLES) as McpSecurityCategoryId[]

export interface McpSecurityScanInput {
  url: string
  transport: McpSecurityTransport
  /** The tab's headers — sent on authenticated requests; credentials stripped for the probes. */
  headers?: Record<string, string>
  /**
   * The tab's Authorization tab (MCP Auth), `{{var}}`-resolved — applied to
   * the authenticated requests exactly as Connect applies it (custom headers
   * win); never sent on the unauthenticated probes; its values are scrubbed.
   */
  auth?: McpAuthOptions
  /** OAuth 2.1 session (issue #141) whose token authenticates the scan's session. */
  oauthSessionId?: string
  options: McpSecurityScanOptions
  onFinding?: (finding: McpSecurityFinding) => void
  onProgress?: (progress: McpSecurityProgress) => void
  signal?: AbortSignal
  /** Report id (the IPC handler's scanId); random when absent. */
  scanId?: string
  /** Test seams. */
  deps?: {
    fetch?: FetchLike
    inspectTls?: (opts: TlsInspectOptions) => Promise<TlsInspectResult>
    now?: () => number
  }
}

/** Every check this scan runs, in report order. */
export function checksFor(options: McpSecurityScanOptions): CheckDef[] {
  return [
    ...TRANSPORT_AUTH_CHECKS,
    ...MODERN_AUTH_CHECKS,
    ...PROTOCOL_CHECKS,
    ...MODERN_PROTOCOL_CHECKS,
    ...INJECTION_CHECKS,
    ...DISCLOSURE_CHECKS,
    ...MODERN_DISCLOSURE_CHECKS,
    ...CORS_CHECKS,
    ...HEADER_CHECKS,
    ...rateLimitChecks(options.rateLimitProbe),
  ]
}

function parseTarget(raw: string): URL {
  let url: URL
  try {
    url = new URL(raw.trim())
  } catch {
    throw new Error(`Invalid MCP server URL: ${raw}`)
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('The security scan applies to http(s) MCP servers only')
  }
  url.hash = ''
  return url
}

async function pool<T>(items: T[], size: number, work: (item: T) => Promise<void>): Promise<void> {
  let next = 0
  const workers = Array.from({ length: Math.min(size, items.length) }, async () => {
    while (next < items.length) await work(items[next++])
  })
  await Promise.all(workers)
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v)
}

function serverInfoOf(session: ScanContext['session']): McpSecurityServerInfo | undefined {
  const result = session.result
  if (!result) return undefined
  const info = serverInfoFromResult(result) ?? {}
  const protocolVersion =
    typeof result.protocolVersion === 'string'
      ? result.protocolVersion
      : (session.session?.protocolVersion ?? '')
  return {
    name: typeof info.name === 'string' ? info.name : '',
    version: typeof info.version === 'string' ? info.version : '',
    protocolVersion,
    capabilities: isRecord(result.capabilities)
      ? (JSON.parse(JSON.stringify(result.capabilities)) as Record<string, unknown>)
      : {},
    ...(session.era ? { era: session.era } : {}),
    ...(session.supportedVersions?.length
      ? { supportedVersions: [...session.supportedVersions] }
      : {}),
  }
}

export async function runMcpSecurityScan(input: McpSecurityScanInput): Promise<McpSecurityReport> {
  const url = parseTarget(input.url)
  const now = input.deps?.now ?? Date.now
  const startedAt = now()
  const signal = input.signal ?? new AbortController().signal
  const userHeaders = { ...(input.headers ?? {}) }
  // Authorization tab, same rule as Connect (`applyMcpAuth`): fills only what
  // the user's rows do not set; an API key in the query moves to `authUrl`.
  const authed = applyMcpAuth(url.href, userHeaders, input.auth)
  const headers = authed.headers
  const authUrl = new URL(authed.url)
  /** Header names the Authorization tab added — whatever they are called. */
  const authHeaderNames = new Set(Object.keys(headers).filter((k) => !(k in userHeaders)))
  const http = new ScanHttp({
    fetchFn: input.deps?.fetch ?? ((u, init) => fetch(u, init)),
    signal,
    timeoutMs: input.options.timeoutMs ?? DEFAULT_SCAN_TIMEOUT_MS,
    maxConcurrent: SCAN_CONCURRENCY,
    ...(input.oauthSessionId ? { oauthSessionId: input.oauthSessionId } : {}),
  })
  http.noteSecretsOf(headers)
  http.noteUrlSecrets(url.href)
  // The name rules above miss an API key called e.g. `X-Gw` — note every value
  // the Authorization tab supplied, in the forms it can take on the wire.
  for (const name of authHeaderNames) http.noteSecret(headers[name])
  if (authUrl.href !== url.href && input.auth?.apiKey) {
    const value = input.auth.apiKey.value
    http.noteSecret(value)
    http.noteSecret(new URLSearchParams({ v: value }).toString().slice(2))
  }
  const anonHeaders = withoutCredentials(headers)
  for (const name of authHeaderNames) delete anonHeaders[name]

  const ctx: ScanContext = {
    url,
    transport: input.transport,
    loopback: isLoopbackHost(url.hostname),
    authUrl,
    headers,
    anonHeaders,
    http,
    toolInvocationProbe: input.options.toolInvocationProbe === true,
    authenticated:
      authHeaderNames.size > 0 ||
      authUrl.href !== url.href ||
      !!input.oauthSessionId ||
      Object.keys(headers).some(isCredentialHeader),
    inspectTls: input.deps?.inspectTls ?? defaultInspectTls,
    session: { ok: false, reason: 'network', error: 'not started' },
    memo: new Map(),
  }

  const checks = checksFor(input.options)
  const total = checks.length
  let done = 0
  const findings = new Map<string, McpSecurityFinding>()
  const progress = (current: string): void => {
    try {
      input.onProgress?.({ done, total, current })
    } catch {
      /* a broken consumer must not break the scan */
    }
  }
  const record = (def: CheckDef, outcome: CheckOutcome): void => {
    const finding = scrub<McpSecurityFinding>(
      {
        id: def.id,
        category: def.category,
        title: def.title,
        ...outcome,
        ...(def.refs?.length ? { refs: def.refs } : {}),
      },
      http.secrets,
    )
    findings.set(def.id, finding)
    done++
    try {
      input.onFinding?.(finding)
    } catch {
      /* consumer errors are not the scan's */
    }
  }
  const runOne = async (def: CheckDef): Promise<void> => {
    if (signal.aborted) {
      record(def, skipped('Cancelled before this check ran.'))
      return
    }
    progress(def.title)
    let outcome: CheckOutcome
    try {
      outcome = await def.run(ctx)
    } catch (err) {
      outcome = skipped(`The check could not run: ${errorMessage(err)}`)
    }
    // A check that finished after Cancel saw aborted requests — not a verdict.
    if (signal.aborted) outcome = skipped('Cancelled while this check was running.')
    record(def, outcome)
    progress('')
  }

  let unreachable: string | undefined
  try {
    progress('Connecting')
    if (!signal.aborted) ctx.unauth = await probeUnauthenticated(ctx)
    if (!signal.aborted) ctx.session = await openSession(ctx)
    if (!signal.aborted && ctx.session.ok) ctx.inventory = await collectInventory(ctx)

    if (
      !signal.aborted &&
      ctx.unauth?.http.status === undefined &&
      ctx.session.init?.http.status === undefined
    ) {
      unreachable = `Could not reach ${url.href}: ${ctx.unauth?.http.error ?? ctx.session.error ?? 'no response'}`
    }

    if (unreachable) {
      for (const def of checks) {
        if (def.id === 'transport.https') await runOne(def)
        else record(def, skipped('Not run — the server could not be reached.'))
      }
    } else {
      await pool(
        checks.filter((c) => c.category !== 'ratelimit'),
        SCAN_CONCURRENCY,
        runOne,
      )
      for (const def of checks.filter((c) => c.category === 'ratelimit')) await runOne(def)
    }
  } finally {
    await ctx.session.session?.close().catch(() => {})
  }
  progress('')

  const categories: McpSecurityCategory[] = CATEGORY_ORDER.map((id) => {
    const list = checks
      .filter((c) => c.category === id)
      .map((c) => findings.get(c.id))
      .filter((f): f is McpSecurityFinding => !!f)
    return { id, title: CATEGORY_TITLES[id], score: scoreOf(list), findings: list }
  }).filter((c) => c.findings.length > 0)
  const all = categories.flatMap((c) => c.findings)
  const score = unreachable ? 0 : scoreOf(all)
  const serverInfo = serverInfoOf(ctx.session)
  const report: McpSecurityReport = {
    id: input.scanId ?? `mcp-scan-${randomUUID()}`,
    startedAt,
    finishedAt: now(),
    target: {
      url: url.href,
      transport: input.transport,
      host: url.host,
      scheme: url.protocol.replace(/:$/, ''),
    },
    grade: unreachable ? 'F' : gradeOf(score),
    score,
    categories,
    summary: summarize(all),
    ...(serverInfo ? { serverInfo } : {}),
    ...(signal.aborted
      ? { truncated: true, cancelled: true }
      : ctx.inventory?.capped
        ? { truncated: true }
        : {}),
    ...(unreachable ? { error: unreachable } : {}),
  }
  return scrub(report, http.secrets)
}
