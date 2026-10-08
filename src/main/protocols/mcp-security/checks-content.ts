/**
 * MCP Security Scan (issue #142) — `injection.*`, `disclosure.*` and
 * `ratelimit.*` checks.
 *
 * The injection heuristics FLAG model-visible text for review; none of them
 * fails above medium.
 */

import {
  OVERSIZED_DESCRIPTION_CHARS,
  findHiddenUnicode,
  findInstructionOverrides,
  findSecretLikeFields,
  findShadowingGroups,
  findUrls,
  findVerboseError,
  isVerboseVersion,
  makeVisible,
  type Hit,
  type TextItem,
} from './heuristics'
import {
  ev,
  info,
  isLoopbackHost,
  memo,
  noSessionReason,
  pass,
  problem,
  serverInfoFromResult,
  skipped,
  type CheckDef,
  type CheckOutcome,
  type ScanContext,
} from './context'
import { REFS } from './refs'
import type { HttpResult } from './wire'

const MAX_LISTED = 25

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v)
}

/** Parameter descriptions of a schema, with their dotted paths. */
function paramDescriptions(schema: unknown, prefix = '', depth = 0): Array<[string, string]> {
  if (!isRecord(schema) || depth > 6) return []
  const out: Array<[string, string]> = []
  if (isRecord(schema.properties)) {
    for (const [name, sub] of Object.entries(schema.properties)) {
      const path = prefix ? `${prefix}.${name}` : name
      if (isRecord(sub) && typeof sub.description === 'string') out.push([path, sub.description])
      out.push(...paramDescriptions(sub, path, depth + 1))
    }
  }
  if (schema.items) out.push(...paramDescriptions(schema.items, `${prefix}[]`, depth + 1))
  return out
}

/**
 * Everything the server shows the model. `descriptionsOnly` leaves out the
 * names and titles (for checks about prose: URLs, size).
 */
export function modelVisibleText(ctx: ScanContext, descriptionsOnly = false): TextItem[] {
  const items: TextItem[] = []
  const add = (where: string, text: string | undefined): void => {
    if (text) items.push({ where, text })
  }
  const inv = ctx.inventory
  for (const tool of inv?.tools ?? []) {
    if (!descriptionsOnly) {
      add(`tool "${makeVisible(tool.name)}" name`, tool.name)
      add(`tool "${makeVisible(tool.name)}" title`, tool.title)
    }
    add(`tool "${makeVisible(tool.name)}" description`, tool.description)
    for (const [path, text] of paramDescriptions(tool.inputSchema)) {
      add(`tool "${makeVisible(tool.name)}" parameter "${path}"`, text)
    }
  }
  for (const p of inv?.prompts ?? []) {
    if (!descriptionsOnly) add(`prompt "${makeVisible(p.name)}" name`, p.name)
    add(`prompt "${makeVisible(p.name)}" description`, p.description)
    for (const text of p.extra ?? []) add(`prompt "${makeVisible(p.name)}" argument`, text)
  }
  for (const r of inv?.resources ?? []) {
    if (!descriptionsOnly) {
      add(`resource "${makeVisible(r.name)}" name`, r.name)
      add(`resource "${makeVisible(r.name)}" title`, r.title)
    }
    add(`resource "${makeVisible(r.name)}" description`, r.description)
  }
  const instructions = ctx.session.result?.instructions
  if (typeof instructions === 'string') add('server instructions', instructions)
  return items
}

/** Skip unless there is an authenticated session with something advertised. */
function needsInventory(ctx: ScanContext): CheckOutcome | null {
  if (!ctx.session.ok) return skipped(noSessionReason(ctx))
  if (modelVisibleText(ctx).length === 0) {
    return skipped('Nothing to inspect — the server advertises no tools, prompts or resources.')
  }
  return null
}

const listHits = (hits: Hit[]): string[] =>
  hits.slice(0, MAX_LISTED).map((h) => `${h.where}: ${h.excerpt} [${h.rule}]`)

function inventoryEvidence(ctx: ScanContext, matches: string[]): CheckOutcome['evidence'] {
  return ev(ctx.inventory?.toolsOutcome?.http, matches)
}

// ─── injection ──────────────────────────────────────────────

const instructionOverride: CheckDef = {
  id: 'injection.instruction_override',
  category: 'injection',
  title: 'Instruction-override phrasing',
  refs: [REFS.mcpToolsSecurity, REFS.mcpSecurity],
  run: (ctx) => {
    const blocked = needsInventory(ctx)
    if (blocked) return blocked
    const items = modelVisibleText(ctx)
    const hits = findInstructionOverrides(items)
    if (hits.length === 0) {
      return pass(
        `${items.length} model-visible texts inspected; no instruction-override phrasing.`,
      )
    }
    const strong = hits.some((h) => h.strong)
    return problem(
      strong ? 'fail' : 'warn',
      'medium',
      `${hits.length} passage(s) read like instructions to the model rather than a description${strong ? ' — classic tool-poisoning phrasing' : ''}. Review them.`,
      'Descriptions should only say what a tool does. Text that tells the model to ignore instructions, hide things from the user, call a tool first or send data elsewhere is the signature of tool poisoning.',
      inventoryEvidence(ctx, listHits(hits)),
    )
  },
}

const hiddenUnicode: CheckDef = {
  id: 'injection.hidden_unicode',
  category: 'injection',
  title: 'Hidden Unicode characters',
  refs: [REFS.uts36, REFS.uts39, REFS.mcpToolsSecurity],
  run: (ctx) => {
    const blocked = needsInventory(ctx)
    if (blocked) return blocked
    const { invisible, mixedScript } = findHiddenUnicode(modelVisibleText(ctx))
    const recommendation =
      'Remove zero-width, bidi-control and tag characters and keep identifiers in one script — they hide text from the human reviewer while the model still reads it.'
    if (invisible.length > 0) {
      return problem(
        'fail',
        'medium',
        `${invisible.length} text(s) contain invisible or bidi-control characters${mixedScript.length ? `, ${mixedScript.length} word(s) mix scripts` : ''}.`,
        recommendation,
        inventoryEvidence(
          ctx,
          [...listHits(invisible), ...listHits(mixedScript)].slice(0, MAX_LISTED),
        ),
      )
    }
    if (mixedScript.length > 0) {
      return problem(
        'warn',
        'low',
        `${mixedScript.length} word(s) mix Latin with look-alike Cyrillic / Greek / Armenian letters (homoglyphs).`,
        recommendation,
        inventoryEvidence(ctx, listHits(mixedScript)),
      )
    }
    return pass('No invisible, bidi-control, tag or mixed-script characters.')
  },
}

const urlsInDescriptions: CheckDef = {
  id: 'injection.urls_in_descriptions',
  category: 'injection',
  title: 'URLs and IP addresses in descriptions',
  refs: [REFS.mcpToolsSecurity],
  run: (ctx) => {
    const blocked = needsInventory(ctx)
    if (blocked) return blocked
    const risky: string[] = []
    const plain: string[] = []
    for (const item of modelVisibleText(ctx, true)) {
      const { urls, ips } = findUrls(item.text)
      for (const url of urls) {
        let host = ''
        try {
          host = new URL(url).hostname
        } catch {
          host = ''
        }
        const line = `${item.where}: ${url}`
        if (/^http:/i.test(url) && !isLoopbackHost(host)) risky.push(line)
        else plain.push(line)
      }
      for (const ip of ips) {
        if (!urls.some((u) => u.includes(ip))) risky.push(`${item.where}: ${ip}`)
      }
    }
    if (risky.length > 0) {
      return problem(
        'warn',
        'low',
        `${risky.length} plain-HTTP URL(s) or raw IP address(es) in descriptions — a common exfiltration target in poisoned tools.`,
        'Check that every endpoint a description mentions is expected; a model may follow it.',
        inventoryEvidence(ctx, [...risky, ...plain].slice(0, MAX_LISTED)),
      )
    }
    if (plain.length > 0) {
      return info(
        `${plain.length} HTTPS URL(s) in descriptions — listed for review.`,
        inventoryEvidence(ctx, plain.slice(0, MAX_LISTED)),
      )
    }
    return pass('No URLs or IP addresses in descriptions.')
  },
}

const oversized: CheckDef = {
  id: 'injection.oversized_description',
  category: 'injection',
  title: 'Oversized descriptions',
  refs: [REFS.mcpToolsSecurity],
  run: (ctx) => {
    const blocked = needsInventory(ctx)
    if (blocked) return blocked
    const big = modelVisibleText(ctx, true).filter(
      (i) => i.text.length > OVERSIZED_DESCRIPTION_CHARS,
    )
    if (big.length === 0) {
      return pass(`Every description is at most ${OVERSIZED_DESCRIPTION_CHARS} characters.`)
    }
    return problem(
      'warn',
      'low',
      `${big.length} description(s) exceed ${OVERSIZED_DESCRIPTION_CHARS} characters — long descriptions are where hidden instructions get buried, and they cost context on every request.`,
      'Keep descriptions short and factual; move documentation to a resource.',
      inventoryEvidence(
        ctx,
        big.slice(0, MAX_LISTED).map((i) => `${i.where}: ${i.text.length} chars`),
      ),
    )
  },
}

const toolShadowing: CheckDef = {
  id: 'injection.tool_shadowing',
  category: 'injection',
  title: 'Look-alike tool names',
  refs: [REFS.mcpToolsSecurity, REFS.uts39],
  run: (ctx) => {
    if (!ctx.session.ok) return skipped(noSessionReason(ctx))
    const tools = ctx.inventory?.tools ?? []
    if (tools.length === 0) return skipped('No tools advertised.')
    const groups = findShadowingGroups(tools.map((t) => t.name))
    if (groups.length === 0) return pass(`${tools.length} tool name(s), all distinct.`)
    return problem(
      'fail',
      'medium',
      `${groups.length} group(s) of tool names differ only by case, separators or look-alike Unicode — a model (or a reviewer) can call the wrong one.`,
      'Give every tool a clearly distinct ASCII name; duplicate or look-alike names are how a malicious tool shadows a trusted one.',
      inventoryEvidence(
        ctx,
        groups.slice(0, MAX_LISTED).map((g) => g.map((n) => `"${makeVisible(n)}"`).join(' ≈ ')),
      ),
    )
  },
}

const secretLikeFields: CheckDef = {
  id: 'injection.secret_like_schema_fields',
  category: 'injection',
  title: 'Secret-like parameters',
  refs: [REFS.mcpToolsSecurity],
  run: (ctx) => {
    if (!ctx.session.ok) return skipped(noSessionReason(ctx))
    const tools = ctx.inventory?.tools ?? []
    if (tools.length === 0) return skipped('No tools advertised.')
    const found: string[] = []
    for (const tool of tools) {
      for (const path of findSecretLikeFields(tool.inputSchema)) {
        found.push(`tool "${makeVisible(tool.name)}" parameter "${path}"`)
      }
    }
    if (found.length === 0) return pass('No undocumented password / token / secret parameters.')
    return problem(
      'warn',
      'low',
      `${found.length} parameter(s) named like credentials or personal data have no description — the model is asked to fill in a secret without being told why.`,
      'Avoid taking credentials as tool arguments (use the transport auth); if unavoidable, describe exactly what is expected and why.',
      inventoryEvidence(ctx, found.slice(0, MAX_LISTED)),
    )
  },
}

// ─── disclosure ─────────────────────────────────────────────

const MALFORMED_JSON = '{"jsonrpc":"2.0","id":"tz-scan-malformed","method":"tools/list",'

const errorVerbosity: CheckDef = {
  id: 'disclosure.error_verbosity',
  category: 'disclosure',
  title: 'Error verbosity',
  refs: [REFS.owaspErrors, REFS.jsonRpc],
  run: async (ctx) => {
    let http: HttpResult | undefined
    if (ctx.session.ok && ctx.session.session) {
      http = await ctx.session.session.postRaw(MALFORMED_JSON)
    } else if (ctx.transport === 'http') {
      http = await ctx.http.send(
        ctx.authUrl.href,
        {
          method: 'POST',
          headers: {
            ...ctx.headers,
            'Content-Type': 'application/json',
            Accept: 'application/json, text/event-stream',
          },
          body: MALFORMED_JSON,
        },
        { auth: true },
      )
    }
    if (!http || http.status === undefined) {
      return skipped(`No response to a malformed request (${http?.error ?? noSessionReason(ctx)}).`)
    }
    const leaks = findVerboseError(http.text)
    const evidence = ev(http)
    if (leaks.length > 0) {
      return problem(
        'fail',
        'medium',
        `The error for a malformed JSON body leaks internals (${leaks.join(', ')}).`,
        'Return a generic JSON-RPC -32700 Parse error; log stack traces server-side only.',
        evidence,
      )
    }
    return pass(
      `Malformed JSON → HTTP ${http.status}; no stack trace, file path or framework internals in the body.`,
      evidence,
    )
  },
}

const IDENTIFYING_HEADERS = ['x-powered-by', 'x-aspnet-version', 'x-aspnetmvc-version', 'x-runtime']

const serverHeader: CheckDef = {
  id: 'disclosure.server_header',
  category: 'disclosure',
  title: 'Server / X-Powered-By headers',
  refs: [REFS.owaspHeaders],
  run: (ctx) => {
    const origin = ctx.url.origin
    const seen = new Map<string, Set<string>>()
    let first: CheckOutcome['evidence']
    for (const ex of ctx.http.exchanges) {
      let sameOrigin = false
      try {
        sameOrigin = new URL(ex.request?.url ?? '').origin === origin
      } catch {
        sameOrigin = false
      }
      if (!sameOrigin || !ex.response) continue
      for (const [name, value] of Object.entries(ex.response.headers)) {
        const key = name.toLowerCase()
        if (key !== 'server' && !IDENTIFYING_HEADERS.includes(key)) continue
        const values = seen.get(key) ?? new Set<string>()
        values.add(value)
        seen.set(key, values)
        first ??= { request: ex.request, response: ex.response }
      }
    }
    if (seen.size === 0) return pass('No Server / X-Powered-By style headers.')
    const lines = [...seen].map(([k, v]) => `${k}: ${[...v].join(' | ')}`)
    const versioned = [...(seen.get('server') ?? [])].some((v) => /\d/.test(v))
    const identifying = IDENTIFYING_HEADERS.some((h) => seen.has(h))
    const evidence = { ...first, matches: lines }
    if (identifying || versioned) {
      return problem(
        'fail',
        'low',
        `Response headers reveal the server stack: ${lines.join('; ')}.`,
        'Drop X-Powered-By (Express: `app.disable("x-powered-by")`) and version numbers from Server.',
        evidence,
      )
    }
    return info(`Server header without a version: ${lines.join('; ')}.`, evidence)
  },
}

const serverInfoVerbosity: CheckDef = {
  id: 'disclosure.server_info_verbosity',
  category: 'disclosure',
  title: 'serverInfo / instructions verbosity',
  refs: [REFS.mcpLifecycle],
  run: (ctx) => {
    if (!ctx.session.ok) return skipped(noSessionReason(ctx))
    const r = ctx.session.result ?? {}
    const serverInfo = serverInfoFromResult(r) ?? {}
    const version = typeof serverInfo.version === 'string' ? serverInfo.version : ''
    const notes: string[] = []
    if (version && isVerboseVersion(version)) {
      notes.push(`serverInfo.version "${version}" looks like a build stamp (semver + commit hash).`)
    }
    if (typeof r.instructions === 'string') {
      const leaks = findVerboseError(r.instructions).filter(
        (id) => id === 'fs-path' || id === 'node_modules',
      )
      if (leaks.length > 0) notes.push('`instructions` mention file-system paths.')
    }
    const evidence = ev(ctx.session.init?.http)
    if (notes.length > 0) return info(notes.join(' '), evidence)
    return pass(`serverInfo: ${String(serverInfo.name ?? '')} ${version}.`, evidence)
  },
}

// ─── ratelimit ──────────────────────────────────────────────

export const RATE_PROBE_REQUESTS = 30
const RATE_PROBE_WORKERS = 5
const RATE_HEADER = /^(x-)?rate-?limit|^retry-after$/i

interface RateProbe {
  sent: number
  limited: number
  methods: Set<string>
  headers: Set<string>
  first?: HttpResult
}

function rateLimitHeaders(headers: Record<string, string> | undefined): string[] {
  return Object.keys(headers ?? {}).filter((h) => RATE_HEADER.test(h))
}

function runRateProbe(ctx: ScanContext): Promise<RateProbe> {
  return memo(ctx, 'rate-probe', async () => {
    const probe: RateProbe = { sent: 0, limited: 0, methods: new Set(), headers: new Set() }
    const session = ctx.session.ok ? ctx.session.session : undefined
    if (!session) return probe
    const withTools = !!ctx.inventory?.toolsOutcome?.result
    // 2026-07-28 has no `ping` (Method not found) — probe with real reads there.
    const modern = session.era === 'modern'
    const fallback = modern ? 'server/discover' : 'ping'
    let next = 0
    let stop = false
    const worker = async (): Promise<void> => {
      while (!stop && next < RATE_PROBE_REQUESTS && !ctx.http.signal.aborted) {
        const i = next++
        const method = withTools && (modern || i % 2 === 1) ? 'tools/list' : fallback
        probe.methods.add(method)
        const out = await session.request(method)
        probe.sent++
        const names = rateLimitHeaders(out.http.exchange.response?.headers)
        for (const n of names) probe.headers.add(n)
        if (out.http.status === 429 || names.length > 0) {
          probe.first ??= out.http
        }
        if (out.http.status === 429) {
          probe.limited++
          stop = true // rate limiting proven — stop loading the server
        }
      }
    }
    await Promise.all(Array.from({ length: RATE_PROBE_WORKERS }, worker))
    // Headers seen anywhere during the scan count too.
    for (const ex of ctx.http.exchanges) {
      for (const n of rateLimitHeaders(ex.response?.headers)) probe.headers.add(n)
    }
    return probe
  })
}

const rateLimited: CheckDef = {
  id: 'ratelimit.rate_limited',
  category: 'ratelimit',
  title: 'Rate limiting',
  refs: [REFS.rfc6585, REFS.rateLimitHeaders, REFS.mcpSecurity],
  run: async (ctx) => {
    const p = await runRateProbe(ctx)
    if (p.sent === 0) return skipped(noSessionReason(ctx))
    if (p.limited > 0 || p.headers.size > 0) {
      return pass(
        `Rate limiting observed: ${p.limited} × HTTP 429${p.headers.size ? `; headers ${[...p.headers].join(', ')}` : ''}.`,
        ev(p.first),
      )
    }
    return problem(
      'warn',
      'low',
      `No rate limiting observed: ${p.sent} rapid requests all succeeded without HTTP 429, Retry-After or RateLimit headers.`,
      'Rate-limit MCP endpoints per client / token and answer HTTP 429 with Retry-After or RateLimit headers — tool calls can be expensive or have side effects.',
    )
  },
}

const rateRequests: CheckDef = {
  id: 'ratelimit.requests_sent',
  category: 'ratelimit',
  title: 'Rate-limit probe volume',
  run: async (ctx) => {
    const p = await runRateProbe(ctx)
    if (p.sent === 0) return skipped(noSessionReason(ctx))
    return info(
      `The probe sent ${p.sent} request(s) (${[...p.methods].join(' / ')}) over the authenticated session, at most ${RATE_PROBE_WORKERS} at a time; ${p.limited} answered HTTP 429.`,
    )
  },
}

const rateNotRun: CheckDef = {
  id: 'ratelimit.probe',
  category: 'ratelimit',
  title: 'Rate-limit probe',
  run: () =>
    skipped(
      'Not run — the rate-limit probe is opt-in because it sends ~30 rapid requests. Enable it only for servers you are authorized to test.',
    ),
}

export const INJECTION_CHECKS: CheckDef[] = [
  instructionOverride,
  hiddenUnicode,
  urlsInDescriptions,
  oversized,
  toolShadowing,
  secretLikeFields,
]

export const DISCLOSURE_CHECKS: CheckDef[] = [errorVerbosity, serverHeader, serverInfoVerbosity]

export function rateLimitChecks(enabled: boolean): CheckDef[] {
  return enabled ? [rateLimited, rateRequests] : [rateNotRun]
}
