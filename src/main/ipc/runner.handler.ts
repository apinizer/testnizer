// src/main/ipc/runner.handler.ts
// Testnizer — Collection Runner IPC Handler

import { ipcMain, BrowserWindow } from 'electron'
import {
  executeHttpRequest,
  HttpRequestOptions,
  stripUrlCredentials,
} from '../protocols/http.engine'
import * as endpointRepo from '../db/endpoint.repo'
import * as tsiRepo from '../db/test-suite-item.repo'
import * as historyRepo from '../db/history.repo'
import { getDb } from '../db/database'
import { isRunnableInProject } from '../lib/ownership'
import { resolveVariables } from '../lib/variable-resolver'
import { loadEnvVars } from '../lib/env-vars'

// ─── Types ───────────────────────────────────────────────────────

interface KeyValuePair {
  id: string
  key: string
  value: string
  description?: string
  enabled: boolean
}

interface RequestBody {
  type: string
  content?: string
  formData?: KeyValuePair[]
  urlEncoded?: KeyValuePair[]
  binaryPath?: string
}

interface AuthConfig {
  type: string
  basic?: { username: string; password: string }
  bearer?: { token: string; prefix?: string }
  apiKey?: { key: string; value: string; in: 'header' | 'query' }
  oauth2?: { token?: string }
  digest?: { username: string; password: string }
  ntlm?: { username: string; password: string; domain?: string; workstation?: string }
  hawk?: { authId: string; authKey: string; algorithm: 'sha1' | 'sha256' }
  awsSignature?: { accessKey: string; secretKey: string; region: string; service: string }
}

interface TestAssertion {
  id: string
  name: string
  type: string
  enabled: boolean
  expected?: string | number
  jsonPath?: string
  xPath?: string
  headerName?: string
  script?: string
  rangeMin?: number
  rangeMax?: number
}

interface RunnerExecuteOptions {
  projectId: string
  endpointIds: string[]
  environmentId?: string
  workspaceId?: string
  /** Delay in milliseconds inserted between requests. */
  delay?: number
  /**
   * Number of iterations. When `iterationData` is supplied, this is overridden
   * by `iterationData.length`. Defaults to 1.
   */
  iterations?: number
  /**
   * Per-iteration data rows (Postman / Insomnia compatible). When set, the
   * runner executes one iteration per row and exposes the row to scripts via
   * `pm.iterationData.get(key)`.
   */
  iterationData?: Record<string, string>[]
  stopOnError?: boolean
  /**
   * When true (default) each result carries the full responseBody +
   * responseHeaders. Disable to keep memory low for very large collections —
   * the report still has assertions, status, timing and size.
   */
  persistResponses?: boolean
  folderName?: string
  source?: string
  sourceLabel?: string
  // Set by executeCollectionForScheduler so we can tie this runner_history
  // row back to its scheduled_tasks row even after a rename / delete.
  scheduledTaskId?: string
}

interface RunnerExportOptions {
  results: EndpointRunResult[]
  format: 'json' | 'html'
}

interface ResponseTiming {
  total: number
  dns?: number
  tcp?: number
  tls?: number
  ttfb?: number
  download?: number
}

interface EndpointRunResult {
  endpointId: string
  endpointName: string
  folderName?: string
  method: string
  url: string
  status: number | null
  statusText: string
  duration: number
  passed: number
  failed: number
  skipped: number
  assertions: AssertionResult[]
  error?: string
  responseSize?: number
  responseBody?: string
  responseHeaders?: Record<string, string>
  requestHeaders?: Record<string, string>
  requestBody?: string
  /** 1-based iteration index. Renderer groups results by this field. */
  iteration?: number
}

interface AssertionResult {
  name: string
  passed: boolean
  actual?: string | number
  error?: string
}

interface RunnerProgress {
  current: number
  total: number
  endpointId: string
  result: EndpointRunResult
}

interface RunnerReport {
  projectId: string
  startedAt: number
  completedAt: number
  totalEndpoints: number
  passedEndpoints: number
  failedEndpoints: number
  totalAssertions: number
  passedAssertions: number
  failedAssertions: number
  results: EndpointRunResult[]
}

// ─── State ───────────────────────────────────────────────────────

// Each in-flight run is tracked independently so that stopping one Runner
// tab doesn't abort runs started from a different tab, and an exception in
// `executeCollection` doesn't leave a permanent "already running" flag
// stuck (review findings BLOCKER + HIGH on runner concurrency).
interface RunState {
  shouldStop: boolean
}
const activeRuns = new Map<string, RunState>()
let nextRunId = 1

// ─── Helpers ─────────────────────────────────────────────────────

function parseJsonSafe<T>(json: string | null, fallback: T): T {
  if (!json) return fallback
  try {
    return JSON.parse(json) as T
  } catch {
    return fallback
  }
}

function buildRequestFromEndpoint(endpoint: endpointRepo.EndpointRow): HttpRequestOptions | null {
  const schema = parseJsonSafe<{
    method?: string
    url?: string
    params?: KeyValuePair[]
    headers?: KeyValuePair[]
    body?: RequestBody
    auth?: AuthConfig
    timeout?: number
    followRedirects?: boolean
    sslVerification?: boolean
  }>(endpoint.request_schema, {})

  const url = schema.url || endpoint.path
  if (!url) return null

  return {
    method: schema.method || endpoint.method || 'GET',
    url,
    params: schema.params,
    headers: schema.headers,
    body: schema.body as HttpRequestOptions['body'],
    auth: schema.auth as HttpRequestOptions['auth'],
    timeout: schema.timeout ?? 30000,
    followRedirects: schema.followRedirects ?? true,
    sslVerification: schema.sslVerification ?? true,
  }
}

/**
 * Adapt a manually saved request (saved_requests table) into the same shape
 * the runner uses for imported endpoints. Without this, manual requests come
 * back as "Endpoint not found" when the runner tries `getEndpointById` —
 * because they live in a separate table (Bug 7).
 *
 * The synthesized `request_schema` mirrors what an imported endpoint stores,
 * so the assertion / pre-script / post-script logic downstream just works.
 */
function savedRequestToEndpoint(saved: endpointRepo.SavedRequestRow): endpointRepo.EndpointRow {
  const synthesizedSchema = JSON.stringify({
    method: saved.method ?? 'GET',
    url: saved.url,
    params: parseJsonSafe<unknown[]>(saved.params, []),
    headers: parseJsonSafe<unknown[]>(saved.headers, []),
    body: saved.body ? parseJsonSafe<unknown>(saved.body, null) : undefined,
    auth: saved.auth ? parseJsonSafe<unknown>(saved.auth, null) : undefined,
    preScript: saved.pre_script ?? undefined,
    postScript: saved.post_script ?? undefined,
    assertions: parseJsonSafe<unknown[]>(saved.assertions, []),
  })
  return {
    id: saved.id,
    project_id: saved.project_id ?? '',
    folder_id: saved.folder_id,
    name: saved.name,
    description: null,
    protocol: saved.protocol,
    method: saved.method,
    path: saved.url,
    status: 'developing',
    request_schema: synthesizedSchema,
    response_schemas: null,
    sort_order: saved.sort_order,
    created_at: saved.created_at,
    updated_at: saved.updated_at,
  }
}

/**
 * Adapt a test_suite_items row into the EndpointRow shape the runner uses.
 * Suite items carry their own snapshot of the request (URL, method, params,
 * headers, body, scripts, assertions) — that snapshot is parsed and merged
 * back into `request_schema` so downstream `buildRequestFromEndpoint` and
 * `runAssertionsMainProcess` work unchanged.
 *
 * Assertions are stored on a separate column (test_suite_items.assertions)
 * to keep them edit-able without touching the request_schema JSON; we inject
 * them back into the schema here so the runner finds them in the usual spot.
 */
function suiteItemToEndpoint(item: tsiRepo.TestSuiteItemRow): endpointRepo.EndpointRow {
  const baseSchema = parseJsonSafe<Record<string, unknown>>(item.request_schema, {})
  const assertions = parseJsonSafe<unknown[]>(item.assertions ?? '[]', [])
  const merged = { ...baseSchema, assertions }
  return {
    id: item.id,
    // suite items don't carry project_id directly; runner doesn't read it
    // for the request body itself, but we surface an empty string rather
    // than null to keep the type compat.
    project_id: '',
    folder_id: item.folder_id,
    name: item.name,
    description: null,
    protocol: item.protocol,
    method: item.method,
    path: item.url ?? '',
    status: 'developing',
    request_schema: JSON.stringify(merged),
    response_schemas: null,
    sort_order: item.sort_order,
    created_at: item.created_at,
    updated_at: item.updated_at,
  }
}

/**
 * Look up a runnable entity by ID — supports imported endpoints, manually
 * saved requests, and test-suite items (each item is a fully-snapshotted
 * request and is the source of truth for suite runs).
 */
function getRunnableEntity(id: string): endpointRepo.EndpointRow | undefined {
  const endpoint = endpointRepo.getEndpointById(id)
  if (endpoint) return endpoint
  const saved = endpointRepo.getSavedRequestById(id)
  if (saved) return savedRequestToEndpoint(saved)
  const suiteItem = tsiRepo.getItemById(id)
  if (suiteItem) return suiteItemToEndpoint(suiteItem)
  return undefined
}

function headersArrayToRecord(
  headers?: Array<{ key: string; value: string; enabled?: boolean }>,
): Record<string, string> | undefined {
  if (!headers || headers.length === 0) return undefined
  const out: Record<string, string> = {}
  for (const h of headers) {
    if (h.enabled !== false && h.key) out[h.key] = h.value
  }
  return Object.keys(out).length === 0 ? undefined : out
}

function requestBodyToString(body?: {
  type: string
  content?: string
  urlEncoded?: Array<{ key: string; value: string; enabled?: boolean }>
  formData?: Array<{
    key: string
    value: string
    enabled?: boolean
    fieldType?: string
    filePath?: string
  }>
}): string | undefined {
  if (!body) return undefined
  // Multipart can't be reproduced as text — show a key=value preview with
  // file refs so the runner-result panel still surfaces *what* was sent.
  if (body.type === 'form-data' && body.formData) {
    return body.formData
      .filter((k) => k.enabled !== false)
      .map(
        (k) => `${k.key}=${k.fieldType === 'file' ? `<file:${k.filePath ?? k.value}>` : k.value}`,
      )
      .join('\n')
  }
  if (body.type === 'urlencoded' && body.urlEncoded) {
    return body.urlEncoded
      .filter((k) => k.enabled !== false)
      .map((k) => `${encodeURIComponent(k.key)}=${encodeURIComponent(k.value)}`)
      .join('&')
  }
  // text / javascript / html / xml / json / raw → already a string in body.content
  return body.content
}

/**
 * Flatten `response.headers` into a Record<string,string> regardless of
 * whether the engine handed back an object or an alternating-pair array.
 * Identical to the renderer's `normaliseHeaders` — see test-runner.ts.
 */
function normaliseRunnerHeaders(input: unknown): Record<string, string> {
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

function runAssertionsMainProcess(
  assertions: TestAssertion[],
  response: {
    status?: number
    statusText?: string
    headers?: Record<string, string>
    body?: string
    bodySize?: number
    timing: ResponseTiming
  },
  envVars: Record<string, string>,
): AssertionResult[] {
  // Inline helpers — the assertion's `expected` field is sometimes a string
  // (body_contains, header_equals) and sometimes a number (status_equals,
  // response_time_under). Both forms can contain `{{var}}` so we resolve
  // through the string form and let the caller coerce as needed.
  const resolveStr = (v: unknown): string =>
    typeof v === 'string' ? resolveVariables(v, envVars) : v == null ? '' : String(v)
  const resolveNum = (v: unknown, fallback: number): number => {
    const resolved =
      typeof v === 'string' ? resolveVariables(v, envVars) : v == null ? '' : String(v)
    const n = Number(resolved)
    return Number.isFinite(n) ? n : fallback
  }
  return assertions
    .filter((a) => a.enabled)
    .map((assertion) => {
      try {
        switch (assertion.type) {
          case 'status_equals': {
            const expected = resolveNum(assertion.expected, NaN)
            const actual = response.status ?? 0
            return { name: assertion.name, passed: actual === expected, actual }
          }
          case 'status_in_range': {
            const actual = response.status ?? 0
            // rangeMin / rangeMax are typed as number but the form fields
            // accept text input, so the user may smuggle a `{{var}}` in
            // there too — coerce defensively.
            const min = resolveNum(assertion.rangeMin, 0)
            const max = resolveNum(assertion.rangeMax, 999)
            return { name: assertion.name, passed: actual >= min && actual <= max, actual }
          }
          case 'body_contains': {
            const body = response.body ?? ''
            const expected = resolveStr(assertion.expected)
            return {
              name: assertion.name,
              passed: body.includes(expected),
              actual: body.length > 100 ? `${body.slice(0, 100)}...` : body,
            }
          }
          case 'header_exists': {
            const headerName = resolveStr(assertion.headerName).trim().toLowerCase()
            const headers = normaliseRunnerHeaders(response.headers)
            const found = Object.keys(headers).some((k) => k.toLowerCase() === headerName)
            return { name: assertion.name, passed: found, actual: found ? 'exists' : 'not found' }
          }
          case 'header_equals': {
            const headerName = resolveStr(assertion.headerName).trim().toLowerCase()
            const headers = normaliseRunnerHeaders(response.headers)
            const entry = Object.entries(headers).find(([k]) => k.toLowerCase() === headerName)
            const actual = entry ? entry[1].trim() : ''
            const expected = resolveStr(assertion.expected).trim()
            return { name: assertion.name, passed: actual === expected, actual }
          }
          case 'header_contains': {
            const headerName = resolveStr(assertion.headerName).trim().toLowerCase()
            const headers = normaliseRunnerHeaders(response.headers)
            const entry = Object.entries(headers).find(([k]) => k.toLowerCase() === headerName)
            // Mirror test-runner.ts: trim both sides so contains/equals stay
            // consistent. Stray whitespace on either side shouldn't decide.
            const actual = entry ? entry[1].trim() : ''
            const expected = resolveStr(assertion.expected).trim()
            return { name: assertion.name, passed: actual.includes(expected), actual }
          }
          case 'response_time_under': {
            const actual = response.timing.total
            const expected = resolveNum(assertion.expected, 0)
            return { name: assertion.name, passed: actual < expected, actual }
          }
          case 'response_size_under': {
            const actual = response.bodySize ?? 0
            const expected = resolveNum(assertion.expected, 0)
            return { name: assertion.name, passed: actual < expected, actual }
          }
          default:
            return { name: assertion.name, passed: false, error: `Unknown type: ${assertion.type}` }
        }
      } catch (e) {
        return { name: assertion.name, passed: false, error: (e as Error).message }
      }
    })
}

function sendProgress(progress: RunnerProgress): void {
  const windows = BrowserWindow.getAllWindows()
  for (const win of windows) {
    if (!win.isDestroyed()) {
      win.webContents.send('runner:progress', progress)
    }
  }
}

// ─── pm/insomnia script execution (main-process sandbox) ─────────

interface ScriptContext {
  envVars: Record<string, string>
  envUpdates: Record<string, string>
  iterationData: Record<string, string>
  iterationIndex: number
  iterationCount: number
  /** Set by `pm.execution.skipRequest()` — runner reads after preScript. */
  skipRequest: boolean
  /** Set by `pm.execution.setNextRequest(name)` — runner uses it after the
   *  request to redirect flow. `null` means "stop here". */
  nextRequestName?: string | null
  /** Test results captured from `pm.test(name, fn)`. */
  testResults: Array<{ name: string; passed: boolean; error?: string }>
  /** Console output produced by the script. */
  consoleLogs: string[]
}

function newScriptContext(
  envVars: Record<string, string>,
  iterationData: Record<string, string>,
  iterationIndex: number,
  iterationCount: number,
): ScriptContext {
  return {
    envVars: { ...envVars },
    envUpdates: {},
    iterationData,
    iterationIndex,
    iterationCount,
    skipRequest: false,
    testResults: [],
    consoleLogs: [],
  }
}

interface ScriptResponseShape {
  status?: number
  statusText?: string
  headers?: Record<string, string>
  body?: string
  bodySize?: number
}

/**
 * Run a Postman / Insomnia compatible script in a `new Function` sandbox.
 * Mutates `ctx` (envUpdates, skipRequest, testResults, consoleLogs).
 *
 * The exposed `pm` shim is intentionally minimal — covering the surface used
 * in Postman/Insomnia exports: environment, response, test/expect,
 * iterationData, execution.skipRequest, execution.setNextRequest. More can
 * be added as fixtures demand.
 */
function runUserScript(
  script: string,
  ctx: ScriptContext,
  response: ScriptResponseShape | null,
): void {
  if (!script) return

  const log = (...args: unknown[]): void => {
    ctx.consoleLogs.push(args.map(String).join(' '))
  }

  function buildPm() {
    const expect = (value: unknown) => buildExpectChain(value)
    return {
      iterationData: {
        get: (k: string) => ctx.iterationData[k] ?? '',
        toObject: () => ({ ...ctx.iterationData }),
      },
      info: { iteration: ctx.iterationIndex, iterationCount: ctx.iterationCount },
      environment: {
        get: (k: string) => ctx.envVars[k] ?? '',
        set: (k: string, v: unknown) => {
          ctx.envVars[k] = String(v)
          ctx.envUpdates[k] = String(v)
        },
        unset: (k: string) => {
          delete ctx.envVars[k]
          ctx.envUpdates[k] = ''
        },
      },
      globals: {
        get: (k: string) => ctx.envVars[k] ?? '',
        set: (k: string, v: unknown) => {
          ctx.envVars[k] = String(v)
          ctx.envUpdates[k] = String(v)
        },
      },
      variables: {
        get: (k: string) => ctx.envVars[k] ?? '',
        set: (k: string, v: unknown) => {
          ctx.envVars[k] = String(v)
          ctx.envUpdates[k] = String(v)
        },
      },
      collectionVariables: {
        get: (k: string) => ctx.envVars[k] ?? '',
        set: (k: string, v: unknown) => {
          ctx.envVars[k] = String(v)
          ctx.envUpdates[k] = String(v)
        },
      },
      response: response
        ? buildResponseShim(response)
        : {
            code: 0,
            status: '',
            text: () => '',
            json: () => null,
            headers: { get: () => undefined },
          },
      test: (name: string, fn: () => void) => {
        try {
          fn()
          ctx.testResults.push({ name, passed: true })
        } catch (e) {
          ctx.testResults.push({ name, passed: false, error: (e as Error).message })
        }
      },
      expect,
      execution: {
        skipRequest: () => {
          ctx.skipRequest = true
        },
        setNextRequest: (name: string | null) => {
          ctx.nextRequestName = name
        },
      },
    }
  }

  try {
    const fn = new Function('pm', 'console', script)
    fn(buildPm(), { log, warn: log, error: log })
  } catch (e) {
    ctx.consoleLogs.push(`Script error: ${(e as Error).message}`)
  }
}

function buildResponseShim(response: ScriptResponseShape) {
  const headers = response.headers ?? {}
  const code = response.status ?? 0
  return {
    code,
    get status() {
      return response.statusText ?? ''
    },
    text: () => response.body ?? '',
    json: () => {
      try {
        return JSON.parse(response.body ?? '{}') as unknown
      } catch {
        return null
      }
    },
    headers: {
      get: (name: string) => {
        const lower = name.toLowerCase()
        const found = Object.entries(headers).find(([k]) => k.toLowerCase() === lower)
        return found ? found[1] : undefined
      },
    },
    responseTime: 0,
    responseSize: response.bodySize ?? (response.body ? response.body.length : 0),
    to: {
      have: {
        status: (expected: number) => {
          if (code !== expected) {
            throw new Error(`expected status ${expected} but got ${code}`)
          }
        },
        header: (name: string) => {
          const lower = name.toLowerCase()
          const found = Object.keys(headers).some((k) => k.toLowerCase() === lower)
          if (!found) throw new Error(`expected header "${name}" to be present`)
        },
      },
      be: {
        get ok() {
          if (code < 200 || code >= 300) throw new Error(`expected 2xx but got ${code}`)
          return true
        },
      },
    },
  }
}

// Test Suite runner expect-chain. Fluent chain mirroring chai-BDD so the same
// assertion idioms (.to.be.an('array').that.is.empty, .with.lengthOf(n)) work
// here as in the renderer test-runner.ts. Keep the two implementations in sync.
type ExpectChain = {
  to: ExpectChain
  be: ExpectChain
  is: ExpectChain
  that: ExpectChain
  which: ExpectChain
  with: ExpectChain
  and: ExpectChain
  have: ExpectChain
  not: ExpectChain
  equal: (expected: unknown) => ExpectChain
  eql: (expected: unknown) => ExpectChain
  a: (type: string) => ExpectChain
  an: (type: string) => ExpectChain
  include: (sub: unknown) => ExpectChain
  length: (n: number) => ExpectChain
  lengthOf: (n: number) => ExpectChain
  empty: ExpectChain
  true: ExpectChain
  false: ExpectChain
  null: ExpectChain
  undefined: ExpectChain
}

function buildExpectChain(value: unknown): ExpectChain {
  const fail = (msg: string): never => {
    throw new Error(msg)
  }
  const eqlCheck = (a: unknown, b: unknown): boolean => {
    if (a === b) return true
    if (a == null || b == null) return false
    if (typeof a !== 'object' || typeof b !== 'object') return false
    return JSON.stringify(a) === JSON.stringify(b)
  }
  const isType = (t: string): boolean => {
    const lower = t.toLowerCase()
    if (lower === 'array') return Array.isArray(value)
    if (lower === 'null') return value === null
    return typeof value === lower
  }
  const negated = false

  // Forward-declared so the getters defined inside `make()` can return `chain`
  // before it's assigned. ESLint's `prefer-const` would force a const here,
  // but the value is only known after `make()` returns and the getters need
  // the declaration in scope at construction time.
  // eslint-disable-next-line prefer-const
  let chain: ExpectChain
  const make = (notFlag: boolean): ExpectChain => {
    const check = (cond: boolean, msg: string): void => {
      if (notFlag ? cond : !cond) fail(notFlag ? `negated: ${msg}` : msg)
    }
    const c: Partial<ExpectChain> = {
      equal: (expected) => {
        check(
          value === expected,
          `expected ${JSON.stringify(value)} to strictly equal ${JSON.stringify(expected)}`,
        )
        return chain
      },
      eql: (expected) => {
        check(
          eqlCheck(value, expected),
          `expected ${JSON.stringify(value)} to equal ${JSON.stringify(expected)}`,
        )
        return chain
      },
      a: (type) => {
        check(isType(type), `expected ${JSON.stringify(value)} to be a ${type}`)
        return chain
      },
      an: (type) => {
        check(isType(type), `expected ${JSON.stringify(value)} to be an ${type}`)
        return chain
      },
      include: (sub) => {
        if (typeof value === 'string' && typeof sub === 'string') {
          check(value.includes(sub), `expected "${value}" to include "${sub}"`)
        } else if (Array.isArray(value)) {
          check(
            value.some((v) => eqlCheck(v, sub)),
            `expected array to include ${JSON.stringify(sub)}`,
          )
        } else {
          fail('include is only supported for strings and arrays')
        }
        return chain
      },
      length: (n) => {
        const actual = (value as { length?: number } | null | undefined)?.length
        const match = actual === n
        if (notFlag ? match : !match) {
          fail(
            notFlag
              ? `expected length not to be ${n}`
              : `expected length ${n} but got ${String(actual)}`,
          )
        }
        return chain
      },
      lengthOf: (n) => {
        const actual = (value as { length?: number } | null | undefined)?.length
        const match = actual === n
        if (notFlag ? match : !match) {
          fail(
            notFlag
              ? `expected length not to be ${n}`
              : `expected length ${n} but got ${String(actual)}`,
          )
        }
        return chain
      },
    }
    Object.defineProperties(c, {
      to: { get: () => chain, enumerable: true },
      be: { get: () => chain, enumerable: true },
      is: { get: () => chain, enumerable: true },
      that: { get: () => chain, enumerable: true },
      which: { get: () => chain, enumerable: true },
      with: { get: () => chain, enumerable: true },
      and: { get: () => chain, enumerable: true },
      have: { get: () => chain, enumerable: true },
      not: { get: () => make(true), enumerable: true },
      empty: {
        get: () => {
          const isEmpty =
            (Array.isArray(value) && value.length === 0) ||
            (typeof value === 'string' && value.length === 0) ||
            (value !== null &&
              typeof value === 'object' &&
              Object.keys(value as object).length === 0)
          if (notFlag ? isEmpty : !isEmpty) {
            fail(
              notFlag
                ? `expected ${JSON.stringify(value)} to not be empty`
                : `expected ${JSON.stringify(value)} to be empty`,
            )
          }
          return chain
        },
        enumerable: true,
      },
      true: {
        get: () => {
          check(value === true, `expected ${JSON.stringify(value)} to be true`)
          return chain
        },
        enumerable: true,
      },
      false: {
        get: () => {
          check(value === false, `expected ${JSON.stringify(value)} to be false`)
          return chain
        },
        enumerable: true,
      },
      null: {
        get: () => {
          check(value === null, `expected ${JSON.stringify(value)} to be null`)
          return chain
        },
        enumerable: true,
      },
      undefined: {
        get: () => {
          check(value === undefined, `expected ${JSON.stringify(value)} to be undefined`)
          return chain
        },
        enumerable: true,
      },
    })
    return c as ExpectChain
  }
  chain = make(negated)
  return chain
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// ─── Variable Resolution ─────────────────────────────────────────

// Variable loading lives in `lib/env-vars.ts` so the mock server can share
// the exact same scope-merge logic as the runner. Inline thin wrapper kept
// for the existing call site below.
function loadEnvironmentVariables(
  environmentId: string | undefined,
  workspaceId: string | undefined,
  projectId: string | undefined,
): Record<string, string> {
  return loadEnvVars({ environmentId, workspaceId, projectId })
}

// Renamed for clarity — `resolveVariables` from the shared resolver handles
// `{{$dynamicValue}}` + chained refs that the old runner-local function
// silently skipped.
function resolveRunnerVariables(template: string, vars: Record<string, string>): string {
  return resolveVariables(template, vars)
}

function resolveRequestOptions(
  options: HttpRequestOptions,
  vars: Record<string, string>,
): HttpRequestOptions {
  if (Object.keys(vars).length === 0) return options

  const resolved = { ...options }
  resolved.url = resolveRunnerVariables(resolved.url, vars)

  if (resolved.params) {
    resolved.params = (resolved.params as KeyValuePair[]).map((p) => ({
      ...p,
      key: resolveRunnerVariables(p.key, vars),
      value: resolveRunnerVariables(p.value, vars),
    }))
  }
  if (resolved.headers) {
    resolved.headers = (resolved.headers as KeyValuePair[]).map((h) => ({
      ...h,
      key: resolveRunnerVariables(h.key, vars),
      value: resolveRunnerVariables(h.value, vars),
    }))
  }
  if (resolved.body && (resolved.body as RequestBody).content) {
    resolved.body = {
      ...(resolved.body as RequestBody),
      content: resolveRunnerVariables((resolved.body as RequestBody).content!, vars),
    } as HttpRequestOptions['body']
  }

  if (resolved.auth) {
    const a = resolved.auth as AuthConfig
    const r = (s: string | undefined) => (s === undefined ? s : resolveRunnerVariables(s, vars))
    const next: AuthConfig = { type: a.type }
    if (a.basic)
      next.basic = { username: r(a.basic.username) ?? '', password: r(a.basic.password) ?? '' }
    if (a.bearer) next.bearer = { token: r(a.bearer.token) ?? '', prefix: r(a.bearer.prefix) }
    if (a.apiKey)
      next.apiKey = { key: r(a.apiKey.key) ?? '', value: r(a.apiKey.value) ?? '', in: a.apiKey.in }
    if (a.digest)
      next.digest = { username: r(a.digest.username) ?? '', password: r(a.digest.password) ?? '' }
    if (a.ntlm)
      next.ntlm = {
        username: r(a.ntlm.username) ?? '',
        password: r(a.ntlm.password) ?? '',
        domain: r(a.ntlm.domain),
        workstation: r(a.ntlm.workstation),
      }
    if (a.hawk)
      next.hawk = {
        authId: r(a.hawk.authId) ?? '',
        authKey: r(a.hawk.authKey) ?? '',
        algorithm: a.hawk.algorithm,
      }
    if (a.awsSignature)
      next.awsSignature = {
        accessKey: r(a.awsSignature.accessKey) ?? '',
        secretKey: r(a.awsSignature.secretKey) ?? '',
        region: r(a.awsSignature.region) ?? '',
        service: r(a.awsSignature.service) ?? '',
      }
    if (a.oauth2) next.oauth2 = { token: r(a.oauth2.token) }
    resolved.auth = next as HttpRequestOptions['auth']
  }

  return resolved
}

// ─── Runner Execution ────────────────────────────────────────────

async function executeCollection(options: RunnerExecuteOptions): Promise<RunnerReport> {
  const runId = String(nextRunId++)
  const runState: RunState = { shouldStop: false }
  activeRuns.set(runId, runState)

  const startedAt = Date.now()
  const results: EndpointRunResult[] = []
  const iterationData = options.iterationData ?? []
  const iterations =
    iterationData.length > 0 ? iterationData.length : Math.max(1, options.iterations ?? 1)
  const stopOnError = options.stopOnError ?? false
  const persistResponses = options.persistResponses ?? true
  const endpointsPerIteration = options.endpointIds.length
  const total = endpointsPerIteration * iterations

  // Load environment variables for interpolation.
  //
  // Auto-run paths (right-click → Run from APIs tree, Suite Run from Tests
  // panel) don't carry an explicit `environmentId`. Without a fallback the
  // runner ran with empty env vars and produced unresolved `{{var}}`
  // payloads — the headline bug for this commit. Fall back to whatever the
  // project has registered as the active environment so the runner output
  // matches what "Send" would produce for the same request.
  let effectiveEnvId = options.environmentId
  if (!effectiveEnvId && options.projectId) {
    try {
      const row = getDb()
        .prepare('SELECT id FROM environments WHERE project_id = ? AND is_active = 1 LIMIT 1')
        .get(options.projectId) as { id: string } | undefined
      effectiveEnvId = row?.id || undefined
    } catch {
      /* no active env — fall through with globals-only resolution */
    }
  }
  const envVars = loadEnvironmentVariables(effectiveEnvId, options.workspaceId, options.projectId)

  let totalAssertions = 0
  let passedAssertions = 0
  let failedAssertions = 0
  let passedEndpoints = 0
  let failedEndpoints = 0

  try {
    outer: for (let iter = 0; iter < iterations; iter++) {
      for (let j = 0; j < endpointsPerIteration; j++) {
        if (runState.shouldStop) break outer
        // Linear position across all iterations (used for progress events).
        const i = iter * endpointsPerIteration + j

        // Endpoint id is keyed by the inner loop only — endpointIds has
        // `endpointsPerIteration` elements and is reused across iterations.
        const endpointId = options.endpointIds[j]
        const endpoint = getRunnableEntity(endpointId)

        if (!endpoint) {
          const result: EndpointRunResult = {
            endpointId,
            endpointName: 'Unknown',
            method: 'GET',
            url: '',
            status: null,
            statusText: '',
            duration: 0,
            passed: 0,
            failed: 0,
            skipped: 0,
            assertions: [],
            error: 'Endpoint not found',
            iteration: iter + 1,
          }
          results.push(result)
          failedEndpoints++
          sendProgress({ current: i + 1, total, endpointId, result })
          continue
        }

        const requestOptions = buildRequestFromEndpoint(endpoint)

        if (!requestOptions) {
          const result: EndpointRunResult = {
            endpointId,
            endpointName: endpoint.name,
            method: endpoint.method ?? 'GET',
            url: endpoint.path,
            status: null,
            statusText: '',
            duration: 0,
            passed: 0,
            failed: 0,
            skipped: 0,
            assertions: [],
            error: 'No URL configured for endpoint',
            iteration: iter + 1,
          }
          results.push(result)
          failedEndpoints++
          sendProgress({ current: i + 1, total, endpointId, result })
          continue
        }

        try {
          // Run pre-request script (Postman event[prerequest] / Insomnia preRequest)
          const schemaForScripts = parseJsonSafe<{ preScript?: string; postScript?: string }>(
            endpoint.request_schema,
            {},
          )
          const scriptCtx = newScriptContext(envVars, iterationData[iter] ?? {}, iter, iterations)
          if (schemaForScripts.preScript) {
            runUserScript(schemaForScripts.preScript, scriptCtx, null)
            // Push script env updates back into the global env vars map.
            for (const [k, v] of Object.entries(scriptCtx.envUpdates)) {
              envVars[k] = v
            }
            if (scriptCtx.skipRequest) {
              const skipResult: EndpointRunResult = {
                endpointId,
                endpointName: endpoint.name,
                method: requestOptions.method,
                url: requestOptions.url,
                status: null,
                statusText: 'SKIPPED',
                duration: 0,
                passed: 0,
                failed: 0,
                skipped: 1,
                assertions: [],
                iteration: iter + 1,
              }
              results.push(skipResult)
              sendProgress({ current: i + 1, total, endpointId, result: skipResult })
              if (options.delay && options.delay > 0 && i < total - 1 && !runState.shouldStop) {
                await delay(options.delay)
              }
              continue
            }
          }

          // Resolve environment variables in request
          const resolvedOptions = resolveRequestOptions(requestOptions, envVars)
          const response = await executeHttpRequest(resolvedOptions)

          // Run post-response (test) script
          const scriptTestResults: AssertionResult[] = []
          if (schemaForScripts.postScript) {
            scriptCtx.envUpdates = {}
            runUserScript(schemaForScripts.postScript, scriptCtx, {
              status: response.status,
              statusText: response.statusText,
              headers: response.headers,
              body: response.body,
              bodySize: response.bodySize,
            })
            for (const [k, v] of Object.entries(scriptCtx.envUpdates)) {
              envVars[k] = v
            }
            for (const t of scriptCtx.testResults) {
              scriptTestResults.push({
                name: t.name,
                passed: t.passed,
                error: t.error,
              })
            }
          }

          // Auto-save to history
          try {
            // Mirror request.handler.ts: scrub `user:pass@host` userinfo
            // from the persisted URL so a credential-bearing URL bar entry
            // (or one synthesised by a misconfigured importer) doesn't
            // land on disk in the history table.
            const sanitizedRunnerUrl = stripUrlCredentials(resolvedOptions.url)
            historyRepo.addHistory({
              workspace_id: options.workspaceId,
              project_id: options.projectId,
              endpoint_id: endpointId,
              protocol: endpoint.protocol || 'http',
              method: resolvedOptions.method,
              url: sanitizedRunnerUrl,
              status_code: response.status,
              duration_ms: response.timing?.total ? Math.round(response.timing.total) : undefined,
              // Capture the headers/params/body that actually went out on the
              // wire so the Run Details "Request" tab can show the full picture
              // (auto-applied headers from the auth tab, resolved query params,
              // etc.). Without these the UI looked like the runner had stripped
              // them — v1.3.1 §5.7 / §5.8.
              request_snapshot: JSON.stringify({
                method: resolvedOptions.method,
                url: sanitizedRunnerUrl,
                headers: resolvedOptions.headers ?? [],
                params: resolvedOptions.params ?? [],
                body: resolvedOptions.body
                  ? {
                      type: (resolvedOptions.body as RequestBody).type,
                      content: ((resolvedOptions.body as RequestBody).content ?? '').slice(0, 4096),
                    }
                  : undefined,
                auth: resolvedOptions.auth
                  ? { type: (resolvedOptions.auth as AuthConfig).type }
                  : undefined,
              }),
              response_snapshot: JSON.stringify({
                status: response.status,
                statusText: response.statusText,
                timing: response.timing,
                // Persist the response body + headers + size so opening a
                // historical run entry shows the same response detail
                // users would have seen at run time. Without these, the
                // History "Today" entry for a suite-run request opened
                // with empty Response / Headers / Test Results panels
                // (v1.4.2 T-12.5).
                body: persistResponses ? response.body : undefined,
                headers: persistResponses ? response.headers : undefined,
                bodySize: response.bodySize,
              }),
            })
          } catch {
            // History save failure should not affect runner
          }

          // Parse assertions from request schema
          const schema = parseJsonSafe<{ assertions?: TestAssertion[] }>(
            endpoint.request_schema,
            {},
          )
          const assertions = schema.assertions ?? []

          const declarativeAssertions = runAssertionsMainProcess(
            assertions,
            {
              status: response.status,
              statusText: response.statusText,
              headers: response.headers,
              body: response.body,
              bodySize: response.bodySize,
              timing: response.timing,
            },
            // envVars at this point reflects any pre-script `pm.environment.set`
            // calls — assertions see the same variable space the request did.
            envVars,
          )
          const assertionResults = [...declarativeAssertions, ...scriptTestResults]

          const passed = assertionResults.filter((a) => a.passed).length
          const failed = assertionResults.filter((a) => !a.passed).length

          totalAssertions += assertionResults.length
          passedAssertions += passed
          failedAssertions += failed

          // A request only counts as "passed" when it has no transport error,
          // no failed assertions, AND was not skipped by a pre-script.
          // Previously skipped runs were silently bucketed as passed because
          // skipped runs short-circuit before reaching this point — kept the
          // explicit guard so a future refactor doesn't reintroduce the bug.
          const endpointPassed = failed === 0 && !response.error && (response.status ?? 0) < 400
          if (endpointPassed) passedEndpoints++
          else failedEndpoints++

          const result: EndpointRunResult = {
            endpointId,
            endpointName: endpoint.name,
            method: requestOptions.method,
            // Use the final URL the engine actually hit (after query
            // params + variable substitution + redirects) so the
            // Request tab in run-results shows the same URL the wire
            // saw — not the unresolved configured URL. `actualRequest.url`
            // is already credential-stripped by the engine; the fallback
            // `requestOptions.url` is not, so scrub it here.
            url: response.actualRequest?.url ?? stripUrlCredentials(requestOptions.url),
            status: response.status ?? null,
            statusText: response.statusText ?? '',
            duration: response.timing.total,
            passed,
            failed,
            skipped: 0,
            assertions: assertionResults,
            error: response.error,
            responseSize: response.bodySize ?? 0,
            responseBody: persistResponses ? (response.body ?? undefined) : undefined,
            responseHeaders: persistResponses ? (response.headers ?? undefined) : undefined,
            // Prefer the engine's `actualRequest.headers` over the
            // configured headers array — the engine snapshots what was
            // actually put on the wire after auth-tab injection, default
            // Content-Type/Host/User-Agent fill-ins, and content-length
            // calculation. Without this, the Test Suite run-results
            // request tab only showed the user-typed headers and dropped
            // Authorization / Content-Type / Host (v1.4.2 T-5.1, T-5.3).
            requestHeaders: persistResponses
              ? (response.actualRequest?.headers ?? headersArrayToRecord(resolvedOptions.headers))
              : undefined,
            requestBody: persistResponses
              ? (response.actualRequest?.body ?? requestBodyToString(resolvedOptions.body))
              : undefined,
            iteration: iter + 1,
          }

          results.push(result)
          sendProgress({ current: i + 1, total, endpointId, result })

          if (stopOnError && !endpointPassed) break outer
        } catch (e) {
          const result: EndpointRunResult = {
            endpointId,
            endpointName: endpoint.name,
            method: requestOptions.method,
            url: requestOptions.url,
            status: null,
            statusText: '',
            duration: 0,
            passed: 0,
            failed: 0,
            skipped: 0,
            assertions: [],
            error: (e as Error).message,
            iteration: iter + 1,
          }
          results.push(result)
          failedEndpoints++
          sendProgress({ current: i + 1, total, endpointId, result })

          if (stopOnError) break outer
        }

        // Delay between requests if configured
        if (options.delay && options.delay > 0 && i < total - 1 && !runState.shouldStop) {
          await delay(options.delay)
        }
      }
    }
  } finally {
    // Always release the run slot, even on exception — without this an
    // unhandled error would leave the run permanently registered and
    // any "is this run still going?" check would forever say yes.
    activeRuns.delete(runId)
  }

  const completedAt = Date.now()
  const durationMs = completedAt - startedAt
  const avgRespTime =
    results.length > 0
      ? Math.round(results.reduce((sum, r) => sum + r.duration, 0) / results.length)
      : 0

  // Save to runner_history
  try {
    const db = getDb()
    const { randomUUID } = require('crypto')
    db.prepare(
      `
      INSERT INTO runner_history (id, project_id, environment_name, source, iterations, duration_ms,
        total_endpoints, passed_endpoints, failed_endpoints, total_tests, passed_tests, failed_tests,
        skipped_tests, avg_resp_time, results_json, started_at, folder_name, source_label,
        scheduled_task_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    ).run(
      randomUUID(),
      options.projectId,
      options.environmentId || null,
      options.source || 'Runner',
      iterations,
      durationMs,
      results.length,
      passedEndpoints,
      failedEndpoints,
      totalAssertions,
      passedAssertions,
      failedAssertions,
      results.reduce((acc, r) => acc + (r.skipped || 0), 0),
      avgRespTime,
      JSON.stringify(results),
      startedAt,
      options.folderName || null,
      options.sourceLabel || null,
      options.scheduledTaskId || null,
    )
  } catch {
    // History save failure should not affect runner
  }

  return {
    projectId: options.projectId,
    startedAt,
    completedAt,
    totalEndpoints: results.length,
    passedEndpoints,
    failedEndpoints,
    totalAssertions,
    passedAssertions,
    failedAssertions,
    results,
  }
}

// ─── Export Helpers ───────────────────────────────────────────────

function exportAsJson(results: EndpointRunResult[]): string {
  return JSON.stringify(results, null, 2)
}

function exportAsHtml(results: EndpointRunResult[]): string {
  const totalPassed = results.reduce((sum, r) => sum + r.passed, 0)
  const totalFailed = results.reduce((sum, r) => sum + r.failed, 0)
  const totalDuration = results.reduce((sum, r) => sum + r.duration, 0)
  const endpointsPassed = results.filter((r) => r.failed === 0 && !r.error).length
  const endpointsFailed = results.length - endpointsPassed

  const escapeHtml = (str: string): string =>
    str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

  const rows = results
    .map((r) => {
      const statusColor = r.error ? '#cc2200' : r.failed > 0 ? '#b35a00' : '#1a7a4a'
      const statusBg = r.error ? '#fff0f0' : r.failed > 0 ? '#fff4e0' : '#e8f9f1'
      const statusText = r.error ? 'Error' : r.failed > 0 ? 'Failed' : 'Passed'

      const assertionRows = r.assertions
        .map((a) => {
          const aColor = a.passed ? '#1a7a4a' : '#cc2200'
          const aIcon = a.passed ? '&#10003;' : '&#10007;'
          return `<tr><td style="padding:4px 12px;color:${aColor}">${aIcon} ${escapeHtml(a.name)}</td><td style="padding:4px 12px">${a.actual !== undefined ? escapeHtml(String(a.actual)) : ''}</td><td style="padding:4px 12px;color:${aColor}">${a.error ? escapeHtml(a.error) : ''}</td></tr>`
        })
        .join('')

      return `
      <div style="margin-bottom:16px;border:1px solid #e8e8ed;border-radius:8px;overflow:hidden">
        <div style="display:flex;align-items:center;padding:12px 16px;background:${statusBg};gap:12px">
          <span style="font-weight:600;color:${statusColor};min-width:60px">${escapeHtml(r.method)}</span>
          <span style="flex:1;font-family:monospace;font-size:13px">${escapeHtml(r.url)}</span>
          <span style="font-size:13px;color:#888">${r.duration}ms</span>
          <span style="padding:2px 8px;border-radius:4px;background:${statusColor};color:white;font-size:12px;font-weight:600">${r.status ?? '-'} ${statusText}</span>
        </div>
        ${r.assertions.length > 0 ? `<table style="width:100%;border-collapse:collapse;font-size:13px"><thead><tr style="background:#fafafa;border-top:1px solid #e8e8ed"><th style="padding:6px 12px;text-align:left">Assertion</th><th style="padding:6px 12px;text-align:left">Actual</th><th style="padding:6px 12px;text-align:left">Error</th></tr></thead><tbody>${assertionRows}</tbody></table>` : ''}
        ${r.error ? `<div style="padding:8px 16px;color:#cc2200;font-size:13px;border-top:1px solid #e8e8ed">${escapeHtml(r.error)}</div>` : ''}
      </div>`
    })
    .join('')

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Testnizer - Collection Run Report</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 960px; margin: 40px auto; padding: 0 20px; color: #1a1a2e; background: #f5f5f7; }
    .header { background: white; border-radius: 12px; padding: 24px 32px; margin-bottom: 24px; box-shadow: 0 1px 3px rgba(0,0,0,0.08); }
    .stats { display: flex; gap: 24px; margin-top: 16px; }
    .stat { text-align: center; }
    .stat-value { font-size: 28px; font-weight: 700; }
    .stat-label { font-size: 12px; color: #888; margin-top: 4px; }
  </style>
</head>
<body>
  <div class="header">
    <h1 style="margin:0;font-size:20px;color:#2D5FA0">Testnizer</h1>
    <h2 style="margin:8px 0 0;font-size:16px;font-weight:500">Collection Run Report</h2>
    <p style="margin:8px 0 0;font-size:13px;color:#888">Generated: ${new Date().toISOString()}</p>
    <div class="stats">
      <div class="stat"><div class="stat-value" style="color:#1a7a4a">${endpointsPassed}</div><div class="stat-label">Passed</div></div>
      <div class="stat"><div class="stat-value" style="color:#cc2200">${endpointsFailed}</div><div class="stat-label">Failed</div></div>
      <div class="stat"><div class="stat-value">${results.length}</div><div class="stat-label">Total</div></div>
      <div class="stat"><div class="stat-value" style="color:#0066cc">${totalDuration}ms</div><div class="stat-label">Duration</div></div>
      <div class="stat"><div class="stat-value" style="color:#1a7a4a">${totalPassed}</div><div class="stat-label">Assertions Passed</div></div>
      <div class="stat"><div class="stat-value" style="color:#cc2200">${totalFailed}</div><div class="stat-label">Assertions Failed</div></div>
    </div>
  </div>
  ${rows}
</body>
</html>`
}

// ─── Public API for scheduler ─────────────────────────────────────

export async function executeCollectionForScheduler(
  options: RunnerExecuteOptions,
): Promise<RunnerReport> {
  return executeCollection({ ...options, source: 'Scheduler' })
}

// ─── Register Handlers ───────────────────────────────────────────

export function registerRunnerHandlers(): void {
  ipcMain.handle('runner:execute', async (_event, options: RunnerExecuteOptions) => {
    try {
      // Basic payload validation — the renderer is trusted but a bad
      // sessionStorage payload (corrupted by another tab, downgrade from a
      // previous version) shouldn't crash the main process.
      if (!options || !Array.isArray(options.endpointIds) || options.endpointIds.length === 0) {
        return { success: false, error: 'No endpoints to run' }
      }
      if (typeof options.projectId !== 'string' || !options.projectId) {
        return { success: false, error: 'Missing projectId' }
      }
      for (const id of options.endpointIds) {
        if (typeof id !== 'string' || !id) {
          return { success: false, error: 'Invalid endpoint id in payload' }
        }
        // Cross-project guard via the shared ownership helper.
        if (!isRunnableInProject(id, options.projectId)) {
          return {
            success: false,
            error: `Endpoint ${id} does not belong to project ${options.projectId} — refusing to run`,
          }
        }
      }
      const report = await executeCollection(options)
      return { success: true, data: report }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })

  ipcMain.handle('runner:stop', async () => {
    try {
      // Stop every in-flight run. Today the renderer doesn't pass a run id,
      // and there's no UI affordance to target one of several concurrent
      // runs, so "Stop" is project-wide by design. The shouldStop flag is
      // per-RunState now, so this only nudges currently-registered runs
      // — finished runs are no longer in the map.
      let stopped = 0
      for (const run of activeRuns.values()) {
        run.shouldStop = true
        stopped++
      }
      return { success: true, data: stopped > 0 }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })

  ipcMain.handle('runner:export', async (_event, options: RunnerExportOptions) => {
    try {
      let content: string
      if (options.format === 'html') {
        content = exportAsHtml(options.results)
      } else {
        content = exportAsJson(options.results)
      }
      return { success: true, data: content }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })

  ipcMain.handle(
    'runner:history',
    async (
      _event,
      arg:
        | string
        | { projectId: string; limit?: number; offset?: number; tab?: 'Functional' | 'Scheduled' },
    ) => {
      try {
        const db = getDb()

        // Backward-compatible: accept plain projectId string
        if (typeof arg === 'string') {
          const rows = db
            .prepare(
              'SELECT * FROM runner_history WHERE project_id = ? ORDER BY started_at DESC LIMIT 100',
            )
            .all(arg)
          return { success: true, data: rows }
        }

        const { projectId, tab } = arg
        // Clamp renderer-supplied paging so a corrupted payload can't ask
        // for a million rows + blow main-process memory.
        const limit = Math.max(1, Math.min(500, arg.limit ?? 20))
        const offset = Math.max(0, arg.offset ?? 0)
        const sourceFilter =
          tab === 'Scheduled'
            ? "source = 'Scheduler'"
            : tab === 'Functional'
              ? "source != 'Scheduler'"
              : '1=1'

        const rows = db
          .prepare(
            `SELECT * FROM runner_history WHERE project_id = ? AND ${sourceFilter} ORDER BY started_at DESC LIMIT ? OFFSET ?`,
          )
          .all(projectId, limit, offset)

        const totalRow = db
          .prepare(
            `SELECT COUNT(*) as n FROM runner_history WHERE project_id = ? AND ${sourceFilter}`,
          )
          .get(projectId) as { n: number }

        return { success: true, data: { rows, total: totalRow.n } }
      } catch (e) {
        return { success: false, error: (e as Error).message }
      }
    },
  )

  ipcMain.handle('runner:historyStats', async (_event, projectId: string) => {
    try {
      const db = getDb()
      const row = db
        .prepare(
          `SELECT
           COUNT(*) as runs,
           COALESCE(SUM(total_endpoints), 0) as totalEndpoints,
           COALESCE(SUM(passed_endpoints), 0) as passedEndpoints,
           COALESCE(SUM(failed_endpoints), 0) as failedEndpoints
         FROM runner_history WHERE project_id = ?`,
        )
        .get(projectId) as {
        runs: number
        totalEndpoints: number
        passedEndpoints: number
        failedEndpoints: number
      }
      return { success: true, data: row }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })

  ipcMain.handle('runner:deleteHistory', async (_event, ids: string | string[]) => {
    try {
      const db = getDb()
      const idList = Array.isArray(ids) ? ids : [ids]
      const placeholders = idList.map(() => '?').join(',')
      db.prepare(`DELETE FROM runner_history WHERE id IN (${placeholders})`).run(...idList)
      return { success: true }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })
}
