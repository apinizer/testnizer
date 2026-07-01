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
import * as envRepo from '../db/environment.repo'
import { getDb } from '../db/database'
import type { FolderRow } from '../db/project.repo'
import { isRunnableInProject } from '../lib/ownership'
import { resolveVariables } from '../lib/variable-resolver'
import { loadEnvVars } from '../lib/env-vars'
import { evaluateJsonPath } from '../lib/json-path'
import { loadProjectSettings } from '../lib/project-settings'
import {
  projectAuthToAuthConfig,
  resolveEffectiveAuth,
  collectCascadeScripts,
  type AuthConfigLike,
} from '../lib/auth-inheritance'
import { buildScriptBindings, createPmResponse, expect as chaiExpect } from '../../shared/script'
import type { NormalizedResponse, PmLike } from '../../shared/script'
import { endpointDidPass } from '../../shared/runner-verdict'

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
  oauth2?: {
    token?: string
    grantType?: 'authorization_code' | 'client_credentials' | 'password' | 'implicit'
    tokenUrl?: string
    clientId?: string
    clientSecret?: string
    scope?: string
    username?: string
    password?: string
    clientAuth?: 'header' | 'body'
  }
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
  /**
   * Postman "Keep variable values" — when true (default) environment / global
   * variables written by scripts during the run (`pm.environment.set`,
   * `insomnia.environment.set`, …) are persisted back to the active environment
   * after the run completes, so a token fetched once in a setup request is
   * reused (and refreshed in one place) by every later request and by
   * subsequent runs. Set false to keep the run side-effect-free (issue #12).
   */
  keepVariableValues?: boolean
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
  /**
   * Variables written by scripts during the run and (when keepVariableValues
   * is on) persisted to the active environment / project globals. The renderer
   * uses these deltas to refresh its in-memory env store so the next "Send"
   * and the env editor reflect the new values without a manual reload.
   */
  envUpdates?: Record<string, string>
  globalUpdates?: Record<string, string>
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
    maxRedirects?: number
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
    // Mirror the engine's "explicit 0 = no timeout" semantics (issue #24)
    // rather than clobbering 0 with the 30s default.
    timeout: schema.timeout == null ? 30000 : schema.timeout,
    followRedirects: schema.followRedirects ?? true,
    maxRedirects: schema.maxRedirects,
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

/** Which table a runnable id resolved from — drives folder-chain table choice. */
type RunnableKind = 'endpoint' | 'saved' | 'suite'

interface RunnableEntity {
  row: endpointRepo.EndpointRow
  kind: RunnableKind
}

/**
 * Look up a runnable entity by ID — supports imported endpoints, manually
 * saved requests, and test-suite items (each item is a fully-snapshotted
 * request and is the source of truth for suite runs). The `kind` tells the
 * caller which folder table the row's `folder_id` belongs to: suite items
 * reference `test_suite_folders`, everything else references `folders`.
 */
function getRunnableEntity(id: string): RunnableEntity | undefined {
  const endpoint = endpointRepo.getEndpointById(id)
  if (endpoint) return { row: endpoint, kind: 'endpoint' }
  const saved = endpointRepo.getSavedRequestById(id)
  if (saved) return { row: savedRequestToEndpoint(saved), kind: 'saved' }
  const suiteItem = tsiRepo.getItemById(id)
  if (suiteItem) return { row: suiteItemToEndpoint(suiteItem), kind: 'suite' }
  return undefined
}

/**
 * Walk an endpoint's ancestor folder chain, outermost → innermost (leaf). Used
 * to resolve inherited auth and cascade scripts. Cycle-guarded so a corrupt
 * parent_id loop can't hang the run.
 */
function buildFolderChain(folderId: string | null | undefined): FolderRow[] {
  if (!folderId) return []
  const db = getDb()
  const chain: FolderRow[] = []
  const seen = new Set<string>()
  let id: string | null = folderId
  while (id && !seen.has(id)) {
    seen.add(id)
    const folder = db.prepare('SELECT * FROM folders WHERE id = ?').get(id) as FolderRow | undefined
    if (!folder) break
    chain.unshift(folder)
    id = folder.parent_id
  }
  return chain
}

/**
 * Suite-item variant of buildFolderChain: walks `test_suite_folders` instead of
 * the APIs `folders` table so an imported collection's folder-level auth +
 * pre/post scripts cascade at run time (project → folder(s) → request). Adapts
 * each row to the FolderRow shape so it feeds the SAME resolveEffectiveAuth /
 * collectCascadeScripts the APIs path uses. `project_id` is unused by those and
 * filled with '' (test_suite_folders has no such column).
 */
function buildSuiteFolderChain(folderId: string | null | undefined): FolderRow[] {
  if (!folderId) return []
  const db = getDb()
  const chain: FolderRow[] = []
  const seen = new Set<string>()
  let id: string | null = folderId
  while (id && !seen.has(id)) {
    seen.add(id)
    const f = db.prepare('SELECT * FROM test_suite_folders WHERE id = ?').get(id) as
      | {
          id: string
          parent_id: string | null
          name: string
          sort_order: number
          auth?: string | null
          pre_script?: string | null
          post_script?: string | null
        }
      | undefined
    if (!f) break
    chain.unshift({
      id: f.id,
      project_id: '',
      parent_id: f.parent_id,
      name: f.name,
      sort_order: f.sort_order,
      auth: f.auth ?? null,
      pre_script: f.pre_script ?? null,
      post_script: f.post_script ?? null,
    })
    id = f.parent_id
  }
  return chain
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
          // body_equals_json / body_jsonpath mirror src/renderer/lib/test-runner.ts
          // (assertBodyEqualsJson / assertBodyJsonPath). The runner used to reject
          // these as "Unknown type", so a JSONPath assertion that passed on Send
          // silently failed in the Runner — see CLAUDE.md "Header assertion
          // paralelliği". Keep both evaluators in lockstep.
          case 'body_equals_json': {
            try {
              const actualObj = JSON.parse(response.body ?? '{}')
              const expectedObj = JSON.parse(resolveStr(assertion.expected) || '{}')
              const passed = JSON.stringify(actualObj) === JSON.stringify(expectedObj)
              return { name: assertion.name, passed, actual: response.body ?? '' }
            } catch (e) {
              return {
                name: assertion.name,
                passed: false,
                error: `JSON parse error: ${(e as Error).message}`,
              }
            }
          }
          case 'body_jsonpath': {
            try {
              const obj = JSON.parse(response.body ?? '{}')
              const jpPath = assertion.jsonPath ?? '$'
              const actualVal = evaluateJsonPath(obj, jpPath)
              const actualStr =
                typeof actualVal === 'object' ? JSON.stringify(actualVal) : String(actualVal ?? '')
              const expected = resolveStr(assertion.expected)
              if (expected === '') {
                return { name: assertion.name, passed: actualVal !== undefined, actual: actualStr }
              }
              return { name: assertion.name, passed: actualStr === expected, actual: actualStr }
            } catch (e) {
              return {
                name: assertion.name,
                passed: false,
                error: `JSONPath error: ${(e as Error).message}`,
              }
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
  /** Active-environment writes (pm.environment.set / collectionVariables.set). */
  envUpdates: Record<string, string>
  /** Global writes (pm.globals.set) — persisted to project globals, not the env. */
  globalUpdates: Record<string, string>
  /** pm.variables.set writes. Visible to later requests IN THIS RUN (merged into
   *  the shared envVars) but deliberately NOT persisted to the DB. This diverges
   *  from stock Postman/Insomnia (where pm.variables is request-local) — kept on
   *  purpose so a token set via variables.set survives across a suite run.
   *  Empty-string value = unset. */
  varUpdates: Record<string, string>
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
  /** In-flight `pm.sendRequest(...)` promises; the runner awaits these before
   *  finishing a script so callback-style sends complete. */
  pendingSends: Array<Promise<unknown>>
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
    globalUpdates: {},
    varUpdates: {},
    iterationData,
    iterationIndex,
    iterationCount,
    skipRequest: false,
    testResults: [],
    consoleLogs: [],
    pendingSends: [],
  }
}

interface ScriptResponseShape {
  status?: number
  statusText?: string
  headers?: Record<string, string>
  body?: string
  bodySize?: number
  /** Cookies the engine parsed from the response Set-Cookie headers. */
  cookies?: Array<{ name: string; value: string }>
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
async function runUserScript(
  script: string,
  ctx: ScriptContext,
  response: ScriptResponseShape | null,
): Promise<void> {
  if (!script) return

  const log = (...args: unknown[]): void => {
    ctx.consoleLogs.push(args.map(String).join(' '))
  }

  const normalized: NormalizedResponse | null = response
    ? {
        code: response.status ?? 0,
        statusText: response.statusText ?? '',
        headers: response.headers ?? {},
        body: response.body ?? '',
        cookies: response.cookies ?? [],
        responseTime: 0,
        responseSize: response.bodySize ?? (response.body ? response.body.length : 0),
      }
    : null
  const substitute = (t: string, obj: Record<string, unknown>): string =>
    t.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_m, k: string) =>
      obj[k] == null ? `{{${k}}}` : String(obj[k]),
    )
  const clearAll = (mark?: Record<string, string>): void => {
    for (const k of Object.keys(ctx.envVars)) {
      delete ctx.envVars[k]
      if (mark) mark[k] = ''
    }
  }
  const cookieFind = (n: string) =>
    (normalized?.cookies ?? []).find((c) => c.name.toLowerCase() === n.toLowerCase())

  function buildPm(): PmLike {
    return {
      info: {
        eventName: 'test',
        iteration: ctx.iterationIndex,
        iterationCount: ctx.iterationCount,
        requestName: '',
        requestId: '',
      },
      iterationData: {
        get: (k: string) => ctx.iterationData[k] ?? '',
        has: (k: string) => k in ctx.iterationData,
        toObject: () => ({ ...ctx.iterationData }),
      },
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
        has: (k: string) => k in ctx.envVars,
        clear: () => clearAll(ctx.envUpdates),
        toObject: () => ({ ...ctx.envVars }),
        replaceIn: (t: string) => substitute(t, ctx.envVars),
      },
      globals: {
        get: (k: string) => ctx.envVars[k] ?? '',
        set: (k: string, v: unknown) => {
          ctx.envVars[k] = String(v)
          ctx.globalUpdates[k] = String(v)
        },
        unset: (k: string) => {
          delete ctx.envVars[k]
          ctx.globalUpdates[k] = ''
        },
        has: (k: string) => k in ctx.envVars,
        clear: () => clearAll(ctx.globalUpdates),
        toObject: () => ({ ...ctx.envVars }),
        replaceIn: (t: string) => substitute(t, ctx.envVars),
      },
      // pm.variables.* route through a run-local `varUpdates` channel: they
      // propagate to later requests WITHIN this run (merged into the shared
      // envVars by mergeScriptUpdates) but are never written to the DB, so
      // "Keep variable values" still won't persist them. This intentionally
      // diverges from stock Postman/Insomnia (request-local) — see ScriptContext.
      variables: {
        get: (k: string) => ctx.envVars[k] ?? '',
        set: (k: string, v: unknown) => {
          ctx.envVars[k] = String(v)
          ctx.varUpdates[k] = String(v)
        },
        has: (k: string) => k in ctx.envVars,
        unset: (k: string) => {
          delete ctx.envVars[k]
          ctx.varUpdates[k] = ''
        },
        clear: () => clearAll(ctx.varUpdates),
        toObject: () => ({ ...ctx.envVars }),
        replaceIn: (t: string) => substitute(t, ctx.envVars),
      },
      collectionVariables: {
        get: (k: string) => ctx.envVars[k] ?? '',
        set: (k: string, v: unknown) => {
          ctx.envVars[k] = String(v)
          ctx.envUpdates[k] = String(v)
        },
        unset: (k: string) => {
          delete ctx.envVars[k]
          ctx.envUpdates[k] = ''
        },
        has: (k: string) => k in ctx.envVars,
        clear: () => clearAll(ctx.envUpdates),
        toObject: () => ({ ...ctx.envVars }),
        replaceIn: (t: string) => substitute(t, ctx.envVars),
      },
      request: { method: '', url: '', headers: {} },
      response: normalized ? createPmResponse(normalized) : null,
      cookies: {
        get: (n: string) => cookieFind(n)?.value,
        has: (n: string) => !!cookieFind(n),
        toObject: () =>
          Object.fromEntries((normalized?.cookies ?? []).map((c) => [c.name, c.value])),
      },
      test: (name: string, fn: () => void | Promise<void>) => {
        try {
          fn()
          ctx.testResults.push({ name, passed: true })
        } catch (e) {
          ctx.testResults.push({ name, passed: false, error: (e as Error).message })
        }
      },
      expect: chaiExpect,
      execution: {
        skipRequest: () => {
          ctx.skipRequest = true
        },
        setNextRequest: (name: string | null) => {
          ctx.nextRequestName = name
        },
      },
      // pm.sendRequest — fire an auxiliary HTTP request mid-script via the same
      // engine the runner uses. Returns a Promise (so `await pm.sendRequest`
      // works) and calls the optional Node-style callback. The runner awaits
      // `ctx.pendingSends` so callback-only sends finish too. Mirrors the Send
      // path (test-runner.ts).
      sendRequest: (
        req: unknown,
        cb?: (err: Error | null, res: unknown) => void,
      ): Promise<unknown> => {
        const run = executeHttpRequest(normalizeRunnerSendInput(req)).then((apiResp) =>
          buildResponseShim({
            status: apiResp.status,
            statusText: apiResp.statusText,
            headers: apiResp.headers,
            body: apiResp.body,
            bodySize: apiResp.bodySize,
            cookies: apiResp.cookies,
          }),
        )
        const handled = run.then(
          (res) => {
            if (cb) cb(null, res)
            return res
          },
          (err: unknown) => {
            const e = err instanceof Error ? err : new Error(String(err))
            if (cb) {
              cb(e, null)
              return undefined
            }
            throw e
          },
        )
        ctx.pendingSends.push(handled.catch(() => undefined))
        return handled
      },
    }
  }

  // Assemble the COMPLETE script global set from the shared runtime — IDENTICAL
  // to the Send path (test-runner.ts), one source ⇒ no parity drift. Provides
  // pm/t/insomnia/bru/req/res, require() + the full library set, the legacy
  // postman.*/responseBody/tests/xml2Json interface, bare expect/test, and the
  // CryptoJS/_/atob/btoa globals.
  const pm = buildPm()
  const { bindings, legacyTests } = buildScriptBindings({ pm, normalizedResponse: normalized })
  const allBindings: Record<string, unknown> = {
    ...bindings,
    console: { log, warn: log, error: log },
  }
  const names = Object.keys(allBindings)
  const values = names.map((n) => allBindings[n])

  try {
    // Async function body so scripts can `await pm.sendRequest(...)` / use
    // top-level await; a plain sync body still works unchanged.
    //
    // Wrap the body in a `{ }` block so user `const`/`let` redeclarations of an
    // injected global (e.g. `const _ = require('lodash')`) SHADOW the param
    // instead of colliding with it ("Identifier '_' has already been declared").
    // Mirrors the Send path (test-runner.ts) — keep both wrapped.
    const AsyncFunction = Object.getPrototypeOf(async function () {})
      .constructor as FunctionConstructor
    const fn = new AsyncFunction(...names, `{\n${script}\n}`)
    await fn(...values)
  } catch (e) {
    ctx.consoleLogs.push(`Script error: ${(e as Error).message}`)
  }

  // Drain the legacy `tests` object (tests['name'] = bool) into test results.
  for (const [name, passed] of Object.entries(legacyTests)) {
    ctx.testResults.push({ name, passed })
  }

  // Wait for any in-flight `pm.sendRequest(...)` calls (their callbacks may
  // register env writes / pm.test cases) before returning to the runner.
  if (ctx.pendingSends.length > 0) {
    await Promise.allSettled(ctx.pendingSends)
    ctx.pendingSends.length = 0
  }
}

/**
 * Postman-compatible `pm.response.cookies` shim — case-insensitive read access
 * to the cookies the engine parsed from the response Set-Cookie headers. Mirror
 * of the renderer's createPmApi cookie shim (test-runner.ts).
 */
function buildCookieShim(cookies: Array<{ name: string; value: string }> | undefined) {
  const list = cookies ?? []
  const find = (name: string) => list.find((c) => c.name.toLowerCase() === name.toLowerCase())
  return {
    get: (name: string) => find(name)?.value,
    has: (name: string) => !!find(name),
    toObject: () => Object.fromEntries(list.map((c) => [c.name, c.value])),
  }
}

/**
 * Normalize a `pm.sendRequest` input (URL string or Postman request object)
 * into engine HttpRequestOptions. Mirror of the renderer's normalizePmSendInput
 * (test-runner.ts) — keep the two in lockstep.
 */
function normalizeRunnerSendInput(req: unknown): HttpRequestOptions {
  if (typeof req === 'string') return { method: 'GET', url: req }
  const r = (req ?? {}) as {
    url?: string | { raw?: string }
    method?: string
    header?: Array<{ key: string; value: string; disabled?: boolean }> | Record<string, string>
    body?: string | { mode?: string; raw?: string; options?: { raw?: { language?: string } } }
  }
  const url = typeof r.url === 'string' ? r.url : (r.url?.raw ?? '')
  const method = (r.method ?? 'GET').toUpperCase()
  let headers: Array<{ key: string; value: string; enabled: boolean }> = []
  if (Array.isArray(r.header)) {
    headers = r.header.map((h) => ({ key: h.key, value: h.value, enabled: h.disabled !== true }))
  } else if (r.header && typeof r.header === 'object') {
    headers = Object.entries(r.header).map(([key, value]) => ({
      key,
      value: String(value),
      enabled: true,
    }))
  }
  let body: { type: string; content?: string } | undefined
  if (typeof r.body === 'string') {
    body = { type: 'text', content: r.body }
  } else if (r.body && r.body.mode === 'raw') {
    const isJson = r.body.options?.raw?.language === 'json'
    body = { type: isJson ? 'json' : 'text', content: r.body.raw ?? '' }
  }
  return { method, url, headers, body } as HttpRequestOptions
}

function buildResponseShim(response: ScriptResponseShape) {
  const headers = response.headers ?? {}
  const code = response.status ?? 0
  return {
    code,
    get status() {
      return response.statusText ?? ''
    },
    // Raw body string — alias of text(). Postman/Insomnia token scripts do
    // `String(pm.response.body).trim()` then JSON.parse it, so body must be the
    // raw string, never a parsed object. Mirrors the Send path (test-runner.ts).
    get body() {
      return response.body ?? ''
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
    cookies: buildCookieShim(response.cookies),
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
  if (resolved.body) {
    // Resolve EVERY substitutable body field, mirroring the renderer's
    // `resolveRequestBody` (variable-resolver.ts). Previously only `body.content`
    // was resolved, so form-data / urlencoded values — which live in arrays, not
    // `content` — reached the wire with literal `{{var}}` placeholders: Send
    // resolved the body, Run didn't (issue #10, the body-shaped sibling of #4).
    const b = resolved.body as RequestBody
    const next: RequestBody = { ...b }
    if (b.content != null) {
      next.content = resolveRunnerVariables(b.content, vars)
    }
    if (b.formData) {
      next.formData = b.formData.map((row) => {
        const r = row as KeyValuePair & { filePath?: string }
        return {
          ...row,
          key: resolveRunnerVariables(r.key, vars),
          value: resolveRunnerVariables(r.value, vars),
          ...(r.filePath != null ? { filePath: resolveRunnerVariables(r.filePath, vars) } : {}),
        }
      })
    }
    if (b.urlEncoded) {
      next.urlEncoded = b.urlEncoded.map((row) => ({
        ...row,
        key: resolveRunnerVariables(row.key, vars),
        value: resolveRunnerVariables(row.value, vars),
      }))
    }
    if (b.binaryPath != null) {
      next.binaryPath = resolveRunnerVariables(b.binaryPath, vars)
    }
    resolved.body = next as HttpRequestOptions['body']
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
    if (a.oauth2)
      // Carry the FULL OAuth2 grant config (resolved), not just the token, so
      // the engine can auto-fetch a client_credentials/password token. Dropping
      // the other fields here meant the Runner never had tokenUrl/clientId to
      // grant from.
      next.oauth2 = {
        ...a.oauth2,
        token: r(a.oauth2.token),
        tokenUrl: r(a.oauth2.tokenUrl),
        clientId: r(a.oauth2.clientId),
        clientSecret: r(a.oauth2.clientSecret),
        scope: r(a.oauth2.scope),
        username: r(a.oauth2.username),
        password: r(a.oauth2.password),
      }
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

  // Project-level auth + cascade scripts (inheritance). Loaded once per run.
  // `projectSettings` feeds the script cascade (project → folder → request);
  // `projectAuth` is the bottom fallback when a request's auth is 'inherit' and
  // no ancestor folder sets one. Best-effort — undefined in headless contexts.
  const projectSettings = await loadProjectSettings(options.projectId)
  const projectAuth = projectAuthToAuthConfig(projectSettings?.auth)

  // Run-level accumulators for every variable a script writes. `envVars` is
  // mutated in place so updates flow to *later requests within this run*; these
  // two records additionally capture the net deltas so they can be persisted to
  // the DB after the run (Postman "Keep variable values") and returned to the
  // renderer to refresh its in-memory env store (issue #12).
  const runEnvUpdates: Record<string, string> = {}
  const runGlobalUpdates: Record<string, string> = {}

  let totalAssertions = 0
  let passedAssertions = 0
  let failedAssertions = 0
  let passedEndpoints = 0
  let failedEndpoints = 0

  try {
    // Flow-control map (built once): request NAME → first index in the run list.
    // pm.execution.setNextRequest(name) jumps to the first case-insensitive match.
    const nameToIndex = new Map<string, number>()
    options.endpointIds.forEach((id, idx) => {
      const nm = (getRunnableEntity(id)?.row.name ?? '').trim().toLowerCase()
      if (nm && !nameToIndex.has(nm)) nameToIndex.set(nm, idx)
    })

    outer: for (let iter = 0; iter < iterations; iter++) {
      // Bound jumps so a setNextRequest cycle can't hang the run.
      let flowVisits = 0
      const maxVisits = endpointsPerIteration * 10 + 50
      for (let j = 0; j < endpointsPerIteration; j++) {
        if (runState.shouldStop) break outer
        if (++flowVisits > maxVisits) {
          console.warn(
            `[runner] flow-control visit budget (${maxVisits}) exhausted; stopping iteration ${iter + 1}`,
          )
          break
        }
        // Linear position across all iterations (used for progress events).
        const i = iter * endpointsPerIteration + j

        // Endpoint id is keyed by the inner loop only — endpointIds has
        // `endpointsPerIteration` elements and is reused across iterations.
        const endpointId = options.endpointIds[j]
        const entity = getRunnableEntity(endpointId)

        if (!entity) {
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
        const endpoint = entity.row

        // The collection runner drives requests through the HTTP engine. SOAP /
        // GraphQL already ride that path (snapshot carries url + baked body), but
        // gRPC / WebSocket / SSE / Socket.IO are genuinely non-HTTP. Surface a
        // clear "unsupported" result (counted as skipped, so it neither fails the
        // suite nor trips stopOnError) instead of a misleading "No URL".
        const proto = (endpoint.protocol || 'http').toLowerCase()
        const HTTP_LIKE = new Set(['http', 'https', 'rest', 'soap', 'graphql', ''])
        if (!HTTP_LIKE.has(proto)) {
          const result: EndpointRunResult = {
            endpointId,
            endpointName: endpoint.name,
            method: endpoint.method ?? '',
            url: endpoint.path,
            status: null,
            statusText: 'UNSUPPORTED',
            duration: 0,
            passed: 0,
            failed: 0,
            skipped: 1,
            assertions: [],
            error: `Protocol "${proto}" is not supported in the collection runner yet`,
            iteration: iter + 1,
          }
          results.push(result)
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
          // Resolve inherited auth + cascade scripts up the folder/project chain.
          // Suite items live under test_suite_folders; everything else under the
          // APIs `folders` table — pick the matching walker so folder-level
          // setup/teardown scripts + auth cascade for imported suites too.
          const folderChain =
            entity.kind === 'suite'
              ? buildSuiteFolderChain(endpoint.folder_id)
              : buildFolderChain(endpoint.folder_id)
          const schemaForScripts = parseJsonSafe<{
            preScript?: string
            postScript?: string
            auth?: AuthConfig
          }>(endpoint.request_schema, {})

          // Auth: request → nearest folder → project (override; 'inherit'/unset
          // is transparent, explicit 'none' stops). Replaces the request's own
          // auth on the outgoing options before variable resolution.
          const effectiveAuth = resolveEffectiveAuth(
            requestOptions.auth as unknown as AuthConfigLike | null | undefined,
            folderChain,
            projectAuth,
          )
          requestOptions.auth = (effectiveAuth ??
            undefined) as unknown as HttpRequestOptions['auth']

          // Scripts: cascade top-down (project → folder(s) → request).
          const { pre: preScripts, post: postScripts } = collectCascadeScripts(
            folderChain,
            projectSettings,
            schemaForScripts.preScript,
            schemaForScripts.postScript,
          )

          // Run pre-request scripts in order. They share one context so a
          // project/folder script's env writes are visible to inner scripts.
          const scriptCtx = newScriptContext(envVars, iterationData[iter] ?? {}, iter, iterations)
          for (const s of preScripts) {
            scriptCtx.envUpdates = {}
            scriptCtx.globalUpdates = {}
            scriptCtx.varUpdates = {}
            await runUserScript(s, scriptCtx, null)
            mergeScriptUpdates(scriptCtx, envVars, runEnvUpdates, runGlobalUpdates)
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

          // Resolve environment variables in request
          const resolvedOptions = resolveRequestOptions(requestOptions, envVars)
          // Scope the cookie jar to this project so session cookies (login →
          // protected call) behave the same in Run as they do in Send. Without
          // it the engine falls back to the shared "_default" jar (issue: Send
          // OK / Run 401 on cookie-auth flows).
          resolvedOptions.projectId = options.projectId
          const response = await executeHttpRequest(resolvedOptions)

          // Run post-response (test) scripts in cascade order (project →
          // folder(s) → request). They share the run's script context, so a
          // folder/project test sees the same response + env the request used.
          const scriptTestResults: AssertionResult[] = []
          for (const s of postScripts) {
            scriptCtx.envUpdates = {}
            scriptCtx.globalUpdates = {}
            scriptCtx.varUpdates = {}
            await runUserScript(s, scriptCtx, {
              status: response.status,
              statusText: response.statusText,
              headers: response.headers,
              body: response.body,
              bodySize: response.bodySize,
              cookies: response.cookies,
            })
            mergeScriptUpdates(scriptCtx, envVars, runEnvUpdates, runGlobalUpdates)
          }
          // Collect every pm.test() the scripts registered (pre + post).
          for (const t of scriptCtx.testResults) {
            scriptTestResults.push({
              name: t.name,
              passed: t.passed,
              error: t.error,
            })
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
                // Carry the binary flag so a base64 image/PDF restored from a
                // run's history previews as the file, not its base64 text
                // (issue #25 follow-up).
                bodyEncoding: response.bodyEncoding,
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

          // Endpoint verdict via the SHARED rule (shared/runner-verdict.ts) so
          // the live run summary, the HTML report, and the renderer results
          // views all agree: assertion-driven when the request has any checks
          // (an idempotent DELETE asserting `oneOf([200,204,404,400])` passes on
          // 400 — issue #16), HTTP-status fallback only for check-less requests.
          const endpointPassed = endpointDidPass(result)
          if (endpointPassed) passedEndpoints++
          else failedEndpoints++

          results.push(result)
          sendProgress({ current: i + 1, total, endpointId, result })

          // Flow control: honour pm.execution.setNextRequest(name|null) from this
          // request's scripts. null = stop this iteration; a name = jump to that
          // request (first case-insensitive match); unknown name = warn + continue
          // linearly. The visit budget above guards against cycles. (skipRequest +
          // setNextRequest combos aren't honoured — skip short-circuits earlier.)
          const nextName = scriptCtx.nextRequestName
          if (nextName === null) break
          if (typeof nextName === 'string' && nextName.trim()) {
            const target = nameToIndex.get(nextName.trim().toLowerCase())
            if (target == null) {
              console.warn(
                `[runner] setNextRequest("${nextName}") — no request with that name; continuing linearly`,
              )
            } else {
              j = target - 1 // the for-loop's j++ lands execution on `target`
            }
          }

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

  // Persist script-written variables back to the DB (Postman "Keep variable
  // values", default on). Mirrors the renderer's Send-path
  // `environment.store.applyScriptUpdates` so a token fetched once survives
  // across separate folder runs and shows up in the env editor (issue #12).
  if (options.keepVariableValues !== false) {
    persistRunVariableUpdates(effectiveEnvId, options.projectId, runEnvUpdates, runGlobalUpdates)
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
    envUpdates: runEnvUpdates,
    globalUpdates: runGlobalUpdates,
  }
}

/**
 * Merge a single script execution's writes into the run-level state: the live
 * `envVars` map (so later requests in this run resolve the new values) and the
 * persisted-delta accumulators. Called after both pre- and post-scripts.
 */
function mergeScriptUpdates(
  ctx: ScriptContext,
  envVars: Record<string, string>,
  runEnvUpdates: Record<string, string>,
  runGlobalUpdates: Record<string, string>,
): void {
  for (const [k, v] of Object.entries(ctx.envUpdates)) {
    envVars[k] = v
    runEnvUpdates[k] = v
  }
  for (const [k, v] of Object.entries(ctx.globalUpdates)) {
    envVars[k] = v
    runGlobalUpdates[k] = v
  }
  // varUpdates (pm.variables.set) propagate within the run only — into the
  // shared envVars so later requests resolve them, but NOT into runEnvUpdates,
  // so they never reach persistRunVariableUpdates / the DB.
  for (const [k, v] of Object.entries(ctx.varUpdates)) {
    if (v === '') delete envVars[k]
    else envVars[k] = v
  }
}

/**
 * Write the net variable deltas of a run back to the database: environment
 * writes go to the project's active environment, global writes to the project's
 * globals (creating rows that don't exist yet, updating the current `value`
 * column of those that do). Best-effort — a persistence failure must never fail
 * the run or lose the report, so everything is wrapped in try/catch.
 */
function persistRunVariableUpdates(
  environmentId: string | undefined,
  projectId: string,
  envUpdates: Record<string, string>,
  globalUpdates: Record<string, string>,
): void {
  // ── Active-environment variables ───────────────────────────────
  const envKeys = Object.keys(envUpdates)
  if (environmentId && envKeys.length > 0) {
    try {
      const byKey = new Map(envRepo.getVariablesByEnvironment(environmentId).map((r) => [r.key, r]))
      for (const key of envKeys) {
        const row = byKey.get(key)
        if (row) {
          envRepo.updateVariable(row.id, { value: envUpdates[key] })
        } else {
          envRepo.createVariable({ environment_id: environmentId, key, value: envUpdates[key] })
        }
      }
    } catch (e) {
      console.error('[runner] persist env variable updates failed:', (e as Error).message)
    }
  }

  // ── Project globals ────────────────────────────────────────────
  const globalKeys = Object.keys(globalUpdates)
  if (projectId && globalKeys.length > 0) {
    try {
      const byKey = new Map(envRepo.getGlobalVariablesByProject(projectId).map((r) => [r.key, r]))
      let workspaceId: string | undefined
      for (const key of globalKeys) {
        const row = byKey.get(key)
        if (row) {
          envRepo.updateGlobalVariable(row.id, { value: globalUpdates[key] })
        } else {
          // Creating a row needs the FK workspace_id — derive it once from the
          // project (the renderer scopes globals per-project, so we match that).
          if (workspaceId === undefined) {
            const proj = getDb()
              .prepare('SELECT workspace_id FROM projects WHERE id = ?')
              .get(projectId) as { workspace_id: string } | undefined
            workspaceId = proj?.workspace_id ?? ''
          }
          if (workspaceId) {
            envRepo.createGlobalVariable({
              workspace_id: workspaceId,
              project_id: projectId,
              key,
              value: globalUpdates[key],
            })
          }
        }
      }
    } catch (e) {
      console.error('[runner] persist global variable updates failed:', (e as Error).message)
    }
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
  const endpointsPassed = results.filter(endpointDidPass).length
  const endpointsFailed = results.length - endpointsPassed

  const escapeHtml = (str: string): string =>
    str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

  const rows = results
    .map((r) => {
      const didPass = endpointDidPass(r)
      const statusColor = r.error ? '#cc2200' : !didPass ? '#b35a00' : '#1a7a4a'
      const statusBg = r.error ? '#fff0f0' : !didPass ? '#fff4e0' : '#e8f9f1'
      const statusText = r.error ? 'Error' : !didPass ? 'Failed' : 'Passed'

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
