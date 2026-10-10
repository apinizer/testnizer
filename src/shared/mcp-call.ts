/**
 * ONE implementation of "saved MCP request → what goes on the wire", used by
 * BOTH paths: the renderer's Send (`mcp.store.ts`, `mcp-args-form.ts`,
 * `mcp-auth.slice.ts`, `mcp-call.slice.ts`) and main's Run
 * (`runner.handler.ts` `runMcpStep`, the engine's `mcpCallOnce`), plus the
 * History snapshot both write (`mcp.handler.ts`, `runMcpStep`). Before this
 * module each path had its own copy and they drifted — Run sent a `{{n}}`
 * typed into a number field as the string "5" while Send sent 5 (P-T parity
 * class, same as `src/shared/script/` for the pm API).
 *
 * The variable resolver stays per path (renderer `resolveVariables` over the
 * environment store, main `resolveVariables` over the run's live map), so
 * every function that resolves takes a `resolve` callback.
 *
 * Pure TS: no node / electron / DOM imports — compiled into both bundles.
 */
import { HISTORY_MASK, isCredentialArgName, isCredentialHeaderName } from './credential-headers'

export type Resolve = (text: string) => string

type Json = Record<string, unknown>

const isRecord = (v: unknown): v is Json => !!v && typeof v === 'object' && !Array.isArray(v)

// ─── Schema reading (tool `inputSchema`) ────────────────────────────────────

/** A decimal number as typed into a field — also the elicitation form's number rule. */
export const DECIMAL_RE = /^-?\d+(\.\d+)?$/

/** Deepest schema / value nesting any walker follows. */
export const MAX_SCHEMA_DEPTH = 24

/** Why a schema has no form — the JSON view's one-line note says it. */
export type ArgsFormUnsupported =
  | 'composition'
  | 'ref'
  | 'patternProperties'
  | 'arrayOfObjects'
  | 'untyped'
  | 'notObject'

/** `oneOf: [{ const, title }, …]` is a titled enum, not a composition. */
export const isConstOneOf = (v: unknown): boolean =>
  Array.isArray(v) && v.length > 0 && v.every((o) => isRecord(o) && 'const' in o)

export const isNullSchema = (v: unknown): boolean => isRecord(v) && v.type === 'null'

/**
 * Unwrap the nullable spellings generators emit (pydantic / zod):
 * `type: ['string', 'null']` and `anyOf|oneOf: [X, { type: 'null' }]` → X.
 * Real compositions, `$ref` and `patternProperties` are reported instead.
 */
export function unwrapSchema(raw: unknown): Json | ArgsFormUnsupported {
  let p: Json = isRecord(raw) ? raw : {}
  if (Array.isArray(p.type)) {
    const types = p.type.filter((t) => t !== 'null')
    if (types.length !== 1) return 'composition'
    p = { ...p, type: types[0] }
  }
  for (const key of ['anyOf', 'oneOf'] as const) {
    const list = p[key]
    if (!Array.isArray(list) || (key === 'oneOf' && isConstOneOf(list))) continue
    const rest = list.filter((s) => !isNullSchema(s))
    if (rest.length !== 1 || !isRecord(rest[0])) return 'composition'
    const { [key]: _dropped, ...outer } = p
    p = { ...rest[0], ...outer }
  }
  if (Array.isArray(p.allOf)) {
    if (p.allOf.length !== 1 || !isRecord(p.allOf[0])) return 'composition'
    const { allOf, ...outer } = p
    p = { ...(allOf as Json[])[0], ...outer }
  }
  if ('$ref' in p) return 'ref'
  if ('patternProperties' in p) return 'patternProperties'
  return p
}

export const hasTemplate = (v: unknown): boolean => typeof v === 'string' && v.includes('{{')

const INTEGER_RE = /^-?\d+$/

/**
 * Text typed into a number / integer field → the JSON number it means, or
 * undefined when it is not one (yet). A `number` takes any decimal, canonical
 * or not (`0.70`, `1.0`, `2.50`); an `integer` only whole numbers (`10`, not
 * `1.0`). The Form view's leaf rule (`mcp-args-form.ts` `leafValue`).
 */
export function numberFromText(text: string, type: 'number' | 'integer'): number | undefined {
  const t = text.trim()
  if (type === 'integer' ? !INTEGER_RE.test(t) : !DECIMAL_RE.test(t)) return undefined
  const n = Number(t)
  return Number.isFinite(n) ? n : undefined
}

// ─── Tool arguments ─────────────────────────────────────────────────────────

/**
 * `{{var}}` placeholders the user put in a number / integer / boolean field
 * resolved to text (`"5"`); turn that text into the type the schema asks for.
 * Only values whose RAW form held a placeholder are touched.
 */
export function coerceTemplated(
  raw: unknown,
  resolved: unknown,
  schema: unknown,
  depth = 0,
): unknown {
  if (depth > MAX_SCHEMA_DEPTH) return resolved
  const p = unwrapSchema(schema)
  if (typeof p === 'string') return resolved
  if (hasTemplate(raw) && typeof resolved === 'string') {
    const text = resolved.trim()
    // Lenient on purpose (both types take any decimal): a `{{n}}` = "2.0" in
    // an integer field has always gone out as 2 on Send and Run.
    if (p.type === 'number' || p.type === 'integer') {
      const n = numberFromText(text, 'number')
      if (n !== undefined) return n
    }
    if (p.type === 'boolean' && (text === 'true' || text === 'false')) return text === 'true'
    return resolved
  }
  if (Array.isArray(raw) && Array.isArray(resolved)) {
    return resolved.map((v, i) => coerceTemplated(raw[i], v, p.items, depth + 1))
  }
  if (isRecord(raw) && isRecord(resolved)) {
    const props = isRecord(p.properties) ? p.properties : {}
    const out: Json = {}
    for (const [k, v] of Object.entries(resolved)) {
      out[k] = k in props ? coerceTemplated(raw[k], v, props[k], depth + 1) : v
    }
    return out
  }
  return resolved
}

/**
 * The resolved arguments with the tool's schema applied: `rawArgs` (the
 * UNRESOLVED parse) says which values held a placeholder. Send has the schema
 * when it prepares the call; Run only once `mcpCallOnce` has listed the
 * server's tools — both call this.
 */
export function applyToolSchema(
  args: Record<string, unknown>,
  rawArgs: unknown,
  schema: unknown,
): Record<string, unknown> {
  if (schema === undefined || rawArgs === undefined) return args
  return coerceTemplated(rawArgs, args, schema) as Record<string, unknown>
}

export type PreparedArgs =
  | { args: Record<string, unknown>; raw: unknown; rawArgs?: unknown; error?: undefined }
  | { error: 'json'; args?: undefined; raw?: undefined; rawArgs?: undefined }

/**
 * `toolArgs` text → the arguments a call sends: `{{var}}` resolved in the text
 * (so placeholders work anywhere), parsed, then schema-coerced when a schema
 * is given. `raw` is the unresolved parse (for validation), or the resolved
 * one when the raw text is not JSON on its own (an unquoted `{{n}}`).
 * `rawArgs` is the unresolved parse only — what `applyToolSchema` needs.
 */
export function prepareToolArgs(text: string, resolve: Resolve, schema?: unknown): PreparedArgs {
  let resolved: unknown
  try {
    resolved = JSON.parse(resolve(text))
  } catch {
    return { error: 'json' }
  }
  let rawArgs: unknown
  try {
    rawArgs = JSON.parse(text)
  } catch {
    rawArgs = undefined
  }
  const args = applyToolSchema(resolved as Record<string, unknown>, rawArgs, schema)
  return { args, raw: rawArgs ?? resolved, ...(rawArgs !== undefined ? { rawArgs } : {}) }
}

// ─── Resources and prompts ──────────────────────────────────────────────────

/** True while a URI still holds an RFC 6570 `{name}` placeholder. */
export function hasUnexpandedTemplate(uri: string): boolean {
  return /\{[^{}]*\}/.test(uri)
}

export type ResourceUriResult =
  | { uri: string; error?: undefined }
  | { error: 'empty' | 'emptyResolved' | 'template'; uri: string }

/** The URI draft, trimmed and `{{var}}`-resolved; an unfilled `{id}` template is an error. */
export function resolveResourceUri(draft: string, resolve: Resolve): ResourceUriResult {
  const trimmed = draft.trim()
  if (!trimmed) return { error: 'empty', uri: '' }
  const uri = resolve(trimmed)
  if (!uri) return { error: 'emptyResolved', uri }
  if (hasUnexpandedTemplate(uri)) return { error: 'template', uri }
  return { uri }
}

/** Prompt arguments: empty ones left out (optional), the rest `{{var}}`-resolved. */
export function resolvePromptArgs(
  promptArgs: Record<string, string>,
  resolve: Resolve,
): Record<string, string> {
  const args: Record<string, string> = {}
  for (const [k, v] of Object.entries(promptArgs)) {
    if (v !== '') args[k] = resolve(v)
  }
  return args
}

// ─── Saved call (`metadata.mcp.call`) ───────────────────────────────────────

export type McpCapabilityTab = 'tools' | 'resources' | 'prompts'

/** The call as saved with the request (`metadata.mcp.call`, issue #159). */
export interface McpSavedCall {
  capabilityTab?: McpCapabilityTab
  selectedTool?: string | null
  /** Raw JSON text — `{{var}}` kept. */
  toolArgs?: string
  selectedResourceUri?: string | null
  resourceUriDraft?: string
  selectedPrompt?: string | null
  promptArgs?: Record<string, string>
}

const CAPABILITY_TABS = new Set<McpCapabilityTab>(['tools', 'resources', 'prompts'])

/**
 * Tolerant read of `metadata.mcp.call` (or a History snapshot adapted to the
 * same shape): unknown / mistyped fields are dropped, never thrown on, so a
 * row saved before #159 — or by a newer build — opens with what it has.
 */
export function readSavedMcpCall(raw: unknown): McpSavedCall {
  if (!isRecord(raw)) return {}
  const out: McpSavedCall = {}
  if (
    typeof raw.capabilityTab === 'string' &&
    CAPABILITY_TABS.has(raw.capabilityTab as McpCapabilityTab)
  ) {
    out.capabilityTab = raw.capabilityTab as McpCapabilityTab
  }
  for (const key of ['selectedTool', 'selectedResourceUri', 'selectedPrompt'] as const) {
    if (typeof raw[key] === 'string' || raw[key] === null) out[key] = raw[key] as string | null
  }
  if (typeof raw.toolArgs === 'string') out.toolArgs = raw.toolArgs
  if (typeof raw.resourceUriDraft === 'string') out.resourceUriDraft = raw.resourceUriDraft
  if (isRecord(raw.promptArgs)) {
    const args: Record<string, string> = {}
    for (const [k, v] of Object.entries(raw.promptArgs)) {
      if (typeof v === 'string') args[k] = v
    }
    out.promptArgs = args
  }
  return out
}

/**
 * One capability call, `{{var}}`-resolved. A tool call carries `rawArgs`
 * (the unresolved parse) so a caller that gets the schema later (Run) can
 * still apply it with `applyToolSchema`.
 */
export type McpCallParams =
  | { capability: 'tool'; name: string; args: Record<string, unknown>; rawArgs?: unknown }
  | { capability: 'resource'; uri: string }
  | { capability: 'prompt'; name: string; args: Record<string, string> }

/**
 * Why a saved call cannot be made. `configError` = the saved DEFINITION is
 * incomplete (nothing selected) — like HTTP's "No URL"; anything that only
 * breaks once variables resolve is a plain failure.
 */
export type McpCallProblem =
  | 'noTool'
  | 'noPrompt'
  | 'noResource'
  | 'argsJson'
  | 'argsNotObject'
  | 'uriEmpty'
  | 'uriTemplate'

export type ResolvedMcpCall =
  | { call: McpCallParams; problem?: undefined }
  | { problem: McpCallProblem; configError: boolean; uri?: string; call?: undefined }

/**
 * The saved call → the call a run makes. Defaults match the tab's: the
 * Tools tab, `{}` args, an empty URI draft, no prompt args. `toolSchema`
 * applies schema coercion right away (Send has it); without it the tool
 * call keeps `rawArgs` for `applyToolSchema`.
 */
export function resolveSavedMcpCall(
  saved: McpSavedCall,
  resolve: Resolve,
  toolSchema?: unknown,
): ResolvedMcpCall {
  const tab = saved.capabilityTab ?? 'tools'
  if (tab === 'resources') {
    const r = resolveResourceUri(saved.resourceUriDraft ?? '', resolve)
    if (r.error === 'empty') return { problem: 'noResource', configError: true }
    if (r.error === 'emptyResolved') return { problem: 'uriEmpty', configError: false }
    if (r.error === 'template') return { problem: 'uriTemplate', configError: false, uri: r.uri }
    return { call: { capability: 'resource', uri: r.uri } }
  }
  if (tab === 'prompts') {
    if (!saved.selectedPrompt) return { problem: 'noPrompt', configError: true }
    return {
      call: {
        capability: 'prompt',
        name: saved.selectedPrompt,
        args: resolvePromptArgs(saved.promptArgs ?? {}, resolve),
      },
    }
  }
  if (!saved.selectedTool) return { problem: 'noTool', configError: true }
  const prepared = prepareToolArgs(saved.toolArgs ?? '{}', resolve, toolSchema)
  if (prepared.error) return { problem: 'argsJson', configError: false }
  if (!isRecord(prepared.args)) return { problem: 'argsNotObject', configError: false }
  return {
    call: {
      capability: 'tool',
      name: saved.selectedTool,
      args: prepared.args,
      ...(toolSchema === undefined && prepared.rawArgs !== undefined
        ? { rawArgs: prepared.rawArgs }
        : {}),
    },
  }
}

/** The JSON-RPC method + params of a call (`mask` masks credential-named args for display). */
export function mcpJsonRpc(
  call: McpCallParams,
  mask?: string,
): { method: string; params: Record<string, unknown> } {
  const args = (a: Record<string, unknown>): unknown => (mask ? maskMcpArgs(a, mask) : a)
  if (call.capability === 'resource') return { method: 'resources/read', params: { uri: call.uri } }
  return {
    method: call.capability === 'tool' ? 'tools/call' : 'prompts/get',
    params: { name: call.name, arguments: args(call.args) },
  }
}

// ─── Connection (`metadata.mcp` → connect options) ──────────────────────────

export type McpTransportKind = 'http' | 'sse' | 'stdio'

/** A key/value table row (custom headers, stdio env). */
export interface McpKvRow {
  key: string
  value?: string
  enabled?: boolean
}

/** Enabled rows with a non-blank key → `{ key: value }`, `{{var}}` resolved in key and value. */
export function resolveKvRows(rows: readonly McpKvRow[], resolve: Resolve): Record<string, string> {
  const out: Record<string, string> = {}
  for (const row of rows) {
    if (!row.enabled || !row.key.trim()) continue
    const key = resolve(row.key).trim()
    if (key) out[key] = resolve(row.value ?? '')
  }
  return out
}

export interface CommandLine {
  command: string
  args: string[]
}

/**
 * stdio command line ⇄ `{ command, args }` (issue #139). Quoting is minimal
 * and Windows-friendly: single or double quotes group a token, and a
 * backslash is NEVER an escape character (`C:\Users\me\server.js` survives).
 */
export function tokenizeCommandLine(input: string): string[] {
  const tokens: string[] = []
  let current = ''
  let inToken = false
  let quote: '"' | "'" | null = null
  for (const ch of input) {
    if (quote) {
      if (ch === quote) quote = null
      else current += ch
      continue
    }
    if (ch === '"' || ch === "'") {
      quote = ch
      inToken = true
      continue
    }
    if (/\s/.test(ch)) {
      if (inToken) tokens.push(current)
      current = ''
      inToken = false
      continue
    }
    current += ch
    inToken = true
  }
  if (inToken) tokens.push(current)
  return tokens
}

export function parseCommandLine(input: string): CommandLine {
  const [command = '', ...args] = tokenizeCommandLine(input.trim())
  return { command, args }
}

function quoteToken(token: string): string {
  if (token === '') return '""'
  if (!/[\s"']/.test(token)) return token
  if (!token.includes('"')) return `"${token}"`
  if (!token.includes("'")) return `'${token}'`
  // Both quote kinds: `"…"` runs joined by `'"'` — the tokenizer glues
  // adjacent quoted segments into one token, so this still round-trips.
  return token
    .split('"')
    .map((part) => (part ? `"${part}"` : ''))
    .join(`'"'`)
}

/** Args that contain a space are quoted, so `{ args: ['/My Docs'] }` round-trips. */
export function joinCommandLine(command: string, args: readonly string[] = []): string {
  return [command, ...args].map(quoteToken).join(' ')
}

/** The Authorization tab as connect sends it (`{{var}}` resolved). */
export interface McpResolvedAuth {
  type: 'basic' | 'bearer' | 'api-key'
  basic?: { username: string; password: string }
  bearer?: { token: string; prefix?: string }
  apiKey?: { key: string; value: string; in: 'header' | 'query' }
}

/**
 * The Authorization tab → the `auth` connect sends: `{{var}}` resolved in
 * every field, and nothing for a type that adds no credential (`none`;
 * `oauth2`, whose token main injects from the session) or for an empty
 * config — so an untouched tab sends exactly what it sent before it existed.
 */
export function resolveMcpAuth(auth: unknown, resolve: Resolve): McpResolvedAuth | undefined {
  if (!isRecord(auth)) return undefined
  const sub = (k: string): Json => (isRecord(auth[k]) ? (auth[k] as Json) : {})
  const r = (v: unknown): string => resolve(typeof v === 'string' ? v : '')
  switch (auth.type) {
    case 'basic': {
      const username = r(sub('basic').username)
      const password = r(sub('basic').password)
      if (!username && !password) return undefined
      return { type: 'basic', basic: { username, password } }
    }
    case 'bearer': {
      const token = r(sub('bearer').token).trim()
      if (!token) return undefined
      const prefix = r(sub('bearer').prefix).trim()
      return { type: 'bearer', bearer: prefix ? { token, prefix } : { token } }
    }
    case 'api-key': {
      const key = r(sub('apiKey').key).trim()
      if (!key) return undefined
      return {
        type: 'api-key',
        apiKey: {
          key,
          value: r(sub('apiKey').value),
          in: sub('apiKey').in === 'query' ? 'query' : 'header',
        },
      }
    }
    default:
      return undefined
  }
}

const PROTOCOL_DATE = /^\d{4}-\d{2}-\d{2}$/

/** The `protocol` option: `auto` / `legacy` / a `YYYY-MM-DD` revision — anything else is `auto`. */
export function normalizeMcpProtocolOption(value: unknown): string {
  if (typeof value !== 'string') return 'auto'
  const v = value.trim()
  if (v === 'auto' || v === 'legacy') return v
  return PROTOCOL_DATE.test(v) ? v : 'auto'
}

/** The connection half of a saved MCP request (`metadata.mcp`). */
export interface McpSavedConnection {
  transport: McpTransportKind
  url: string
  customHeaders: readonly McpKvRow[]
  envVars: readonly McpKvRow[]
  auth: unknown
  protocol: unknown
}

/** What `mcp:connect` / `mcpCallOnce` get — minus the per-path ids (pending / OAuth session). */
export interface McpConnectParams {
  transport: McpTransportKind
  url: string
  protocol: string
  command?: string
  args?: string[]
  env?: Record<string, string>
  headers?: Record<string, string>
  auth?: McpResolvedAuth
}

/**
 * Saved connection → connect options, `{{var}}` resolved. stdio splits the
 * command line quote-aware (the engine only splits `command` on whitespace,
 * `args` pass through untouched) and sends env, never headers / auth;
 * http / sse send headers + the Authorization tab, never env.
 */
export function buildMcpConnect(saved: McpSavedConnection, resolve: Resolve): McpConnectParams {
  const url = resolve(saved.url).trim()
  const out: McpConnectParams = {
    transport: saved.transport,
    url,
    protocol: normalizeMcpProtocolOption(saved.protocol),
  }
  if (saved.transport === 'stdio') {
    const { command, args } = parseCommandLine(url)
    if (command) {
      out.command = command
      out.args = args
    }
    const env = resolveKvRows(saved.envVars, resolve)
    if (Object.keys(env).length > 0) out.env = env
    return out
  }
  const headers = resolveKvRows(saved.customHeaders, resolve)
  if (Object.keys(headers).length > 0) out.headers = headers
  const auth = resolveMcpAuth(saved.auth, resolve)
  if (auth) out.auth = auth
  return out
}

// ─── Display / History masking ──────────────────────────────────────────────

/** Replaces a credential value inside a URL / command line (URL-safe). */
export const INLINE_MASK = '***'

/** The History mask (`saved-response.repo.ts` `MASKED_VALUE`) — re-exported for the renderer. */
export { HISTORY_MASK }

/**
 * Tool / prompt arguments with credential-named values masked (recursively).
 * The ARGUMENT rule (`isCredentialArgName`, whole words) — not the broad
 * header rule, which masked `author` / `keyword` and made History restore
 * re-send the mask. Strings only: a number / boolean is not a typed-in
 * credential — masking it would make a restored call fail its input schema.
 */
export function maskMcpArgs(value: unknown, mask: string, depth = 0): unknown {
  if (depth > 32) return value
  if (Array.isArray(value)) return value.map((v) => maskMcpArgs(v, mask, depth + 1))
  if (!isRecord(value)) return value
  const out: Json = {}
  for (const [k, v] of Object.entries(value)) {
    const secret = isCredentialArgName(k) && typeof v === 'string' && v !== ''
    out[k] = secret ? mask : maskMcpArgs(v, mask, depth + 1)
  }
  return out
}

/** Server URL as shown / stored: no `user:pass@`, credential-named query values masked. */
export function mcpSafeUrl(raw: string): string {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return raw
  }
  let changed = false
  if (url.username || url.password) {
    url.username = ''
    url.password = ''
    changed = true
  }
  for (const key of new Set(url.searchParams.keys())) {
    if (isCredentialHeaderName(key)) {
      url.searchParams.set(key, INLINE_MASK)
      changed = true
    }
  }
  return changed ? url.toString() : raw
}

/** A flag that names a credential (`--api-key`, `--token`, `-password`). */
function isCredentialFlag(flag: string): boolean {
  return /^--?[A-Za-z]/.test(flag) && isCredentialHeaderName(flag.replace(/^-+/, ''))
}

/**
 * stdio command line as shown / stored: the value after a credential flag
 * (`--api-key X`, `--token=X`) and credential query values in URL arguments
 * are masked; a token holding a space / quote is quoted (`quoteToken`, so the
 * line round-trips through `tokenizeCommandLine`). Env vars are never part of it.
 */
export function mcpSafeCommandLine(parts: readonly string[]): string {
  const out: string[] = []
  let maskNext = false
  for (const part of parts) {
    if (maskNext) {
      out.push(INLINE_MASK)
      maskNext = false
      continue
    }
    const inline = /^(--?[^=\s]+)=(.*)$/.exec(part)
    if (inline && isCredentialFlag(inline[1])) {
      out.push(`${inline[1]}=${INLINE_MASK}`)
      continue
    }
    if (isCredentialFlag(part)) maskNext = true
    const safe = /^[a-z][a-z0-9+.-]*:\/\//i.test(part) ? mcpSafeUrl(part) : part
    // Quoted the way `tokenizeCommandLine` reads it back — never escaped:
    // a backslash is a path character there (`C:\Program Files\…`).
    out.push(quoteToken(safe))
  }
  return out.join(' ')
}

/** A run row's / History's target: the masked server URL, or the masked stdio command line. */
export function mcpDisplayTarget(transport: McpTransportKind | string, target: string): string {
  if (transport !== 'stdio') return mcpSafeUrl(target)
  return mcpSafeCommandLine(tokenizeCommandLine(target))
}

export type McpHistoryCapability = 'tool' | 'resource' | 'prompt'

/**
 * The restorable request of an MCP History row (issue #166), stored as
 * `request_snapshot = JSON.stringify({ mcp: … })` by Send (`mcp.handler.ts`)
 * and Run (`runMcpStep`). Values are what was sent, credential-like ones
 * masked; headers, auth, OAuth and stdio env are never stored.
 */
export interface McpHistoryRequest {
  transport: McpTransportKind | 'unknown'
  /** Server URL, or the stdio command line — already masked (`mcpDisplayTarget`). */
  url: string
  /** Requested protocol option: `auto` / `legacy` / a revision. */
  protocol: string
  capability: McpHistoryCapability
  /** Tool or prompt name (absent for a resource). */
  name?: string
  /** Tool or prompt arguments (absent for a resource). */
  args?: Record<string, unknown>
  /** Resource URI (resource only). */
  uri?: string
}

export function mcpHistoryRequest(
  conn: { transport: McpTransportKind | 'unknown'; url: string; protocol: string },
  target: {
    capability: McpHistoryCapability
    name?: string
    args?: Record<string, unknown>
    uri?: string
  },
  mask: string,
): McpHistoryRequest {
  return {
    transport: conn.transport,
    url: conn.url,
    protocol: conn.protocol,
    capability: target.capability,
    ...(target.name !== undefined ? { name: target.name } : {}),
    ...(target.args !== undefined
      ? { args: maskMcpArgs(target.args, mask) as Record<string, unknown> }
      : {}),
    ...(target.uri !== undefined ? { uri: target.uri } : {}),
  }
}

/** History `method` of a call kind (the console's verb too). */
export const MCP_HISTORY_METHOD: Record<McpHistoryCapability, string> = {
  tool: 'CALL_TOOL',
  resource: 'READ_RESOURCE',
  prompt: 'GET_PROMPT',
}
