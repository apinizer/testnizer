// src/renderer/lib/test-runner.ts
// Testnizer — Test Runner (renderer process library)

import CryptoJS from 'crypto-js'
import type { TestAssertion, TestResult, ApiResponse, ConsoleLog } from '../types'

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

interface PmTestResult {
  name: string
  passed: boolean
  error?: string
}

interface AssertionChain {
  to: ToChain
}

interface ToChain {
  equal(expected: unknown): void
  not: NotChain
  be: BeChain
  include(value: unknown): void
  have: HaveChain
}

interface NotChain {
  equal(expected: unknown): void
}

interface BeChain {
  a(type: string): BeChain
  an(type: string): BeChain
  above(n: number): BeChain
  below(n: number): BeChain
  oneOf(values: unknown[]): void
  lengthOf(n: number): BeChain
  // Chai BDD fluent connectors — self-return getters keep the chain alive.
  that: BeChain
  which: BeChain
  is: BeChain
  with: BeChain
  and: BeChain
  // Terminal assertions (getters so callers write `.empty` not `.empty()`).
  empty: void
  true: void
  false: void
  null: void
  undefined: void
}

interface HaveChain {
  length(n: number): void
  lengthOf(n: number): void
  property(name: string): void
}

interface ResponseHaveChain {
  status(code: number): void
  header(name: string, value?: string): void
  jsonBody(path?: string): void
  body(expected?: string): void
}

interface ResponseBeChain {
  ok: void
  accepted: void
  badRequest: void
  unauthorized: void
  forbidden: void
  notFound: void
  error: void
}

interface ResponseToChain {
  have: ResponseHaveChain
  be: ResponseBeChain
  not: { have: ResponseHaveChain; be: ResponseBeChain }
}

/**
 * Case-insensitive header collection backing pm.request.headers. Postman
 * scripts expect HTTP header names to behave per RFC 7230 (case-insensitive),
 * so a plain Record produces ghost duplicates like {"Content-Type": "",
 * "content-type": "multipart/..."} when the engine writes a header that the
 * user already typed in a different case (Mehmet BUG-03). We key the internal
 * store by lowercased name but preserve the original casing for iteration and
 * the engine handoff.
 */
export interface HeaderEntry {
  key: string
  value: string
}

export class HeaderCollection {
  private store: Map<string, HeaderEntry> = new Map()

  constructor(initial?: HeaderEntry[] | Record<string, string>) {
    if (!initial) return
    if (Array.isArray(initial)) {
      for (const h of initial) {
        if (h && h.key) this.upsert(h)
      }
    } else {
      for (const [k, v] of Object.entries(initial)) {
        if (k) this.upsert({ key: k, value: v })
      }
    }
  }

  get(name: string): string | undefined {
    return this.store.get(name.toLowerCase())?.value
  }

  has(name: string): boolean {
    return this.store.has(name.toLowerCase())
  }

  add(h: HeaderEntry): void {
    // Postman semantics: add overwrites if present (its HeaderList allows
    // duplicates but most scripts use it interchangeably with upsert). We
    // pick upsert behaviour to stay aligned with case-insensitive single-
    // value HTTP header expectations on the wire.
    this.upsert(h)
  }

  upsert(h: HeaderEntry): void {
    if (!h || !h.key) return
    this.store.set(h.key.toLowerCase(), { key: h.key, value: h.value ?? '' })
  }

  remove(name: string): void {
    this.store.delete(name.toLowerCase())
  }

  each(fn: (h: HeaderEntry) => void): void {
    for (const entry of this.store.values()) fn(entry)
  }

  toArray(): HeaderEntry[] {
    return Array.from(this.store.values())
  }

  toJSON(): Record<string, string> {
    const out: Record<string, string> = {}
    for (const entry of this.store.values()) out[entry.key] = entry.value
    return out
  }
}

export interface PmRequestInput {
  method: string
  url: string
  headers: HeaderEntry[] | Record<string, string>
}

export interface PmApi {
  response: {
    code: number
    status: string
    json(): unknown
    text(): string
    headers: {
      get(name: string): string | undefined
    }
    cookies: {
      get(name: string): string | undefined
      has(name: string): boolean
      toObject(): Record<string, string>
    }
    responseTime: number
    responseSize: number
    to: ResponseToChain
  }
  request: {
    method: string
    url: string
    headers: HeaderCollection
  }
  execution: {
    /** Mark the current request to be skipped. Pre-request only. */
    skipRequest(): void
  }
  environment: {
    set(key: string, value: string): void
    get(key: string): string | undefined
    has(key: string): boolean
    unset(key: string): void
    toObject(): Record<string, string>
  }
  globals: {
    set(key: string, value: string): void
    get(key: string): string | undefined
    has(key: string): boolean
    unset(key: string): void
    toObject(): Record<string, string>
  }
  collectionVariables: {
    set(key: string, value: string): void
    get(key: string): string | undefined
    has(key: string): boolean
    unset(key: string): void
    toObject(): Record<string, string>
  }
  variables: {
    set(key: string, value: string): void
    get(key: string): string | undefined
    has(key: string): boolean
    toObject(): Record<string, string>
  }
  info: {
    eventName: string
    requestName: string
  }
  expect(value: unknown): AssertionChain
  test(name: string, fn: () => void): void
  /** Fire an auxiliary HTTP request mid-script (Postman-compatible). Accepts a
   *  URL string or a request object; returns a Promise so scripts can
   *  `await pm.sendRequest(...)`, and also calls the optional Node-style
   *  callback. The host awaits all pending sends before finishing the run. */
  sendRequest(
    req: PmSendInput,
    cb?: (err: Error | null, res: PmSendResponse | null) => void,
  ): Promise<PmSendResponse>
  _testResults: PmTestResult[]
  _envUpdates: Map<string, string>
  _globalUpdates: Map<string, string>
  /** Promises returned from async `pm.test()` callbacks. Callers should
   *  `await Promise.allSettled(pm._pendingTests)` before reading
   *  `_testResults` so async failures aren't silently lost. */
  _pendingTests: Promise<void>[]
  /** In-flight `pm.sendRequest` promises. The host awaits these (before tests)
   *  so callback-style sends complete even when the script didn't `await`. */
  _pendingSends: Promise<unknown>[]
  /** Set by pm.execution.skipRequest() in a pre-request script — callers
   * (request.store) should abort the actual HTTP send when true. */
  _skipRequest: boolean
  /** Mutated by pm.request.headers.{add,upsert,remove} so callers can fold
   * the changes back into the outgoing request before it ships. */
  _requestHeaders: HeaderCollection
}

// ─── pm.sendRequest support ──────────────────────────────────────
// A request a script fires mid-execution — a URL string, or a Postman-style
// request object. Kept loose so imported Postman scripts pass their objects
// through unchanged.
export type PmSendInput =
  | string
  | {
      url?: string | { raw?: string }
      method?: string
      header?: Array<{ key: string; value: string; disabled?: boolean }> | Record<string, string>
      body?: string | { mode?: string; raw?: string; options?: { raw?: { language?: string } } }
    }

export interface PmSendResponse {
  code: number
  status: string
  responseTime: number
  json(): unknown
  text(): string
  headers: { get(name: string): string | undefined }
  cookies: {
    get(name: string): string | undefined
    has(name: string): boolean
    toObject(): Record<string, string>
  }
}

/** Normalize a pm.sendRequest input into the engine's request:send options. */
export function normalizePmSendInput(req: PmSendInput): {
  method: string
  url: string
  headers: Array<{ key: string; value: string; enabled: boolean }>
  body?: { type: string; content?: string }
} {
  if (typeof req === 'string') return { method: 'GET', url: req, headers: [] }
  const url = typeof req.url === 'string' ? req.url : (req.url?.raw ?? '')
  const method = (req.method ?? 'GET').toUpperCase()
  let headers: Array<{ key: string; value: string; enabled: boolean }> = []
  if (Array.isArray(req.header)) {
    headers = req.header.map((h) => ({ key: h.key, value: h.value, enabled: h.disabled !== true }))
  } else if (req.header && typeof req.header === 'object') {
    headers = Object.entries(req.header).map(([key, value]) => ({
      key,
      value: String(value),
      enabled: true,
    }))
  }
  let body: { type: string; content?: string } | undefined
  if (typeof req.body === 'string') {
    body = { type: 'text', content: req.body }
  } else if (req.body && req.body.mode === 'raw') {
    const isJson = req.body.options?.raw?.language === 'json'
    body = { type: isJson ? 'json' : 'text', content: req.body.raw ?? '' }
  }
  return { method, url, headers, body }
}

/** Wrap an engine ApiResponse-shaped object as a Postman `pm.sendRequest`
 *  response (code/status/json/text/headers/cookies). */
export function buildPmSendResponse(apiResp: {
  status?: number
  statusText?: string
  body?: string
  headers?: Record<string, string>
  cookies?: Array<{ name: string; value: string }>
  timing?: { total?: number }
}): PmSendResponse {
  const headers = apiResp.headers ?? {}
  const cookies = apiResp.cookies ?? []
  const body = apiResp.body ?? ''
  const findHeader = (name: string): string | undefined => {
    const lo = name.toLowerCase()
    const e = Object.entries(headers).find(([k]) => k.toLowerCase() === lo)
    return e ? e[1] : undefined
  }
  const findCookie = (name: string) =>
    cookies.find((c) => c.name.toLowerCase() === name.toLowerCase())
  return {
    code: apiResp.status ?? 0,
    status: apiResp.statusText ?? '',
    responseTime: apiResp.timing?.total ?? 0,
    text: () => body,
    json: () => {
      try {
        return JSON.parse(body)
      } catch {
        return null
      }
    },
    headers: { get: findHeader },
    cookies: {
      get: (n) => findCookie(n)?.value,
      has: (n) => !!findCookie(n),
      toObject: () => Object.fromEntries(cookies.map((c) => [c.name, c.value])),
    },
  }
}

export function createPmApi(
  response: ApiResponse,
  envVars: Map<string, string>,
  globalVars: Map<string, string>,
  meta?: {
    requestName?: string
    eventName?: 'prerequest' | 'test'
    /** Caller-typed request (method/url/headers) used to populate
     * pm.request when no real response.actualRequest is available yet
     * — pre-request scope. Mehmet BUG-01. */
    request?: PmRequestInput
  },
): PmApi {
  const testResults: PmTestResult[] = []
  const envUpdates = new Map<string, string>()
  const globalUpdates = new Map<string, string>()
  const localVars = new Map<string, string>()
  const pendingTests: Promise<void>[] = []
  const pendingSends: Promise<unknown>[] = []
  const isPreRequest = meta?.eventName === 'prerequest'
  let skipRequestFlag = false

  // Build the header collection from either the caller-provided pre-request
  // build OR the engine's actualRequest (post-response). Both routes feed into
  // the same case-insensitive HeaderCollection so script mutations propagate.
  const initialHeaders: HeaderEntry[] | Record<string, string> =
    meta?.request?.headers ?? response.actualRequest?.headers ?? {}
  const requestHeaders = new HeaderCollection(initialHeaders)
  const requestMethod = meta?.request?.method ?? response.actualRequest?.method ?? ''
  const requestUrl = meta?.request?.url ?? response.actualRequest?.url ?? ''

  // Build Chai-BDD style chain for pm.response.to.have.status() etc.
  function assertionError(msg: string): never {
    throw new Error(msg)
  }

  const responseHaveChain: ResponseHaveChain = {
    status(code: number): void {
      const actual = response.status ?? 0
      if (actual !== code)
        assertionError(`expected response to have status code ${code} but got ${actual}`)
    },
    header(name: string, value?: string): void {
      const headers = response.headers ?? {}
      const entry = Object.entries(headers).find(([k]) => k.toLowerCase() === name.toLowerCase())
      if (!entry) assertionError(`expected response to have header "${name}"`)
      if (value !== undefined && entry && entry[1] !== value) {
        assertionError(`expected header "${name}" to equal "${value}" but got "${entry[1]}"`)
      }
    },
    jsonBody(path?: string): void {
      let parsed: unknown
      try {
        parsed = JSON.parse(response.body ?? '')
      } catch {
        assertionError('expected response to have a JSON body')
        return
      }
      if (path) {
        const value = evaluateJsonPath(parsed, path)
        if (value === undefined) {
          assertionError(`expected response JSON to have path "${path}"`)
        }
      }
    },
    body(expected?: string): void {
      if (expected !== undefined && (response.body ?? '') !== expected) {
        assertionError(`expected body to equal "${expected}"`)
      }
    },
  }

  const responseBeChain: ResponseBeChain = {
    get ok() {
      const s = response.status ?? 0
      if (s < 200 || s >= 300) assertionError(`expected 2xx but got ${s}`)
      return undefined
    },
    get accepted() {
      if ((response.status ?? 0) !== 202) assertionError(`expected 202 but got ${response.status}`)
      return undefined
    },
    get badRequest() {
      if ((response.status ?? 0) !== 400) assertionError(`expected 400 but got ${response.status}`)
      return undefined
    },
    get unauthorized() {
      if ((response.status ?? 0) !== 401) assertionError(`expected 401 but got ${response.status}`)
      return undefined
    },
    get forbidden() {
      if ((response.status ?? 0) !== 403) assertionError(`expected 403 but got ${response.status}`)
      return undefined
    },
    get notFound() {
      if ((response.status ?? 0) !== 404) assertionError(`expected 404 but got ${response.status}`)
      return undefined
    },
    get error() {
      const s = response.status ?? 0
      if (s < 400) assertionError(`expected 4xx/5xx but got ${s}`)
      return undefined
    },
  }

  const responseNotHaveChain: ResponseHaveChain = {
    status(code: number): void {
      if ((response.status ?? 0) === code)
        assertionError(`expected response to not have status code ${code}`)
    },
    header(name: string): void {
      const headers = response.headers ?? {}
      const found = Object.keys(headers).some((k) => k.toLowerCase() === name.toLowerCase())
      if (found) assertionError(`expected response to not have header "${name}"`)
    },
    jsonBody(): void {
      try {
        JSON.parse(response.body ?? '')
        assertionError('expected response to not have a JSON body')
      } catch {
        /* good */
      }
    },
    body(expected?: string): void {
      if (expected !== undefined && (response.body ?? '') === expected) {
        assertionError(`expected body to not equal "${expected}"`)
      }
    },
  }

  const responseNotBeChain: ResponseBeChain = {
    get ok() {
      const s = response.status ?? 0
      if (s >= 200 && s < 300) assertionError(`expected not 2xx but got ${s}`)
      return undefined
    },
    get accepted() {
      if ((response.status ?? 0) === 202) assertionError('expected not 202')
      return undefined
    },
    get badRequest() {
      if ((response.status ?? 0) === 400) assertionError('expected not 400')
      return undefined
    },
    get unauthorized() {
      if ((response.status ?? 0) === 401) assertionError('expected not 401')
      return undefined
    },
    get forbidden() {
      if ((response.status ?? 0) === 403) assertionError('expected not 403')
      return undefined
    },
    get notFound() {
      if ((response.status ?? 0) === 404) assertionError('expected not 404')
      return undefined
    },
    get error() {
      const s = response.status ?? 0
      if (s >= 400) assertionError(`expected not 4xx/5xx but got ${s}`)
      return undefined
    },
  }

  const responseToChain: ResponseToChain = {
    have: responseHaveChain,
    be: responseBeChain,
    not: { have: responseNotHaveChain, be: responseNotBeChain },
  }

  const pmApi: PmApi = {
    response: {
      get code(): number {
        return response.status ?? 0
      },
      get status(): string {
        return response.statusText ?? ''
      },
      json(): unknown {
        try {
          return JSON.parse(response.body ?? '{}')
        } catch {
          return null
        }
      },
      text(): string {
        return response.body ?? ''
      },
      headers: {
        get(name: string): string | undefined {
          const lowerName = name.toLowerCase()
          const headers = response.headers ?? {}
          const entry = Object.entries(headers).find(([k]) => k.toLowerCase() === lowerName)
          return entry ? entry[1] : undefined
        },
      },
      // Read-access to the cookies the engine parsed from the response
      // Set-Cookie headers (case-insensitive). Mirrors the Runner's shim.
      cookies: {
        get(name: string): string | undefined {
          const lower = name.toLowerCase()
          return (response.cookies ?? []).find((c) => c.name.toLowerCase() === lower)?.value
        },
        has(name: string): boolean {
          const lower = name.toLowerCase()
          return (response.cookies ?? []).some((c) => c.name.toLowerCase() === lower)
        },
        toObject(): Record<string, string> {
          return Object.fromEntries((response.cookies ?? []).map((c) => [c.name, c.value]))
        },
      },
      get responseTime(): number {
        return response.timing.total
      },
      get responseSize(): number {
        return response.bodySize ?? 0
      },
      to: responseToChain,
    },
    request: {
      method: requestMethod,
      url: requestUrl,
      headers: requestHeaders,
    },
    execution: {
      skipRequest(): void {
        if (!isPreRequest) {
          throw new Error('pm.execution.skipRequest() is only available in pre-request scripts')
        }
        skipRequestFlag = true
        // Postman behaviour: skipRequest() aborts the pre-request script
        // synchronously — any code after it must not run. We throw a sentinel
        // error that the script wrapper recognises and swallows.
        throw new Error('__pm_skip_request_signal__')
      },
    },
    environment: {
      set(key: string, value: string): void {
        envVars.set(key, value)
        envUpdates.set(key, value)
      },
      get(key: string): string | undefined {
        return envVars.get(key)
      },
      has(key: string): boolean {
        return envVars.has(key)
      },
      unset(key: string): void {
        envVars.delete(key)
        // Empty-string marker tells the persistence layer to delete the row
        // rather than overwrite it. Matches collectionVariables.unset above.
        envUpdates.set(key, '')
      },
      toObject(): Record<string, string> {
        return Object.fromEntries(envVars)
      },
    },
    globals: {
      set(key: string, value: string): void {
        globalVars.set(key, value)
        globalUpdates.set(key, value)
      },
      get(key: string): string | undefined {
        return globalVars.get(key)
      },
      has(key: string): boolean {
        return globalVars.has(key)
      },
      unset(key: string): void {
        globalVars.delete(key)
        globalUpdates.set(key, '')
      },
      toObject(): Record<string, string> {
        return Object.fromEntries(globalVars)
      },
    },
    // Postman exposes `pm.collectionVariables` for collection-scoped vars.
    // Testnizer persists imported Postman collection variables as a per-project
    // environment (see importPostman in import-export.handler.ts), so the same
    // backing store powers both `pm.environment` and `pm.collectionVariables`.
    // Writes go through the env-update map so changes persist after the run.
    collectionVariables: {
      set(key: string, value: string): void {
        envVars.set(key, value)
        envUpdates.set(key, value)
      },
      get(key: string): string | undefined {
        return envVars.get(key)
      },
      has(key: string): boolean {
        return envVars.has(key)
      },
      unset(key: string): void {
        envVars.delete(key)
        envUpdates.set(key, '')
      },
      toObject(): Record<string, string> {
        return Object.fromEntries(envVars)
      },
    },
    variables: {
      set(key: string, value: string): void {
        localVars.set(key, value)
      },
      get(key: string): string | undefined {
        return localVars.get(key) ?? envVars.get(key) ?? globalVars.get(key)
      },
      has(key: string): boolean {
        return localVars.has(key) || envVars.has(key) || globalVars.has(key)
      },
      toObject(): Record<string, string> {
        // Merged view, local over env over global (matches get() precedence).
        return {
          ...Object.fromEntries(globalVars),
          ...Object.fromEntries(envVars),
          ...Object.fromEntries(localVars),
        }
      },
    },
    info: {
      eventName: meta?.eventName ?? 'test',
      requestName: meta?.requestName ?? '',
    },
    expect(value: unknown): AssertionChain {
      return createExpectChain(value)
    },
    test(name: string, fn: () => void | Promise<void>): void {
      try {
        const result = fn()
        if (result && typeof (result as Promise<void>).then === 'function') {
          // Async pm.test callbacks: register a placeholder result that will be
          // resolved when the promise settles. Callers can await
          // `pm._pendingTests` (see PmApi) to wait for completion.
          const idx = testResults.length
          testResults.push({ name, passed: true })
          const pending = (result as Promise<void>).then(
            () => {
              // already optimistically passed; nothing to do.
            },
            (e: unknown) => {
              testResults[idx] = {
                name,
                passed: false,
                error: e instanceof Error ? e.message : String(e),
              }
            },
          )
          pendingTests.push(pending)
          return
        }
        testResults.push({ name, passed: true })
      } catch (e) {
        testResults.push({ name, passed: false, error: (e as Error).message })
      }
    },
    sendRequest(
      req: PmSendInput,
      cb?: (err: Error | null, res: PmSendResponse | null) => void,
    ): Promise<PmSendResponse> {
      // Fire a real auxiliary HTTP request through the main-process engine (the
      // renderer can't reach the network directly — CSP). Returns a Promise so
      // `await pm.sendRequest(...)` works, and also calls the Postman-style
      // callback. `runScript` awaits `_pendingSends`, so a callback-only send
      // still completes before the run finishes.
      const api = (
        typeof window !== 'undefined' ? (window as unknown as { api?: unknown }).api : undefined
      ) as
        | {
            request?: {
              send?: (o: unknown) => Promise<{ success: boolean; data?: unknown; error?: string }>
            }
          }
        | undefined
      const run = (async (): Promise<PmSendResponse> => {
        if (!api?.request?.send) {
          throw new Error('pm.sendRequest: request bridge unavailable in this context')
        }
        const result = await api.request.send(normalizePmSendInput(req))
        if (!result?.success || !result.data) {
          throw new Error(result?.error || 'pm.sendRequest failed')
        }
        return buildPmSendResponse(result.data as Parameters<typeof buildPmSendResponse>[0])
      })()
      const handled = run.then(
        (res) => {
          if (cb) cb(null, res)
          return res
        },
        (err: unknown) => {
          const e = err instanceof Error ? err : new Error(String(err))
          if (cb) {
            cb(e, null)
            return undefined as unknown as PmSendResponse
          }
          throw e
        },
      )
      // Track so the host awaits even the callback-only form; swallow here so
      // Promise.allSettled never sees a rejection we've already routed to `cb`.
      pendingSends.push(handled.catch(() => undefined))
      return handled
    },
    _testResults: testResults,
    _envUpdates: envUpdates,
    _globalUpdates: globalUpdates,
    _pendingTests: pendingTests,
    _pendingSends: pendingSends,
    get _skipRequest(): boolean {
      return skipRequestFlag
    },
    _requestHeaders: requestHeaders,
  }

  // Pre-request guard: any access to pm.response in a pre-request script is
  // almost certainly a user mistake — there's no response yet. Replace the
  // accessor so it throws a clear error instead of returning a phantom shell
  // that silently yields 0/"" everywhere (Mehmet BUG-07).
  if (isPreRequest) {
    Object.defineProperty(pmApi, 'response', {
      configurable: true,
      enumerable: true,
      get() {
        throw new Error(
          'pm.response is not available in pre-request scripts. Move this code to the Tests / Post-response tab.',
        )
      },
    })
  }

  return pmApi
}

function createExpectChain(value: unknown): AssertionChain {
  function assertionError(message: string): never {
    throw new Error(message)
  }

  function assertType(type: string): void {
    const lower = type.toLowerCase()
    if (lower === 'array') {
      if (!Array.isArray(value)) {
        assertionError(`Expected an array but got ${typeof value}`)
      }
      return
    }
    if (lower === 'null') {
      if (value !== null) assertionError(`Expected null but got ${String(value)}`)
      return
    }
    const actual = typeof value
    if (actual !== lower) {
      assertionError(`Expected type "${type}" but got "${actual}"`)
    }
  }

  function assertEmpty(): void {
    if (Array.isArray(value) || typeof value === 'string') {
      if ((value as { length: number }).length !== 0) {
        assertionError(
          `Expected empty ${Array.isArray(value) ? 'array' : 'string'} but got length ${String((value as { length: number }).length)}`,
        )
      }
      return
    }
    if (value && typeof value === 'object') {
      if (Object.keys(value as object).length !== 0) {
        assertionError(`Expected empty object but got ${Object.keys(value as object).length} keys`)
      }
      return
    }
    assertionError(`Expected empty value but got ${String(value)}`)
  }

  function assertLengthOf(n: number): void {
    const actual = (value as { length?: number } | null | undefined)?.length
    if (actual !== n) {
      assertionError(`Expected length ${n} but got ${String(actual)}`)
    }
  }

  const beChain = {
    a(type: string): BeChain {
      assertType(type)
      return beChain
    },
    an(type: string): BeChain {
      assertType(type)
      return beChain
    },
    above(n: number): BeChain {
      if (typeof value !== 'number' || value <= n) {
        assertionError(`Expected ${String(value)} to be above ${n}`)
      }
      return beChain
    },
    below(n: number): BeChain {
      if (typeof value !== 'number' || value >= n) {
        assertionError(`Expected ${String(value)} to be below ${n}`)
      }
      return beChain
    },
    oneOf(values: unknown[]): void {
      if (!Array.isArray(values) || !values.includes(value)) {
        assertionError(`Expected ${String(value)} to be one of [${values.map(String).join(', ')}]`)
      }
    },
    lengthOf(n: number): BeChain {
      assertLengthOf(n)
      return beChain
    },
    get that(): BeChain {
      return beChain
    },
    get which(): BeChain {
      return beChain
    },
    get is(): BeChain {
      return beChain
    },
    get with(): BeChain {
      return beChain
    },
    get and(): BeChain {
      return beChain
    },
    get empty() {
      assertEmpty()
      return undefined
    },
    get true() {
      if (value !== true) assertionError(`Expected true but got ${String(value)}`)
      return undefined
    },
    get false() {
      if (value !== false) assertionError(`Expected false but got ${String(value)}`)
      return undefined
    },
    get null() {
      if (value !== null) assertionError(`Expected null but got ${String(value)}`)
      return undefined
    },
    get undefined() {
      if (value !== undefined) assertionError(`Expected undefined but got ${String(value)}`)
      return undefined
    },
  } as BeChain

  const haveChain: HaveChain = {
    length(n: number): void {
      assertLengthOf(n)
    },
    lengthOf(n: number): void {
      assertLengthOf(n)
    },
    property(name: string): void {
      if (
        typeof value !== 'object' ||
        value === null ||
        !(name in (value as Record<string, unknown>))
      ) {
        assertionError(`Expected object to have property "${name}"`)
      }
    },
  }

  const notChain: NotChain = {
    equal(expected: unknown): void {
      if (value === expected) {
        assertionError(`Expected ${String(value)} to not equal ${String(expected)}`)
      }
    },
  }

  const toChain: ToChain = {
    equal(expected: unknown): void {
      if (value !== expected) {
        assertionError(`Expected ${String(expected)} but got ${String(value)}`)
      }
    },
    not: notChain,
    be: beChain,
    include(search: unknown): void {
      if (typeof value === 'string') {
        if (!value.includes(String(search))) {
          assertionError(`Expected "${value}" to include "${String(search)}"`)
        }
      } else if (Array.isArray(value)) {
        if (!value.includes(search)) {
          assertionError(`Expected array to include ${String(search)}`)
        }
      } else {
        assertionError(`Expected string or array but got ${typeof value}`)
      }
    },
    have: haveChain,
  }

  return { to: toChain }
}

// ─── Script Runner ───────────────────────────────────────────────

export interface ScriptRunResult {
  results: TestResult[]
  consoleLogs: ConsoleLog[]
  envUpdates: Record<string, string>
  globalUpdates: Record<string, string>
  /** Set by pm.execution.skipRequest() — callers should abort the actual HTTP
   * send when this is true (pre-request only). */
  skipRequest: boolean
  /** Headers AFTER any pm.request.headers.{add,upsert,remove} mutations so
   * callers can fold the mutations back into the outgoing request. */
  requestHeaders: HeaderEntry[]
}

export async function runScript(script: string, pmApi: PmApi): Promise<ScriptRunResult> {
  const consoleLogs: ConsoleLog[] = []

  // Create console capture
  const captureConsole = {
    log(...args: unknown[]): void {
      consoleLogs.push({
        level: 'log',
        message: args.map(String).join(' '),
        timestamp: Date.now(),
      })
    },
    warn(...args: unknown[]): void {
      consoleLogs.push({
        level: 'warn',
        message: args.map(String).join(' '),
        timestamp: Date.now(),
      })
    },
    error(...args: unknown[]): void {
      consoleLogs.push({
        level: 'error',
        message: args.map(String).join(' '),
        timestamp: Date.now(),
      })
    },
  }

  try {
    // `t` is a Testnizer-branded alias for `pm`. Both bind to the same API so
    // imported Postman scripts (which use `pm.*`) keep working unchanged, while
    // new Testnizer scripts can opt into the shorter `t.*` form. `insomnia` and
    // `bru` are likewise aliases so scripts imported from Insomnia v5
    // (`insomnia.environment.set(...)`) and Bruno run unchanged — without them
    // those scripts threw "insomnia is not defined", the catch swallowed it,
    // and the env write silently never happened (issue #12). CryptoJS is
    // exposed for HMAC / SHA / AES use cases (AWS sig v4, webhook signing) —
    // mirrors Postman's built-in (Mehmet BUG-05).
    // Run as an ASYNC function so scripts can `await pm.sendRequest(...)` and
    // use top-level await. A plain sync body still works unchanged (it just
    // resolves immediately). `AsyncFunction` is the standard runtime
    // constructor for `async function`.
    const AsyncFunction = Object.getPrototypeOf(async function () {})
      .constructor as FunctionConstructor
    const fn = new AsyncFunction('pm', 't', 'insomnia', 'bru', 'console', 'CryptoJS', script)
    await fn(pmApi, pmApi, pmApi, pmApi, captureConsole, CryptoJS)
  } catch (e) {
    const msg = (e as Error).message
    if (msg !== '__pm_skip_request_signal__') {
      consoleLogs.push({
        level: 'error',
        message: `Script error: ${msg}`,
        timestamp: Date.now(),
      })
    }
  }

  // Wait for any in-flight `pm.sendRequest(...)` calls to finish FIRST (their
  // callbacks may register pm.test cases), then for async `pm.test` callbacks
  // to settle — so every assertion lands in `_testResults` before we map them.
  if (pmApi._pendingSends.length > 0) {
    await Promise.allSettled(pmApi._pendingSends)
  }
  if (pmApi._pendingTests.length > 0) {
    await Promise.allSettled(pmApi._pendingTests)
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
  }))

  // Convert Map to Record
  const envUpdates: Record<string, string> = {}
  pmApi._envUpdates.forEach((val, key) => {
    envUpdates[key] = val
  })

  const globalUpdates: Record<string, string> = {}
  pmApi._globalUpdates.forEach((val, key) => {
    globalUpdates[key] = val
  })

  return {
    results,
    consoleLogs,
    envUpdates,
    globalUpdates,
    skipRequest: pmApi._skipRequest,
    requestHeaders: pmApi._requestHeaders.toArray(),
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
