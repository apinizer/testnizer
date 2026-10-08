/**
 * MCP Security Scan — protocol revision 2026-07-28 checks (issue #152).
 *
 * Run only on a modern-era session (`server/discover` answered with a
 * 2026-07-28 descriptor); on a 2025-era session they are `skipped` with a
 * note, except `protocol.discover_present`, which reports the era itself.
 *
 *   protocol.discover_present            server/discover answers (info otherwise)
 *   protocol.mcp_method_header_validated a contradicting `Mcp-Method` is refused
 *   protocol.cacheable_results           list results carry `ttlMs` / `cacheScope`
 *   protocol.legacy_fallback             does a 2025 `initialize` still work?
 *   disclosure.cache_scope_public_with_auth  authenticated lists marked `public`
 *   auth.request_state_tampering         a forged MRTR `requestState` is refused
 *                                        (opt-in: `options.toolInvocationProbe`)
 */

import {
  ev,
  info,
  noSessionReason,
  pass,
  problem,
  skipped,
  type CheckDef,
  type CheckOutcome,
  type ScanContext,
  type ToolLite,
} from './context'
import { REFS } from './refs'
import { CLIENT_INFO, MODERN_PROTOCOL_VERSION, type RpcOutcome } from './wire'

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v)
}

/** JSON-RPC error codes of the 2026-07-28 revision. */
export const HEADER_MISMATCH = -32020
export const UNSUPPORTED_PROTOCOL_VERSION = -32022
const INVALID_PARAMS = -32602

const LEGACY_NOTE =
  'Not applicable — the session negotiated the 2025-era protocol (initialize); this is a 2026-07-28 check.'

/** Skip reason unless the session is a live 2026-07-28 one. */
function needsModern(ctx: ScanContext): CheckOutcome | null {
  if (ctx.transport === 'sse') {
    return skipped('Not applicable — legacy HTTP+SSE predates protocol 2026-07-28.')
  }
  if (!ctx.session.ok) return skipped(noSessionReason(ctx))
  return ctx.session.era === 'modern' ? null : skipped(LEGACY_NOTE)
}

// ─── protocol ───────────────────────────────────────────────

const discoverPresent: CheckDef = {
  id: 'protocol.discover_present',
  category: 'protocol',
  title: 'server/discover (protocol 2026-07-28)',
  refs: [REFS.mcp2026Lifecycle],
  run: (ctx) => {
    if (ctx.transport === 'sse') {
      return skipped('Not applicable — legacy HTTP+SSE predates protocol 2026-07-28.')
    }
    const s = ctx.session
    const attempt = s.discover
    if (s.era === 'modern') {
      return pass(
        `server/discover answers with supportedVersions ${(s.supportedVersions ?? []).join(', ')} — the scan ran on the stateless ${MODERN_PROTOCOL_VERSION} protocol.`,
        ev(attempt?.http),
      )
    }
    if (!s.ok && s.reason === 'unauthorized') return skipped(noSessionReason(ctx))
    const how = !attempt
      ? 'was not attempted'
      : attempt.rpcError
        ? `got JSON-RPC error ${attempt.rpcError.code} (${attempt.rpcError.message})`
        : attempt.result
          ? 'returned no 2026-07-28 descriptor (supportedVersions)'
          : `got ${attempt.http.status !== undefined ? `HTTP ${attempt.http.status}` : (attempt.error ?? 'no response')}`
    return info(
      `server/discover ${how} — a 2025-era server; the scan used initialize and skips the 2026-07-28 checks.`,
      ev(attempt?.http),
    )
  },
}

const mcpMethodHeader: CheckDef = {
  id: 'protocol.mcp_method_header_validated',
  category: 'protocol',
  title: 'Mcp-Method header is validated',
  refs: [REFS.mcp2026Transports],
  run: async (ctx) => {
    const blocked = needsModern(ctx)
    if (blocked) return blocked
    const session = ctx.session.session
    if (!session) return skipped(noSessionReason(ctx))
    // The body says tools/list, the header says prompts/list.
    const out = await session.request('tools/list', undefined, {
      headers: { 'Mcp-Method': 'prompts/list' },
    })
    const evidence = ev(out.http)
    const recommendation =
      'Reject a request whose Mcp-Method / Mcp-Name headers disagree with its body (HTTP 400, JSON-RPC -32020): gateways and WAFs route and authorize on the headers, so a mismatch lets a request reach a method its headers never named.'
    if (out.rpcError?.code === HEADER_MISMATCH || out.http.status === 400) {
      return pass(
        `A tools/list body with "Mcp-Method: prompts/list" is rejected (${out.rpcError ? `JSON-RPC ${out.rpcError.code}` : `HTTP ${out.http.status}`}).`,
        evidence,
      )
    }
    if (out.result) {
      return problem(
        'fail',
        'medium',
        'The server answered a tools/list body sent with "Mcp-Method: prompts/list" — it does not check the routing headers against the body.',
        recommendation,
        evidence,
      )
    }
    if (out.http.status === undefined) {
      return skipped(`No response (${out.error ?? 'unknown error'}).`)
    }
    return problem(
      'warn',
      'low',
      `The mismatching request was refused, but not as a header mismatch (${out.rpcError ? `JSON-RPC ${out.rpcError.code}` : `HTTP ${out.http.status}`}; expected HTTP 400 / -32020).`,
      recommendation,
      evidence,
    )
  },
}

/** Lists answered on the session (first page each), else the discover result itself. */
function cacheableResults(ctx: ScanContext): Array<{ method: string; out: RpcOutcome }> {
  const lists = Object.entries(ctx.inventory?.listOutcomes ?? {})
    .filter(([, out]) => !!out.result)
    .map(([method, out]) => ({ method, out }))
  if (lists.length > 0) return lists
  const discover = ctx.session.discover
  return discover?.result ? [{ method: 'server/discover', out: discover }] : []
}

function cacheHint(result: Record<string, unknown> | undefined): string | null {
  if (!result) return null
  const ttl = result.ttlMs
  const scope = result.cacheScope
  if (typeof ttl !== 'number' || (scope !== 'public' && scope !== 'private')) return null
  return `ttlMs ${ttl}, ${scope}`
}

const cacheableResultsCheck: CheckDef = {
  id: 'protocol.cacheable_results',
  category: 'protocol',
  title: 'Cache hints on list results',
  refs: [REFS.mcp2026Changelog],
  run: (ctx) => {
    const blocked = needsModern(ctx)
    if (blocked) return blocked
    const results = cacheableResults(ctx)
    if (results.length === 0) return skipped('No list result to inspect.')
    const lines: string[] = []
    const missing: string[] = []
    for (const { method, out } of results) {
      const hint = cacheHint(out.result)
      lines.push(`${method}: ${hint ?? 'no ttlMs / cacheScope'}`)
      if (!hint) missing.push(method)
    }
    const evidence = { ...ev(results[0].out.http), matches: lines }
    if (missing.length === 0) {
      return pass(`Every list result carries ttlMs and cacheScope (${lines.join('; ')}).`, evidence)
    }
    return problem(
      'warn',
      'low',
      `${missing.join(', ')} carr${missing.length === 1 ? 'ies' : 'y'} no ttlMs / cacheScope — clients and shared caches cannot tell how long, or for whom, a result may be reused.`,
      'Send `ttlMs` and `cacheScope` ("private" for anything user-specific) on 2026-07-28 list results.',
      evidence,
    )
  },
}

const legacyFallback: CheckDef = {
  id: 'protocol.legacy_fallback',
  category: 'protocol',
  title: '2025 initialize next to 2026-07-28',
  refs: [REFS.mcp2026Lifecycle, REFS.mcpLifecycle],
  run: async (ctx) => {
    const blocked = needsModern(ctx)
    if (blocked) return blocked
    const http = await ctx.http.send(
      ctx.authUrl.href,
      {
        method: 'POST',
        headers: {
          ...ctx.headers,
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'tz-scan-legacy-init',
          method: 'initialize',
          params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: CLIENT_INFO },
        }),
      },
      { auth: true, wantId: 'tz-scan-legacy-init' },
    )
    const sessionId = http.headers.get('mcp-session-id')
    if (sessionId) {
      await ctx.http
        .send(
          ctx.authUrl.href,
          { method: 'DELETE', headers: { ...ctx.headers, 'Mcp-Session-Id': sessionId } },
          { auth: true, detached: true },
        )
        .catch(() => {})
    }
    const evidence = ev(http)
    if (http.status === undefined) return skipped(`No response (${http.error ?? 'unknown error'}).`)
    const msg = isRecord(http.json) ? http.json : {}
    const result = isRecord(msg.result) ? msg.result : undefined
    const error = isRecord(msg.error) ? msg.error : undefined
    if (result) {
      const version = typeof result.protocolVersion === 'string' ? result.protocolVersion : '?'
      return info(
        `Serves both eras: a 2025 initialize is still answered (protocolVersion ${version})${sessionId ? ', with a stateful session (closed again)' : ', statelessly'} — 2025 clients keep working, and the 2025 attack surface stays open.`,
        evidence,
      )
    }
    if (error?.code === UNSUPPORTED_PROTOCOL_VERSION) {
      return info(
        `Modern only: a 2025 initialize gets JSON-RPC ${UNSUPPORTED_PROTOCOL_VERSION} Unsupported protocol version (HTTP ${http.status}).`,
        evidence,
      )
    }
    return info(
      `A 2025 initialize gets HTTP ${http.status}${typeof error?.code === 'number' ? ` (JSON-RPC ${error.code})` : ''}.`,
      evidence,
    )
  },
}

// ─── disclosure ─────────────────────────────────────────────

const cacheScopePublic: CheckDef = {
  id: 'disclosure.cache_scope_public_with_auth',
  category: 'disclosure',
  title: 'Authenticated results marked cacheable by shared caches',
  refs: [REFS.mcp2026Changelog, REFS.rfc9111NoStore],
  run: (ctx) => {
    const blocked = needsModern(ctx)
    if (blocked) return blocked
    if (!ctx.authenticated) {
      return skipped('Not applicable — the scan carried no credentials, so no result is per-user.')
    }
    const results = cacheableResults(ctx)
    if (results.length === 0) return skipped('No list result to inspect.')
    const publicOnes = results.filter((r) => r.out.result?.cacheScope === 'public')
    if (publicOnes.length === 0) {
      return pass(
        `No authenticated list result is marked cacheScope "public" (${results.map((r) => r.method).join(', ')}).`,
        ev(results[0].out.http),
      )
    }
    return problem(
      'warn',
      'medium',
      `${publicOnes.map((r) => r.method).join(', ')} answered an authenticated request with cacheScope "public" — a shared cache may serve one user's result to another (cross-user disclosure).`,
      'Mark results of authenticated requests cacheScope "private" unless they are identical for every caller.',
      { ...ev(publicOnes[0].out.http), matches: publicOnes.map((r) => `${r.method}: public`) },
    )
  },
}

// ─── auth ───────────────────────────────────────────────────

/** Tools probed for an `input_required` answer (see {@link elicitProbeCandidates}). */
export const MAX_ELICIT_PROBES = 8

/**
 * Name words of a tool that writes. Prefix-matched per word (`deleteAll`,
 * `execute_sql`, `sendEmail`) — the short, ambiguous verbs only as a whole
 * word with an inflection (`set`/`sets`, never `settings`; `post`/`posting`,
 * never `postgres`). Over-matching only means a tool is not probed.
 */
const WRITE_VERB_PREFIX =
  /^(?:send|create|delete|remove|update|write|deploy|exec|transfer|publish|notify|insert|drop|kill|restart|reset|upload|purge|revoke|submit|destroy|wipe|truncate|shutdown|modif)/
const WRITE_VERB_WORD = /^(?:set|put|post|run|pay|buy|sell|order|grant|email)(?:s|es|ed|d|ing)?$/

function nameWords(name: string): string[] {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
}

/** True when a tool name reads like a write (`create_order`, `sendEmail`, `wipe_all`, …). */
export function looksLikeWrite(name: string): boolean {
  return nameWords(name).some((w) => WRITE_VERB_PREFIX.test(w) || WRITE_VERB_WORD.test(w))
}

function hasRequiredArgs(tool: ToolLite): boolean {
  const schema = isRecord(tool.inputSchema) ? tool.inputSchema : {}
  return Array.isArray(schema.required) && schema.required.length > 0
}

/**
 * Tools the opt-in probe may call with empty arguments: argument-free tools
 * annotated read-only (first), or unannotated tools whose name does not look
 * like a write. Never a tool annotated `readOnlyHint: false` or
 * `destructiveHint: true`.
 */
export function elicitProbeCandidates(tools: readonly ToolLite[]): ToolLite[] {
  const safe = tools.filter((t) => {
    if (!t.name || hasRequiredArgs(t)) return false
    const a = t.annotations
    if (a?.destructiveHint === true || a?.readOnlyHint === false) return false
    return a?.readOnlyHint === true || !looksLikeWrite(t.name)
  })
  const readOnly = safe.filter((t) => t.annotations?.readOnlyHint === true)
  const rest = safe.filter((t) => t.annotations?.readOnlyHint !== true)
  return [...readOnly, ...rest].slice(0, MAX_ELICIT_PROBES)
}

/** A different, same-shaped token: the tail characters flipped. */
export function tamperRequestState(state: string): string {
  const tail = state.slice(-4)
  const flipped = [...tail].map((c) => (c === 'A' ? 'B' : 'A')).join('')
  return `${state.slice(0, -4)}${flipped || 'AAAA'}`
}

/** Plausible accepted content for one elicitation request (first enum value, minimums, …). */
function plausibleAnswer(request: unknown): Record<string, unknown> {
  // Sampling / roots requests (deprecated in 2026-07-28) are simply declined.
  if (!isRecord(request) || request.method !== 'elicitation/create') return { action: 'decline' }
  const params = isRecord(request.params) ? request.params : {}
  const schema = isRecord(params.requestedSchema) ? params.requestedSchema : {}
  const props = isRecord(schema.properties) ? schema.properties : {}
  const content: Record<string, unknown> = {}
  for (const [name, raw] of Object.entries(props)) {
    const p = isRecord(raw) ? raw : {}
    if (Array.isArray(p.enum) && typeof p.enum[0] === 'string') content[name] = p.enum[0]
    else if (p.type === 'number' || p.type === 'integer') {
      content[name] = typeof p.minimum === 'number' ? p.minimum : 1
    } else if (p.type === 'boolean') content[name] = false
    else content[name] = 'testnizer'
  }
  return { action: 'accept', content }
}

const ELICIT_CAPABILITIES = { elicitation: { form: {} } }

export const TOOL_PROBE_OFF =
  'Not run — this check calls tools (argument-free tools annotated read-only, or unannotated tools whose name does not look like a write — never one marked destructive) and is part of the opt-in active probes. Enable them only for servers you are authorized to test.'

const requestStateTampering: CheckDef = {
  id: 'auth.request_state_tampering',
  category: 'auth',
  title: 'Multi-round-trip requestState integrity',
  refs: [REFS.mcp2026Changelog, REFS.mcpSecurity],
  run: async (ctx) => {
    const blocked = needsModern(ctx)
    if (blocked) return blocked
    if (!ctx.toolInvocationProbe) return skipped(TOOL_PROBE_OFF)
    const session = ctx.session.session
    if (!session) return skipped(noSessionReason(ctx))
    const candidates = elicitProbeCandidates(ctx.inventory?.tools ?? [])
    const probed: string[] = []
    for (const tool of candidates) {
      if (ctx.http.signal.aborted) break
      probed.push(tool.name)
      const first = await session.request(
        'tools/call',
        { name: tool.name, arguments: {} },
        { capabilities: ELICIT_CAPABILITIES },
      )
      const r = first.result
      if (r?.resultType !== 'input_required' || typeof r.requestState !== 'string') continue
      const requests = isRecord(r.inputRequests) ? r.inputRequests : {}
      const inputResponses = Object.fromEntries(
        Object.entries(requests).map(([key, req]) => [key, plausibleAnswer(req)]),
      )
      const retry = await session.request(
        'tools/call',
        {
          name: tool.name,
          arguments: {},
          inputResponses,
          requestState: tamperRequestState(r.requestState),
        },
        { capabilities: ELICIT_CAPABILITIES },
      )
      const evidence = ev(retry.http)
      const code = retry.rpcError?.code
      if (code === INVALID_PARAMS || code === UNSUPPORTED_PROTOCOL_VERSION) {
        return pass(
          `Tool "${tool.name}" answers input_required; a retry with a tampered requestState is refused (JSON-RPC ${code}).`,
          evidence,
        )
      }
      if (retry.rpcError || (retry.http.status !== undefined && retry.http.status >= 400)) {
        return pass(
          `Tool "${tool.name}": a retry with a tampered requestState is refused (${retry.rpcError ? `JSON-RPC ${retry.rpcError.code}` : `HTTP ${retry.http.status}`}; -32602 is the spec's code).`,
          evidence,
        )
      }
      if (retry.result?.resultType === 'input_required') {
        return pass(
          `Tool "${tool.name}": a tampered requestState was not honoured — the server asked for input again.`,
          evidence,
        )
      }
      if (retry.result) {
        return problem(
          'fail',
          'high',
          `Tool "${tool.name}" completed a retry carrying a tampered requestState — the server trusts client-held state it did not verify.`,
          'Treat requestState as attacker-controlled: sign / encrypt it (the SDK codec: HMAC + expiry, bound to the tool) and reject anything that does not verify with JSON-RPC -32602.',
          evidence,
        )
      }
      return skipped(`No answer to the tampered retry (${retry.error ?? 'unknown error'}).`)
    }
    return skipped(
      probed.length === 0
        ? 'No tool qualifies for a probe call (each has required arguments, is marked destructive / not read-only, or is unannotated with a name that looks like a write) — requestState integrity not tested.'
        : `No probed tool answered input_required (called with empty arguments: ${probed.join(', ')}).`,
    )
  },
}

export const MODERN_PROTOCOL_CHECKS: CheckDef[] = [
  discoverPresent,
  mcpMethodHeader,
  cacheableResultsCheck,
  legacyFallback,
]

export const MODERN_DISCLOSURE_CHECKS: CheckDef[] = [cacheScopePublic]

export const MODERN_AUTH_CHECKS: CheckDef[] = [requestStateTampering]
