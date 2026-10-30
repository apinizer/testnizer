// src/renderer/lib/test-runner.ts
// Testnizer — Test Runner (renderer process library)

import type { TestAssertion, TestResult, ApiResponse, ConsoleLog } from '../types'
import { buildScriptBindings } from '../../shared/script'
import { createPm, isSkipRequestSignal, type PmRuntime } from '../../shared/script/pm'
import type { PmRequestBodyInput } from '../../shared/script/pm-request'
import type { PmSendRawResponse, PmSendTransport } from '../../shared/script/send-request'
import type { NormalizedResponse, PmLike, ScriptTestResult } from '../../shared/script'
import type { McpScriptInfo } from '../../shared/mcp-response'

// ─── JSONPath Evaluator ──────────────────────────────────────────

function evaluateJsonPath(obj: unknown, path: string): unknown {
  if (!path.startsWith('$')) return undefined

  const stripped = path.slice(1) // remove leading $
  if (stripped === '' || stripped === '.') return obj

  // Handle .length on root
  if (stripped === '.length') {
    if (Array.isArray(obj)) return obj.length
    if (typeof obj === 'string') return obj.length
    return undefined
  }

  const tokens = tokenizeJsonPath(stripped)
  return resolveTokens(obj, tokens)
}

function tokenizeJsonPath(path: string): string[] {
  const tokens: string[] = []
  let i = 0
  while (i < path.length) {
    if (path[i] === '.') {
      i++
      let token = ''
      while (i < path.length && path[i] !== '.' && path[i] !== '[') {
        token += path[i]
        i++
      }
      if (token) tokens.push(token)
    } else if (path[i] === '[') {
      i++
      let token = ''
      while (i < path.length && path[i] !== ']') {
        token += path[i]
        i++
      }
      i++ // skip ]
      tokens.push(`[${token}]`)
    } else {
      // bare token at start
      let token = ''
      while (i < path.length && path[i] !== '.' && path[i] !== '[') {
        token += path[i]
        i++
      }
      if (token) tokens.push(token)
    }
  }
  return tokens
}

function resolveTokens(obj: unknown, tokens: string[]): unknown {
  let current: unknown = obj

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]

    if (current === null || current === undefined) return undefined

    // Handle .length pseudo-property
    if (token === 'length') {
      if (Array.isArray(current)) return current.length
      if (typeof current === 'string') return current.length
      if (typeof current === 'object' && current !== null) {
        const record = current as Record<string, unknown>
        if ('length' in record) return record['length']
      }
      return undefined
    }

    // Array index: [0], [1], etc.
    if (token.startsWith('[') && token.endsWith(']')) {
      const inner = token.slice(1, -1)
      if (inner === '*') {
        // Wildcard: apply remaining tokens to each element
        if (!Array.isArray(current)) return undefined
        const remaining = tokens.slice(i + 1)
        if (remaining.length === 0) return current
        return current.map((item) => resolveTokens(item, remaining))
      }
      const index = parseInt(inner, 10)
      if (!isNaN(index) && Array.isArray(current)) {
        current = current[index]
      } else {
        // Bracket notation for object key (e.g. ['key'])
        const key = inner.replace(/^['"]|['"]$/g, '')
        if (typeof current === 'object' && current !== null) {
          current = (current as Record<string, unknown>)[key]
        } else {
          return undefined
        }
      }
    } else {
      // Object property
      if (typeof current === 'object' && current !== null && !Array.isArray(current)) {
        current = (current as Record<string, unknown>)[token]
      } else {
        return undefined
      }
    }
  }
  return current
}

// ─── XPath Evaluator (browser DOMParser) ─────────────────────────

function evaluateXPath(xml: string, xpath: string): string | undefined {
  try {
    const parser = new DOMParser()
    const doc = parser.parseFromString(xml, 'application/xml')
    const parserError = doc.querySelector('parsererror')
    if (parserError) return undefined

    const result = doc.evaluate(xpath, doc, null, XPathResult.STRING_TYPE, null)
    return result.stringValue || undefined
  } catch {
    return undefined
  }
}

// ─── Assertion Runner ────────────────────────────────────────────

/**
 * `{{var}}` in an assertion row's expected value / header name / range, the
 * way the Runner reads them (`runAssertionsMainProcess` resolves the same
 * fields). Send used to compare the literal `{{greeting}}` — a Send≡Run gap
 * (Header assertion / effectiveValue class). Rows without a placeholder come
 * back untouched.
 */
export function resolveAssertionVars(
  assertions: TestAssertion[],
  resolve: (text: string) => string,
): TestAssertion[] {
  const str = (v: string | undefined): string | undefined =>
    typeof v === 'string' && v.includes('{{') ? resolve(v) : v
  const num = (v: number | undefined): number | undefined => {
    const raw = v as unknown
    if (typeof raw !== 'string' || !raw.includes('{{')) return v
    const n = Number(resolve(raw))
    return Number.isFinite(n) ? n : v
  }
  return assertions.map((a) => {
    const expected = typeof a.expected === 'string' ? str(a.expected) : a.expected
    return {
      ...a,
      expected,
      headerName: str(a.headerName),
      rangeMin: num(a.rangeMin),
      rangeMax: num(a.rangeMax),
    }
  })
}

export function runAssertions(assertions: TestAssertion[], response: ApiResponse): TestResult[] {
  return assertions
    .filter((a) => a.enabled)
    .map((assertion) => evaluateAssertion(assertion, response))
}

function evaluateAssertion(assertion: TestAssertion, response: ApiResponse): TestResult {
  try {
    switch (assertion.type) {
      case 'status_equals':
        return assertStatusEquals(assertion, response)
      case 'status_in_range':
        return assertStatusInRange(assertion, response)
      case 'body_contains':
        return assertBodyContains(assertion, response)
      case 'body_equals_json':
        return assertBodyEqualsJson(assertion, response)
      case 'body_jsonpath':
        return assertBodyJsonPath(assertion, response)
      case 'body_xpath':
        return assertBodyXPath(assertion, response)
      case 'header_exists':
        return assertHeaderExists(assertion, response)
      case 'header_equals':
        return assertHeaderEquals(assertion, response)
      case 'header_contains':
        return assertHeaderContains(assertion, response)
      case 'response_time_under':
        return assertResponseTimeUnder(assertion, response)
      case 'response_size_under':
        return assertResponseSizeUnder(assertion, response)
      default:
        return { assertion, passed: false, error: `Unknown assertion type: ${assertion.type}` }
    }
  } catch (e) {
    return { assertion, passed: false, error: (e as Error).message }
  }
}

function assertStatusEquals(assertion: TestAssertion, response: ApiResponse): TestResult {
  const expected = Number(assertion.expected)
  const actual = response.status ?? 0
  return { assertion, passed: actual === expected, actual }
}

function assertStatusInRange(assertion: TestAssertion, response: ApiResponse): TestResult {
  const actual = response.status ?? 0
  const min = assertion.rangeMin ?? 0
  const max = assertion.rangeMax ?? 999
  return { assertion, passed: actual >= min && actual <= max, actual }
}

function assertBodyContains(assertion: TestAssertion, response: ApiResponse): TestResult {
  const body = response.body ?? ''
  const expected = String(assertion.expected ?? '')
  const passed = body.includes(expected)
  return { assertion, passed, actual: passed ? 'contains' : 'not found' }
}

function assertBodyEqualsJson(assertion: TestAssertion, response: ApiResponse): TestResult {
  try {
    const actualObj = JSON.parse(response.body ?? '{}')
    const expectedObj = JSON.parse(String(assertion.expected ?? '{}'))
    const passed = JSON.stringify(actualObj) === JSON.stringify(expectedObj)
    return { assertion, passed, actual: response.body ?? '' }
  } catch (e) {
    return { assertion, passed: false, error: `JSON parse error: ${(e as Error).message}` }
  }
}

function assertBodyJsonPath(assertion: TestAssertion, response: ApiResponse): TestResult {
  try {
    const obj = JSON.parse(response.body ?? '{}')
    const jpPath = assertion.jsonPath ?? '$'
    const actual = evaluateJsonPath(obj, jpPath)
    const actualStr = typeof actual === 'object' ? JSON.stringify(actual) : String(actual ?? '')
    const expected = String(assertion.expected ?? '')

    if (expected === '') {
      // Just check existence
      return { assertion, passed: actual !== undefined, actual: actualStr }
    }
    return { assertion, passed: actualStr === expected, actual: actualStr }
  } catch (e) {
    return { assertion, passed: false, error: `JSONPath error: ${(e as Error).message}` }
  }
}

function assertBodyXPath(assertion: TestAssertion, response: ApiResponse): TestResult {
  const body = response.body ?? ''
  const xp = assertion.xPath ?? ''
  const actual = evaluateXPath(body, xp)
  const expected = String(assertion.expected ?? '')

  if (expected === '') {
    return { assertion, passed: actual !== undefined, actual: actual ?? '' }
  }
  return { assertion, passed: actual === expected, actual: actual ?? '' }
}

/**
 * Normalise the response headers bag to a flat Record<string,string>. Axios
 * usually hands them back as an object, but raw Node http responses surface
 * them as alternating [k, v] arrays, and certain protocol engines (SSE,
 * gRPC) push them through as `[['Content-Type', 'application/json'], ...]`.
 * Without flattening, `Object.entries()` returns the indices and every
 * header_equals / header_contains assertion fails even when the header is
 * literally present (v1.4.4 §5).
 */
function normaliseHeaders(input: unknown): Record<string, string> {
  if (!input) return {}
  if (Array.isArray(input)) {
    const out: Record<string, string> = {}
    for (const pair of input) {
      if (Array.isArray(pair) && pair.length >= 2 && typeof pair[0] === 'string') {
        out[pair[0]] = String(pair[1] ?? '')
      }
    }
    return out
  }
  const obj = input as Record<string, unknown>
  const out: Record<string, string> = {}
  for (const k of Object.keys(obj)) {
    out[k] = String(obj[k] ?? '')
  }
  return out
}

function assertHeaderExists(assertion: TestAssertion, response: ApiResponse): TestResult {
  const headerName = (assertion.headerName ?? '').trim().toLowerCase()
  const headers = normaliseHeaders(response.headers)
  const found = Object.keys(headers).some((k) => k.toLowerCase() === headerName)
  return { assertion, passed: found, actual: found ? 'exists' : 'not found' }
}

function assertHeaderEquals(assertion: TestAssertion, response: ApiResponse): TestResult {
  const headerName = (assertion.headerName ?? '').trim().toLowerCase()
  const headers = normaliseHeaders(response.headers)
  const entry = Object.entries(headers).find(([k]) => k.toLowerCase() === headerName)
  // Trim both sides so a trailing newline on the form field or an axios
  // header value with surrounding whitespace doesn't break the match.
  const actual = entry ? entry[1].trim() : ''
  const expected = String(assertion.expected ?? '').trim()
  return { assertion, passed: actual === expected, actual }
}

function assertHeaderContains(assertion: TestAssertion, response: ApiResponse): TestResult {
  const headerName = (assertion.headerName ?? '').trim().toLowerCase()
  const headers = normaliseHeaders(response.headers)
  const entry = Object.entries(headers).find(([k]) => k.toLowerCase() === headerName)
  // Trim both sides so `header_contains` is consistent with `header_equals`
  // — a stray leading/trailing space on either input shouldn't change the
  // verdict, otherwise users hit "equals passes but contains fails" with
  // the same response (v1.4.4 §6).
  const actual = entry ? entry[1].trim() : ''
  const expected = String(assertion.expected ?? '').trim()
  return { assertion, passed: actual.includes(expected), actual }
}

function assertResponseTimeUnder(assertion: TestAssertion, response: ApiResponse): TestResult {
  const actual = response.timing.total
  const expected = Number(assertion.expected ?? 0)
  return { assertion, passed: actual < expected, actual }
}

function assertResponseSizeUnder(assertion: TestAssertion, response: ApiResponse): TestResult {
  const actual = response.bodySize ?? 0
  const expected = Number(assertion.expected ?? 0)
  return { assertion, passed: actual < expected, actual }
}

// ─── pm API ──────────────────────────────────────────────────────

/**
 * Re-exported so every existing import of `HeaderEntry` / `HeaderCollection`
 * from this module keeps working; the implementation moved to the shared script
 * runtime so the Run path can use the same one (Send/Run parity). The header
 * collection is case-insensitive (RFC 7230) — Mehmet BUG-03.
 */
import { HeaderCollection, type HeaderEntry } from '../../shared/script/headers'
export { HeaderCollection, type HeaderEntry }
export {
  buildPmSendResponse,
  normalizePmSendInput,
  type PmSendInput,
  type PmSendResponse,
} from '../../shared/script/send-request'

export interface PmRequestInput {
  method: string
  url: string
  headers: HeaderEntry[] | Record<string, string>
}

/**
 * The Send path's `pm`: the SHARED object from `createPm`
 * (src/shared/script/pm.ts) plus the bookkeeping `runScript` reads back.
 * Nothing a script can observe is defined here any more (issue #281).
 */
export type PmApi = PmLike & {
  _testResults: ScriptTestResult[]
  _envUpdates: Map<string, string>
  _globalUpdates: Map<string, string>
  /** `pm.vault` writes: a value = secret project variable, null = delete (issue #281). */
  _vaultUpdates: Map<string, string | null>
  /** `pm.variables.set` writes — request-local, never persisted (see ScriptRunResult.varUpdates). */
  _varUpdates: Map<string, string>
  /** Promises of async / done-style `pm.test()` callbacks (drained by runScript). */
  _pendingTests: Promise<void>[]
  /** In-flight `pm.sendRequest` promises (drained by runScript, before tests). */
  _pendingSends: Promise<unknown>[]
  /** The shared runtime: test recorder (sandbox timers) + flow state. */
  _runtime: PmRuntime
  /** Set by pm.execution.skipRequest() in a pre-request script — callers
   * (request.store) should abort the actual HTTP send when true. */
  readonly _skipRequest: boolean
  /** Mutated by pm.request.headers.{add,upsert,remove} so callers can fold
   * the changes back into the outgoing request before it ships. */
  _requestHeaders: HeaderCollection
  /** Response normalized for the shared script runtime (null in pre-request). */
  _normalized: NormalizedResponse | null
  /** Console lines (script `console.*` + runtime notices), in order. */
  _logs: ConsoleLog[]
}

/** `window.api.request.send` — the Send path's pm.sendRequest transport. */
function ipcSendTransport(projectId: string | undefined): PmSendTransport {
  return async (opts) => {
    // Fire a real auxiliary HTTP request through the main-process engine (the
    // renderer can't reach the network directly — CSP).
    //
    // JAR SCOPE (issue #104): an engine-level `projectId` so a script login
    // lands in the same per-project cookie jar as the main request. Never
    // `_projectId`, which would also attach project client certificates (R5
    // keeps scripted sends cert-free on both paths).
    const api = (
      typeof window !== 'undefined' ? (window as unknown as { api?: unknown }).api : undefined
    ) as
      | {
          request?: {
            send?: (o: unknown) => Promise<{ success: boolean; data?: unknown; error?: string }>
          }
        }
      | undefined
    if (!api?.request?.send) {
      throw new Error('pm.sendRequest: request bridge unavailable in this context')
    }
    const result = await api.request.send({ ...opts, projectId })
    if (!result?.success || !result.data) {
      throw new Error(result?.error || 'pm.sendRequest failed')
    }
    return result.data as PmSendRawResponse
  }
}

export function createPmApi(
  response: ApiResponse,
  envVars: Map<string, string>,
  globalVars: Map<string, string>,
  meta?: {
    requestName?: string
    requestId?: string
    eventName?: 'prerequest' | 'test'
    /** Caller-typed request (method/url/headers) used to populate
     * pm.request when no real response.actualRequest is available yet
     * — pre-request scope. Mehmet BUG-01. */
    request?: PmRequestInput
    /** The request body as defined in the editor — `pm.request.body`. */
    body?: PmRequestBodyInput | null
    /** Folder names (outermost first) + request name — `pm.execution.location`. */
    location?: string[]
    /** `pm.variables.set` values from an earlier script of this send's
     *  cascade (project → folder → request) — a separate scope, not env. */
    localVars?: Record<string, string>
    /** Keys of the project variables marked secret — what `pm.vault` sees. */
    vaultKeys?: Iterable<string>
    /** False when no environment is selected (Insomnia's active environment is
     *  then the base one — the project variables; aliases.ts). Default true. */
    environmentActive?: boolean
    /** Scopes pm.sendRequest to the active project's cookie jar so a script
     * login shares its session cookie with the main request (issue #104).
     * Engine-level `projectId` only — never `_projectId`, which would also
     * attach project client certificates (R5 keeps scripted sends cert-free). */
    projectId?: string
  },
): PmApi {
  const envUpdates = new Map<string, string>()
  const globalUpdates = new Map<string, string>()
  const vaultUpdates = new Map<string, string | null>()
  const localVars = new Map<string, string>(Object.entries(meta?.localVars ?? {}))
  const logs: ConsoleLog[] = []
  const eventName = meta?.eventName ?? 'test'
  const isPreRequest = eventName === 'prerequest'

  // Build the header collection from either the caller-provided pre-request
  // build OR the engine's actualRequest (post-response). Both routes feed into
  // the same case-insensitive HeaderCollection so script mutations propagate.
  const initialHeaders: HeaderEntry[] | Record<string, string> =
    meta?.request?.headers ?? response.actualRequest?.headers ?? {}
  const requestHeaders = new HeaderCollection(initialHeaders)

  const normalized: NormalizedResponse | null = isPreRequest
    ? null
    : {
        code: response.status ?? 0,
        statusText: response.statusText ?? '',
        headers: (response.headers as Record<string, string>) ?? {},
        body: response.body ?? '',
        cookies: response.cookies ?? [],
        responseTime: response.timing?.total ?? 0,
        responseSize: response.bodySize ?? 0,
      }

  const runtime = createPm({
    eventName,
    requestName: meta?.requestName ?? '',
    requestId: meta?.requestId,
    location: meta?.location,
    scopes: {
      globals: { values: globalVars, updates: globalUpdates },
      environment: { values: envVars, updates: envUpdates, active: meta?.environmentActive },
      vault: { secretKeys: new Set(meta?.vaultKeys ?? []), updates: vaultUpdates },
      // Request-local, like Postman: folded into THIS send's resolution by the
      // caller, never persisted.
      locals: { values: localVars },
    },
    request: {
      method: meta?.request?.method ?? response.actualRequest?.method ?? '',
      url: meta?.request?.url ?? response.actualRequest?.url ?? '',
      headers: requestHeaders,
      body: meta?.body ?? null,
    },
    response: normalized,
    send: ipcSendTransport(meta?.projectId),
    log: (level, message) => logs.push({ level, message, timestamp: Date.now() }),
  })

  const api = Object.assign(runtime.pm, {
    _testResults: runtime.results,
    _envUpdates: envUpdates,
    _globalUpdates: globalUpdates,
    _vaultUpdates: vaultUpdates,
    _varUpdates: localVars,
    _pendingTests: runtime.pendingTests,
    _pendingSends: runtime.pendingSends,
    _runtime: runtime,
    _requestHeaders: requestHeaders,
    _normalized: normalized,
    _logs: logs,
  })
  // A live getter (Object.assign would copy the value once).
  Object.defineProperty(api, '_skipRequest', {
    enumerable: true,
    get: () => runtime.state.skipRequested,
  })
  return api as PmApi
}

// ─── Script Runner ───────────────────────────────────────────────

export interface ScriptRunResult {
  results: TestResult[]
  consoleLogs: ConsoleLog[]
  envUpdates: Record<string, string>
  globalUpdates: Record<string, string>
  /**
   * `pm.vault` writes (issue #281), applied by the host AFTER `globalUpdates`:
   * a value creates / updates the project variable as secret, null deletes it.
   * The value is also in `globalUpdates`, so `{{name}}` resolves it at once.
   */
  vaultUpdates: Record<string, string | null>
  /**
   * `pm.variables.set` writes. Request-local like Postman: the Send path folds
   * them into THIS send's `{{var}}` resolution (URL, params, headers, body) but
   * never persists them. Before this channel existed a pre-request
   * `pm.variables.set('employee_body', …)` resolved on Run (the Runner has its
   * own `varUpdates`) but shipped as the literal `{{employee_body}}` on Send.
   */
  varUpdates: Record<string, string>
  /** Set by pm.execution.skipRequest() — callers should abort the actual HTTP
   * send when this is true (pre-request only). */
  skipRequest: boolean
  /** Headers AFTER any pm.request.headers.{add,upsert,remove} mutations so
   * callers can fold the mutations back into the outgoing request. */
  requestHeaders: HeaderEntry[]
  /**
   * The message of an uncaught throw inside the script body, if any.
   *
   * The throw is caught here so one bad script cannot take down the send, but
   * the caller still has to KNOW: a pre-request script that dies before it
   * mints a token or signs a payload must abort the request rather than let it
   * go out with an unsatisfied precondition. Until this field existed the
   * error was written to the console and dropped, so the request went anyway
   * and the response was scored as if nothing had happened — the same gap the
   * Runner had (both paths fixed together, per the Send≡Run parity rule).
   *
   * `pm.execution.skipRequest()` is NOT reported here: it signals through
   * `skipRequest` and is a deliberate control-flow exit, not a failure.
   */
  scriptError?: string
}

/** Extra host context of a run — today only `pm.mcp` for an MCP call's post-response script. */
export interface ScriptRunHost {
  /** `mcpScriptInfo(outcome)` (src/shared/mcp-response.ts) — becomes `pm.mcp`. */
  mcp?: McpScriptInfo
}

export async function runScript(
  script: string,
  pmApi: PmApi,
  host?: ScriptRunHost,
): Promise<ScriptRunResult> {
  // One ordered stream: script console output and runtime notices (visualizer,
  // late async errors) land in the same array.
  const consoleLogs = pmApi._logs
  let scriptError: string | undefined

  const push =
    (level: ConsoleLog['level']) =>
    (...args: unknown[]): void => {
      consoleLogs.push({ level, message: args.map(String).join(' '), timestamp: Date.now() })
    }
  const captureConsole = { log: push('log'), warn: push('warn'), error: push('error') }

  // Assemble the COMPLETE script global set from the shared runtime —
  // pm/t/insomnia/bru/req/res, require() + the library set, the legacy
  // postman.*/responseBody/tests/xml2Json interface, bare expect/test, the
  // sandbox timers — IDENTICAL to the Run path (one shared source ⇒ no drift).
  const normalized = pmApi._normalized
  const { bindings, legacyTests } = buildScriptBindings({
    pm: pmApi,
    normalizedResponse: normalized,
    timers: pmApi._runtime.recorder.timers,
    ...(host?.mcp ? { mcp: host.mcp } : {}),
  })
  const allBindings: Record<string, unknown> = { ...bindings, console: captureConsole }
  const names = Object.keys(allBindings)
  const values = names.map((n) => allBindings[n])

  try {
    // Run as an ASYNC function so scripts can `await pm.sendRequest(...)` and use
    // top-level await. A plain sync body still works unchanged.
    //
    // The script body is wrapped in a `{ }` block so the injected globals
    // (`pm`, `_`, `CryptoJS`, `atob`, `btoa`, …) — passed as function params —
    // can be SHADOWED by user `const`/`let` redeclarations. Without the block,
    // a common Postman/Insomnia line like `const _ = require('lodash')` collides
    // with the `_` param ("Identifier '_' has already been declared") and the
    // whole script dies at parse time before any pm.* runs.
    const AsyncFunction = Object.getPrototypeOf(async function () {})
      .constructor as FunctionConstructor
    const fn = new AsyncFunction(...names, `{\n${script}\n}`)
    await fn(...values)
  } catch (e) {
    // pm.execution.skipRequest() stops the script on purpose — not an error.
    if (!isSkipRequestSignal(e)) {
      const msg = (e as Error).message
      consoleLogs.push({ level: 'error', message: `Script error: ${msg}`, timestamp: Date.now() })
      scriptError = msg
    }
  }

  // Wait for in-flight `pm.sendRequest(...)` calls and async / done-style
  // `pm.test` callbacks — looping, since each can start the other — so every
  // assertion lands in `_testResults` before we map them. Shared with Run.
  await pmApi._runtime.drain()

  // Drain the legacy `tests` object (tests['name'] = bool) into results.
  for (const [name, passed] of Object.entries(legacyTests)) {
    pmApi._testResults.push({ name, passed })
  }

  // Convert pm test results to TestResult format
  const results: TestResult[] = pmApi._testResults.map((tr) => ({
    assertion: {
      id: `script-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name: tr.name,
      type: 'pm_script' as const,
      enabled: true,
    },
    passed: tr.passed,
    error: tr.error,
    ...(tr.skipped ? { skipped: true } : {}),
  }))

  return {
    results,
    consoleLogs,
    envUpdates: Object.fromEntries(pmApi._envUpdates),
    globalUpdates: Object.fromEntries(pmApi._globalUpdates),
    vaultUpdates: Object.fromEntries(pmApi._vaultUpdates),
    varUpdates: Object.fromEntries(pmApi._varUpdates),
    skipRequest: pmApi._skipRequest,
    requestHeaders: pmApi._requestHeaders.toArray(),
    scriptError,
  }
}

// ─── Variable Extraction ─────────────────────────────────────────

export interface ExtractionConfig {
  type: 'jsonpath' | 'xpath' | 'regex' | 'header' | 'body'
  expression?: string
  headerName?: string
  regexPattern?: string
  regexGroup?: number
}

export function extractVariable(
  response: ApiResponse,
  extraction: ExtractionConfig,
): string | undefined {
  switch (extraction.type) {
    case 'jsonpath': {
      try {
        const obj = JSON.parse(response.body ?? '{}')
        const result = evaluateJsonPath(obj, extraction.expression ?? '$')
        if (result === undefined) return undefined
        return typeof result === 'object' ? JSON.stringify(result) : String(result)
      } catch {
        return undefined
      }
    }

    case 'xpath': {
      return evaluateXPath(response.body ?? '', extraction.expression ?? '')
    }

    case 'regex': {
      try {
        const pattern = extraction.regexPattern ?? ''
        const regex = new RegExp(pattern)
        const match = regex.exec(response.body ?? '')
        if (!match) return undefined
        const group = extraction.regexGroup ?? 0
        return match[group] ?? match[0]
      } catch {
        return undefined
      }
    }

    case 'header': {
      const headerName = (extraction.headerName ?? '').toLowerCase()
      const headers = response.headers ?? {}
      const entry = Object.entries(headers).find(([k]) => k.toLowerCase() === headerName)
      return entry ? entry[1] : undefined
    }

    case 'body': {
      return response.body ?? undefined
    }

    default:
      return undefined
  }
}
