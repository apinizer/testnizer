/**
 * MCP Security Scan (issue #142) — `protocol.*`, `cors.*` and `headers.*` checks.
 */

import { randomUUID } from 'node:crypto'
import { SUPPORTED_PROTOCOL_VERSIONS } from '@modelcontextprotocol/sdk/types.js'
import { compileSchema } from '../../mock-mcp/args-validator'
import {
  ev,
  info,
  noSessionReason,
  pass,
  problem,
  serverInfoFromResult,
  skipped,
  type CheckDef,
  type CheckOutcome,
  type ScanContext,
  type ToolLite,
} from './context'
import { REFS } from './refs'
import { MODERN_PROTOCOL_VERSION, modernEnvelope, type HttpResult } from './wire'

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v)
}

const MAX_LISTED = 25

/** Skip reason when the authenticated session is unusable, else null. */
function needsSession(ctx: ScanContext): CheckOutcome | null {
  return ctx.session.ok ? null : skipped(noSessionReason(ctx))
}

// ─── protocol ───────────────────────────────────────────────

/**
 * The handshake result: `initialize` (2025) or — on a 2026-07-28 session —
 * the `server/discover` descriptor (`supportedVersions`, `capabilities`,
 * serverInfo in `_meta`). The id predates issue #152 and stays stable.
 */
const initializeShape: CheckDef = {
  id: 'protocol.initialize_shape',
  category: 'protocol',
  title: 'Handshake result (initialize / server/discover)',
  refs: [REFS.mcpLifecycle],
  run: (ctx) => {
    const s = ctx.session
    if (!s.ok) {
      if (s.reason === 'unauthorized') {
        return { ...skipped(noSessionReason(ctx)), evidence: ev(s.init?.http) }
      }
      return problem(
        'fail',
        'high',
        `initialize did not succeed: ${s.error ?? 'unknown error'}.`,
        'Answer `initialize` with a JSON-RPC result carrying protocolVersion, capabilities and serverInfo (MCP lifecycle).',
        ev(s.init?.http),
      )
    }
    const r = s.result ?? {}
    const modern = s.era === 'modern'
    const problems: string[] = []
    let version: string
    if (modern) {
      const versions = Array.isArray(r.supportedVersions) ? r.supportedVersions : []
      if (versions.length === 0 || !versions.every((v) => typeof v === 'string')) {
        problems.push('`supportedVersions` is not a non-empty list of version strings.')
      }
      version = versions.join(', ')
    } else {
      const v = r.protocolVersion
      version = typeof v === 'string' ? v : ''
      if (typeof v !== 'string') problems.push('`protocolVersion` is missing.')
      else if (!SUPPORTED_PROTOCOL_VERSIONS.includes(v)) {
        problems.push(
          `protocolVersion "${v}" is not one this client supports (${SUPPORTED_PROTOCOL_VERSIONS.join(', ')}).`,
        )
      }
    }
    if (!isRecord(r.capabilities)) problems.push('`capabilities` is not an object.')
    const serverInfo = serverInfoFromResult(r)
    if (typeof serverInfo?.name !== 'string' || !serverInfo.name) {
      problems.push(
        modern
          ? '`_meta["io.modelcontextprotocol/serverInfo"].name` is missing.'
          : '`serverInfo.name` is missing.',
      )
    }
    const evidence = ev(s.init?.http)
    if (problems.length > 0) {
      return problem(
        'fail',
        'medium',
        problems.join(' '),
        modern
          ? 'Return a spec-shaped server/discover result (supportedVersions, capabilities, serverInfo) so clients can negotiate safely.'
          : 'Return a spec-shaped initialize result so clients can negotiate features safely.',
        evidence,
      )
    }
    const caps = Object.keys(r.capabilities as Record<string, unknown>)
    return pass(
      `${modern ? 'server/discover — supportedVersions' : 'protocolVersion'} ${version}; serverInfo ${String(serverInfo?.name)} ${String(serverInfo?.version ?? '')}; capabilities: ${caps.join(', ') || '(none)'}.`,
      evidence,
    )
  },
}

const names = (tools: ToolLite[]): string[] => tools.map((t) => t.name)

const toolsDeterministic: CheckDef = {
  id: 'protocol.tools_list_deterministic',
  category: 'protocol',
  title: 'tools/list is stable',
  refs: [REFS.mcpTools],
  run: (ctx) => {
    const blocked = needsSession(ctx)
    if (blocked) return blocked
    const inv = ctx.inventory
    if (!inv?.toolsOutcome) return skipped('The server does not advertise the tools capability.')
    const evidence = ev(inv.toolsOutcome.http)
    if (inv.toolsError) {
      return problem(
        'fail',
        'medium',
        `tools/list failed: ${inv.toolsError}.`,
        'Answer tools/list whenever the tools capability is advertised.',
        evidence,
      )
    }
    if (!inv.toolsAgain) return skipped('The second tools/list call did not succeed.')
    const a = names(inv.tools)
    const b = names(inv.toolsAgain)
    if (a.join('\n') === b.join('\n')) {
      return pass(`${a.length} tool(s), in the same order on two consecutive calls.`, evidence)
    }
    const sameSet = [...a].sort().join('\n') === [...b].sort().join('\n')
    return problem(
      'warn',
      'low',
      sameSet
        ? 'The same tools come back in a different order on two consecutive calls — clients that diff or cache tool lists (and model prompt caches) see needless churn.'
        : 'The tool list changed between two consecutive calls without a list_changed notification — tools can appear or vanish under a client.',
      'Return tools in a stable order and send notifications/tools/list_changed when the set really changes.',
      {
        ...evidence,
        matches: [`1st: ${a.slice(0, 50).join(', ')}`, `2nd: ${b.slice(0, 50).join(', ')}`],
      },
    )
  },
}

function schemaProblem(schema: unknown, label: string): string | null {
  if (!isRecord(schema)) return `${label} is missing or not an object`
  if (schema.type !== 'object')
    return `${label}.type is ${JSON.stringify(schema.type)}, must be "object"`
  const compiled = compileSchema(schema)
  return compiled.ok ? null : `${label} does not compile: ${compiled.error}`
}

const schemasWellformed: CheckDef = {
  id: 'protocol.schemas_wellformed',
  category: 'protocol',
  title: 'Tool schemas are well-formed',
  refs: [REFS.mcpTools, REFS.jsonSchema],
  run: (ctx) => {
    const blocked = needsSession(ctx)
    if (blocked) return blocked
    const tools = ctx.inventory?.tools ?? []
    if (tools.length === 0) return skipped('No tools advertised.')
    const problems: string[] = []
    let outputs = 0
    for (const tool of tools) {
      const inp = schemaProblem(tool.inputSchema, 'inputSchema')
      if (inp) problems.push(`tool "${tool.name}": ${inp}`)
      if (tool.outputSchema !== undefined) {
        outputs++
        const out = schemaProblem(tool.outputSchema, 'outputSchema')
        if (out) problems.push(`tool "${tool.name}": ${out}`)
      }
    }
    const evidence = ev(ctx.inventory?.toolsOutcome?.http)
    if (problems.length > 0) {
      return problem(
        'fail',
        'medium',
        `${problems.length} schema problem(s) across ${tools.length} tools.`,
        'Every tool needs an `inputSchema` (and optional `outputSchema`) that is a JSON Schema object with `type: "object"` — clients and models rely on it to build and validate arguments.',
        { ...evidence, matches: problems.slice(0, MAX_LISTED) },
      )
    }
    return pass(
      `${tools.length} input schema(s)${outputs ? ` and ${outputs} output schema(s)` : ''} are objects and compile.`,
      evidence,
    )
  },
}

const unknownMethod: CheckDef = {
  id: 'protocol.unknown_method',
  category: 'protocol',
  title: 'Unknown method handling',
  refs: [REFS.jsonRpc],
  run: async (ctx) => {
    const blocked = needsSession(ctx)
    if (blocked) return blocked
    const session = ctx.session.session
    if (!session) return skipped(noSessionReason(ctx))
    const out = await session.request(`testnizer/unknown-method-${randomUUID().slice(0, 8)}`)
    const evidence = ev(out.http)
    const recommendation =
      'Answer unknown methods with JSON-RPC error -32601 (Method not found) — never a result, an HTTP 500 or an HTML error page.'
    if (out.rpcError?.code === -32601) {
      return pass('An unknown method gets JSON-RPC -32601 Method not found.', evidence)
    }
    if (out.rpcError) {
      return problem(
        'warn',
        'low',
        `An unknown method gets JSON-RPC error ${out.rpcError.code} (expected -32601).`,
        recommendation,
        evidence,
      )
    }
    if (out.result) {
      return problem(
        'warn',
        'low',
        'The server returned a result for a method that does not exist — it does not validate method names.',
        recommendation,
        evidence,
      )
    }
    if (out.http.status === undefined)
      return skipped(`No response (${out.error ?? 'unknown error'}).`)
    return problem(
      'warn',
      'low',
      `An unknown method gets HTTP ${out.http.status} (${out.http.headers.get('content-type') ?? 'no content type'}) instead of a JSON-RPC error.`,
      recommendation,
      evidence,
    )
  },
}

const BATCH_REMOVED_IN = '2025-06-18'

const batchRejected: CheckDef = {
  id: 'protocol.batch_rejected',
  category: 'protocol',
  title: 'JSON-RPC batching rejected',
  refs: [REFS.mcpChangelog0618, REFS.mcpTransports],
  run: async (ctx) => {
    if (ctx.transport === 'sse') return skipped('Not applicable to the legacy HTTP+SSE transport.')
    const blocked = needsSession(ctx)
    if (blocked) return blocked
    const session = ctx.session.session
    if (!session) return skipped(noSessionReason(ctx))
    if (session.era === 'modern') return modernBatch(ctx)
    const version = session.protocolVersion
    if (version && version < BATCH_REMOVED_IN) {
      return skipped(
        `Not applicable — the negotiated protocol ${version} still allows JSON-RPC batching (removed in ${BATCH_REMOVED_IN}).`,
      )
    }
    const http = await session.postRaw(
      JSON.stringify([
        { jsonrpc: '2.0', id: 'tz-scan-batch-1', method: 'ping' },
        { jsonrpc: '2.0', id: 'tz-scan-batch-2', method: 'ping' },
      ]),
    )
    if (!http || http.status === undefined) {
      return skipped(`No response to the batch (${http?.error ?? 'no session'}).`)
    }
    const evidence = ev(http)
    if (http.status >= 400 && http.status < 500) {
      return pass(`A JSON-RPC batch is rejected with HTTP ${http.status}.`, evidence)
    }
    const message = Array.isArray(http.json) ? http.json[0] : http.json
    if (isRecord(message) && 'result' in message) {
      return problem(
        'warn',
        'low',
        `The server processed a JSON-RPC batch although the negotiated protocol (${version ?? 'unknown'}) removed batching.`,
        'Reject JSON arrays with HTTP 400 / a JSON-RPC error on sessions negotiated at 2025-06-18 or later.',
        evidence,
      )
    }
    if (isRecord(message) && isRecord(message.error)) {
      return pass('A JSON-RPC batch is rejected with a JSON-RPC error.', evidence)
    }
    return info(`A JSON-RPC batch got HTTP ${http.status}.`, evidence)
  },
}

/**
 * 2026-07-28 has no JSON-RPC batching at all: a JSON array must be rejected
 * (HTTP 4xx / a JSON-RPC error). Processing it is a conformance gap with the
 * same weight as on a 2025-06-18+ session.
 */
async function modernBatch(ctx: ScanContext): Promise<CheckOutcome> {
  const session = ctx.session.session
  if (!session) return skipped(noSessionReason(ctx))
  const member = (id: string): Record<string, unknown> => ({
    jsonrpc: '2.0',
    id,
    method: 'tools/list',
    params: { _meta: modernEnvelope() },
  })
  const http = await session.postRaw(
    JSON.stringify([member('tz-scan-batch-1'), member('tz-scan-batch-2')]),
  )
  if (!http || http.status === undefined) {
    return skipped(`No response to the batch (${http?.error ?? 'no session'}).`)
  }
  const evidence = ev(http)
  const message = Array.isArray(http.json) ? http.json[0] : http.json
  if (http.status >= 400 && http.status < 500) {
    return pass(
      `A JSON-RPC batch is rejected with HTTP ${http.status} — ${MODERN_PROTOCOL_VERSION} has no batching.`,
      evidence,
    )
  }
  if (isRecord(message) && isRecord(message.error)) {
    return pass(
      `A JSON-RPC batch is rejected with a JSON-RPC error (${MODERN_PROTOCOL_VERSION} has no batching).`,
      evidence,
    )
  }
  if (isRecord(message) && 'result' in message) {
    return problem(
      'warn',
      'low',
      `The server processed a JSON-RPC batch on protocol ${MODERN_PROTOCOL_VERSION}, which has no batching at all.`,
      'Reject JSON arrays with HTTP 400 / JSON-RPC -32600 on 2026-07-28 requests.',
      evidence,
    )
  }
  return info(`A JSON-RPC batch got HTTP ${http.status}.`, evidence)
}

// ─── cors ───────────────────────────────────────────────────

export const EVIL_ORIGIN = 'https://evil.example'

interface CorsVerdict {
  outcome: CheckOutcome
  rank: number
}

function corsVerdict(http: HttpResult, label: string): CorsVerdict {
  const acao = (http.headers.get('access-control-allow-origin') ?? '').trim()
  const credentials =
    (http.headers.get('access-control-allow-credentials') ?? '').trim().toLowerCase() === 'true'
  const evidence = ev(http)
  const recommendation =
    'MCP is server-to-agent traffic: send no CORS headers at all, or allow-list exact trusted origins — never `*` or a reflected Origin, and never together with credentials. Validate the Origin header (DNS-rebinding protection).'
  if (!acao) return { rank: 0, outcome: pass(`No CORS headers on the ${label}.`, evidence) }
  const reflected = acao === EVIL_ORIGIN || acao === 'null'
  if ((acao === '*' || reflected) && credentials) {
    return {
      rank: 4,
      outcome: problem(
        'fail',
        'high',
        `The ${label} answers Origin ${EVIL_ORIGIN} with Access-Control-Allow-Origin: ${acao} and Access-Control-Allow-Credentials: true — any web page could drive this server with the user's credentials.`,
        recommendation,
        evidence,
      ),
    }
  }
  if (reflected) {
    return {
      rank: 3,
      outcome: problem(
        'fail',
        'medium',
        `The ${label} reflects an arbitrary Origin (${acao}) in Access-Control-Allow-Origin.`,
        recommendation,
        evidence,
      ),
    }
  }
  if (acao === '*') {
    return {
      rank: 2,
      outcome: problem(
        'warn',
        'low',
        `The ${label} sends Access-Control-Allow-Origin: * — any web page can read responses (an exfiltration path for an unauthenticated or cookie-free server).`,
        recommendation,
        evidence,
      ),
    }
  }
  return { rank: 1, outcome: pass(`CORS allows only ${acao} on the ${label}.`, evidence) }
}

const corsCheck: CheckDef = {
  id: 'cors.cors_wildcard_with_credentials',
  category: 'cors',
  title: 'CORS policy',
  refs: [REFS.fetchCors, REFS.mcpSecurity],
  run: async (ctx) => {
    const preflight = await ctx.http.send(
      ctx.url.href,
      {
        method: 'OPTIONS',
        headers: {
          ...ctx.anonHeaders,
          Origin: EVIL_ORIGIN,
          'Access-Control-Request-Method': 'POST',
          'Access-Control-Request-Headers':
            'content-type, authorization, mcp-session-id, mcp-protocol-version',
        },
      },
      { auth: false },
    )
    const verdicts: CorsVerdict[] = []
    if (preflight.status !== undefined) verdicts.push(corsVerdict(preflight, 'preflight (OPTIONS)'))
    const rpc = ctx.session.session?.rpcResponse ?? ctx.unauth?.http
    if (rpc?.status !== undefined) verdicts.push(corsVerdict(rpc, 'JSON-RPC response'))
    if (verdicts.length === 0)
      return skipped(`No response to the CORS preflight (${preflight.error ?? 'unknown error'}).`)
    return verdicts.reduce((worst, v) => (v.rank > worst.rank ? v : worst)).outcome
  },
}

// ─── headers ────────────────────────────────────────────────

/** The response that carried JSON-RPC results — the session's, else a 2xx unauthenticated one. */
function rpcResponse(ctx: ScanContext): HttpResult | undefined {
  const fromSession = ctx.session.ok ? ctx.session.session?.rpcResponse : undefined
  if (fromSession?.status !== undefined) return fromSession
  const u = ctx.unauth?.http
  return u?.status !== undefined && u.status >= 200 && u.status < 300 ? u : undefined
}

function headerCheck(
  id: string,
  title: string,
  refs: string[],
  evaluate: (http: HttpResult, ctx: ScanContext) => CheckOutcome,
): CheckDef {
  return {
    id,
    category: 'headers',
    title,
    refs,
    run: (ctx) => {
      const http = rpcResponse(ctx)
      if (!http) return skipped('No successful JSON-RPC response to inspect.')
      return evaluate(http, ctx)
    },
  }
}

const HSTS_MIN_MAX_AGE = 15_552_000 // 180 days

const hsts = headerCheck(
  'headers.hsts',
  'Strict-Transport-Security',
  [REFS.rfc6797, REFS.owaspHeaders],
  (http, ctx) => {
    if (ctx.url.protocol !== 'https:') return skipped('Not applicable — plain HTTP.')
    const value = http.headers.get('strict-transport-security')
    const evidence = ev(http)
    const recommendation = 'Send `Strict-Transport-Security: max-age=31536000; includeSubDomains`.'
    if (!value)
      return problem(
        'warn',
        'low',
        'No Strict-Transport-Security header.',
        recommendation,
        evidence,
      )
    const maxAge = Number(/max-age\s*=\s*"?(\d+)/i.exec(value)?.[1] ?? '0')
    if (maxAge < HSTS_MIN_MAX_AGE) {
      return problem(
        'warn',
        'low',
        `Strict-Transport-Security max-age=${maxAge} is short (< 180 days).`,
        recommendation,
        evidence,
      )
    }
    return pass(`Strict-Transport-Security: ${value}`, evidence)
  },
)

const nosniff = headerCheck(
  'headers.x_content_type_options',
  'X-Content-Type-Options',
  [REFS.owaspHeaders],
  (http) => {
    const value = (http.headers.get('x-content-type-options') ?? '').trim().toLowerCase()
    if (value === 'nosniff') return pass('X-Content-Type-Options: nosniff', ev(http))
    return problem(
      'warn',
      'low',
      `X-Content-Type-Options is ${value ? `"${value}"` : 'absent'} on the JSON-RPC response.`,
      'Send `X-Content-Type-Options: nosniff` so browsers never sniff a JSON-RPC body as HTML.',
      ev(http),
    )
  },
)

const contentType = headerCheck(
  'headers.content_type_json',
  'JSON-RPC Content-Type',
  [REFS.mcpTransports],
  (http) => {
    const value = (http.headers.get('content-type') ?? '').toLowerCase()
    const evidence = ev(http)
    const recommendation =
      'Serve JSON-RPC responses as `application/json` or `text/event-stream` (Streamable HTTP) — never `text/html`.'
    if (value.includes('application/json') || value.includes('text/event-stream')) {
      return pass(`Content-Type: ${value}`, evidence)
    }
    if (value.includes('text/html')) {
      return problem(
        'fail',
        'medium',
        'JSON-RPC responses are served as text/html — a browser renders attacker-influenced tool output as a page (XSS).',
        recommendation,
        evidence,
      )
    }
    return problem(
      'warn',
      'low',
      `JSON-RPC responses are served as "${value || '(no Content-Type)'}".`,
      recommendation,
      evidence,
    )
  },
)

const cacheControl = headerCheck(
  'headers.cache_control',
  'Cache-Control',
  [REFS.rfc9111NoStore, REFS.owaspHeaders],
  (http) => {
    const value = http.headers.get('cache-control') ?? ''
    if (/\bno-store\b/i.test(value)) return pass(`Cache-Control: ${value}`, ev(http))
    return problem(
      'warn',
      'low',
      `Cache-Control is ${value ? `"${value}"` : 'absent'} — without no-store, an intermediary or client cache may keep tool results.`,
      'Send `Cache-Control: no-store` on JSON-RPC responses (they carry per-user, often sensitive, data).',
      ev(http),
    )
  },
)

export const PROTOCOL_CHECKS: CheckDef[] = [
  initializeShape,
  toolsDeterministic,
  schemasWellformed,
  unknownMethod,
  batchRejected,
]

export const CORS_CHECKS: CheckDef[] = [corsCheck]

export const HEADER_CHECKS: CheckDef[] = [hsts, nosniff, contentType, cacheControl]
