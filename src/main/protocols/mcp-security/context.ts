/**
 * MCP Security Scan (issue #142) — the scan context every check reads, and
 * the sequential foundation phase that fills it: the unauthenticated probe,
 * the authenticated session, and the advertised inventory (tools ×2,
 * prompts, resources, resource templates).
 */

import type { TlsInspectOptions, TlsInspectResult } from '../tls-inspect.engine'
import type {
  McpSecurityCategoryId,
  McpSecurityEvidence,
  McpSecuritySeverity,
  McpSecurityStatus,
  McpSecurityTransport,
} from './types'
import {
  CLIENT_INFO,
  LegacySseSession,
  StreamableSession,
  type HttpResult,
  type RpcOutcome,
  type RpcSession,
  type ScanHttp,
} from './wire'
import { LATEST_PROTOCOL_VERSION } from '@modelcontextprotocol/sdk/types.js'

export interface ToolLite {
  name: string
  title?: string
  description?: string
  inputSchema?: unknown
  outputSchema?: unknown
}

export interface NamedLite {
  name: string
  title?: string
  description?: string
  /** Resource URI / template, or prompt argument descriptions. */
  extra?: string[]
}

export interface Inventory {
  tools: ToolLite[]
  /** Second `tools/list` for the determinism check (absent when the first failed). */
  toolsAgain?: ToolLite[]
  /** The first `tools/list` outcome — evidence for the content checks. */
  toolsOutcome?: RpcOutcome
  toolsError?: string
  prompts: NamedLite[]
  resources: NamedLite[]
  /** A list was cut at the page / item cap. */
  capped: boolean
}

export interface UnauthProbe {
  http: HttpResult
  /** JSON-RPC `initialize` result when the server answered one without credentials. */
  result?: Record<string, unknown>
}

export interface SessionInfo {
  ok: boolean
  /** Why there is no session. */
  reason?: 'unauthorized' | 'network' | 'http' | 'rpc'
  error?: string
  init?: RpcOutcome
  session?: RpcSession
  result?: Record<string, unknown>
}

export interface CheckOutcome {
  status: McpSecurityStatus
  severity: McpSecuritySeverity
  detail: string
  evidence?: McpSecurityEvidence
  recommendation?: string
}

export interface CheckDef {
  id: string
  category: McpSecurityCategoryId
  title: string
  refs?: string[]
  run: (ctx: ScanContext) => Promise<CheckOutcome> | CheckOutcome
}

export interface ScanContext {
  url: URL
  transport: McpSecurityTransport
  /** 127.0.0.0/8, ::1, localhost, *.localhost. */
  loopback: boolean
  /**
   * URL of the authenticated requests: `url` plus the Authorization tab's
   * API-key query parameter when it has one (MCP Auth). Probes use `url`.
   */
  authUrl: URL
  /** The user's headers (credentials included) — authenticated requests. */
  headers: Record<string, string>
  /** The user's headers minus every credential header — unauthenticated probes. */
  anonHeaders: Record<string, string>
  http: ScanHttp
  inspectTls: (opts: TlsInspectOptions) => Promise<TlsInspectResult>
  unauth?: UnauthProbe
  session: SessionInfo
  inventory?: Inventory
  /** Memoised by the auth checks (PRM feeds the AS-metadata check). */
  memo: Map<string, Promise<unknown>>
}

export function memo<T>(ctx: ScanContext, key: string, work: () => Promise<T>): Promise<T> {
  let hit = ctx.memo.get(key) as Promise<T> | undefined
  if (!hit) {
    hit = work()
    ctx.memo.set(key, hit)
  }
  return hit
}

export function isLoopbackHost(hostname: string): boolean {
  const h = hostname.replace(/^\[|\]$/g, '').toLowerCase()
  return (
    h === 'localhost' ||
    h.endsWith('.localhost') ||
    h === '::1' ||
    /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h) ||
    h === '0:0:0:0:0:0:0:1'
  )
}

// ─── Outcome builders ───────────────────────────────────────

export const pass = (detail: string, evidence?: McpSecurityEvidence): CheckOutcome => ({
  status: 'pass',
  severity: 'info',
  detail,
  ...(evidence ? { evidence } : {}),
})

export const skipped = (detail: string): CheckOutcome => ({
  status: 'skipped',
  severity: 'info',
  detail,
})

export const info = (detail: string, evidence?: McpSecurityEvidence): CheckOutcome => ({
  status: 'info',
  severity: 'info',
  detail,
  ...(evidence ? { evidence } : {}),
})

export function problem(
  status: 'fail' | 'warn',
  severity: McpSecuritySeverity,
  detail: string,
  recommendation: string,
  evidence?: McpSecurityEvidence,
): CheckOutcome {
  return { status, severity, detail, recommendation, ...(evidence ? { evidence } : {}) }
}

/** Shallow copy of an exchange so later mutation of the recorded one does not leak in. */
export function ev(
  http: HttpResult | undefined,
  matches?: string[],
): McpSecurityEvidence | undefined {
  if (!http && !matches?.length) return undefined
  const e = http?.exchange
  return {
    ...(e?.request ? { request: { ...e.request, headers: { ...e.request.headers } } } : {}),
    ...(e?.response ? { response: { ...e.response, headers: { ...e.response.headers } } } : {}),
    ...(e?.error ? { error: e.error } : {}),
    ...(matches?.length ? { matches } : {}),
  }
}

/** The session is unusable — the reason as a skip detail for the checks that need it. */
export function noSessionReason(ctx: ScanContext): string {
  const s = ctx.session
  if (s.reason === 'unauthorized') {
    return 'The server requires authorization and the scan has no working credentials — run the OAuth 2.1 flow (OAuth tab) or add an Authorization header, then scan again.'
  }
  return `No MCP session could be established${s.error ? ` (${s.error})` : ''}.`
}

// ─── Foundation ─────────────────────────────────────────────

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v)
}

/** Unauthenticated `initialize` (GET event-stream for legacy SSE), session closed again. */
export async function probeUnauthenticated(ctx: ScanContext): Promise<UnauthProbe> {
  if (ctx.transport === 'sse') {
    const session = new LegacySseSession(ctx.http, ctx.url.href, ctx.anonHeaders, false)
    const out = await session.initialize()
    await session.close()
    // The verdict is the GET stream's status (401 / 2xx), not the follow-up POST's.
    return { http: session.rpcResponse ?? out.http, ...(out.result ? { result: out.result } : {}) }
  }
  const http = await ctx.http.send(
    ctx.url.href,
    {
      method: 'POST',
      headers: {
        ...ctx.anonHeaders,
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'tz-scan-unauth',
        method: 'initialize',
        params: {
          protocolVersion: LATEST_PROTOCOL_VERSION,
          capabilities: {},
          clientInfo: CLIENT_INFO,
        },
      }),
    },
    { auth: false, wantId: 'tz-scan-unauth' },
  )
  const sessionId = http.headers.get('mcp-session-id')
  if (sessionId) {
    // A stateful server opened a session for the probe — close it again.
    await ctx.http
      .send(
        ctx.url.href,
        { method: 'DELETE', headers: { ...ctx.anonHeaders, 'Mcp-Session-Id': sessionId } },
        { auth: false },
      )
      .catch(() => {})
  }
  const result = isRecord(http.json) && isRecord(http.json.result) ? http.json.result : undefined
  return { http, ...(result ? { result } : {}) }
}

export async function openSession(ctx: ScanContext): Promise<SessionInfo> {
  const session: RpcSession =
    ctx.transport === 'sse'
      ? new LegacySseSession(ctx.http, ctx.authUrl.href, ctx.headers, true)
      : new StreamableSession(ctx.http, ctx.authUrl.href, ctx.headers, true)
  const init = await session.initialize()
  if (init.result) return { ok: true, init, session, result: init.result }
  await session.close()
  const status = init.http.status
  const reason: SessionInfo['reason'] =
    status === undefined
      ? 'network'
      : status === 401 || status === 403
        ? 'unauthorized'
        : init.rpcError
          ? 'rpc'
          : 'http'
  const error = init.rpcError
    ? `JSON-RPC error ${init.rpcError.code}: ${init.rpcError.message}`
    : (init.error ?? `HTTP ${status}`)
  return { ok: false, reason, error, init }
}

const MAX_PAGES = 20
const MAX_ITEMS = 1000

async function listAll(
  session: RpcSession,
  method: string,
  key: string,
): Promise<{
  items: Record<string, unknown>[]
  first?: RpcOutcome
  error?: string
  capped: boolean
}> {
  const items: Record<string, unknown>[] = []
  let cursor: string | undefined
  let first: RpcOutcome | undefined
  for (let page = 0; page < MAX_PAGES; page++) {
    const out = await session.request(method, cursor ? { cursor } : undefined)
    first ??= out
    if (!out.result) {
      const error = out.rpcError
        ? `JSON-RPC error ${out.rpcError.code}: ${out.rpcError.message}`
        : (out.error ?? 'failed')
      return { items, first, error, capped: false }
    }
    const list = out.result[key]
    if (Array.isArray(list)) for (const item of list) if (isRecord(item)) items.push(item)
    if (items.length >= MAX_ITEMS) return { items: items.slice(0, MAX_ITEMS), first, capped: true }
    const next = out.result.nextCursor
    if (typeof next !== 'string' || !next) return { items, first, capped: false }
    cursor = next
  }
  return { items, first, capped: true }
}

const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined)

function toTool(raw: Record<string, unknown>): ToolLite {
  return {
    name: str(raw.name) ?? '',
    ...(str(raw.title) !== undefined ? { title: str(raw.title) } : {}),
    ...(str(raw.description) !== undefined ? { description: str(raw.description) } : {}),
    ...(raw.inputSchema !== undefined ? { inputSchema: raw.inputSchema } : {}),
    ...(raw.outputSchema !== undefined ? { outputSchema: raw.outputSchema } : {}),
  }
}

function toNamed(raw: Record<string, unknown>, extraKeys: string[]): NamedLite {
  const extra: string[] = []
  for (const k of extraKeys) {
    const v = str(raw[k])
    if (v) extra.push(v)
  }
  if (Array.isArray(raw.arguments)) {
    for (const a of raw.arguments) {
      if (isRecord(a) && typeof a.description === 'string') extra.push(a.description)
    }
  }
  return {
    name: str(raw.name) ?? '',
    ...(str(raw.title) !== undefined ? { title: str(raw.title) } : {}),
    ...(str(raw.description) !== undefined ? { description: str(raw.description) } : {}),
    ...(extra.length ? { extra } : {}),
  }
}

/** tools/list twice + prompts/list + resources/list (+ templates), per advertised capability. */
export async function collectInventory(ctx: ScanContext): Promise<Inventory> {
  const session = ctx.session.session
  const inv: Inventory = { tools: [], prompts: [], resources: [], capped: false }
  if (!session || !ctx.session.result) return inv
  const caps = isRecord(ctx.session.result.capabilities) ? ctx.session.result.capabilities : {}
  // A server that advertises nothing may still answer tools/list — ask anyway.
  const askTools = 'tools' in caps || Object.keys(caps).length === 0
  if (askTools) {
    const first = await listAll(session, 'tools/list', 'tools')
    inv.toolsOutcome = first.first
    inv.tools = first.items.map(toTool)
    inv.capped ||= first.capped
    if (first.error) inv.toolsError = first.error
    else if (!ctx.http.signal.aborted) {
      const again = await listAll(session, 'tools/list', 'tools')
      if (!again.error) inv.toolsAgain = again.items.map(toTool)
    }
  }
  if ('prompts' in caps && !ctx.http.signal.aborted) {
    const prompts = await listAll(session, 'prompts/list', 'prompts')
    inv.prompts = prompts.items.map((p) => toNamed(p, []))
    inv.capped ||= prompts.capped
  }
  if ('resources' in caps && !ctx.http.signal.aborted) {
    const resources = await listAll(session, 'resources/list', 'resources')
    const templates = await listAll(session, 'resources/templates/list', 'resourceTemplates')
    inv.resources = [
      ...resources.items.map((r) => toNamed(r, ['uri'])),
      ...templates.items.map((r) => toNamed(r, ['uriTemplate'])),
    ]
    inv.capped ||= resources.capped || templates.capped
  }
  return inv
}
