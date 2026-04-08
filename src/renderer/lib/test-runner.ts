// src/renderer/lib/test-runner.ts
// Apinizer API Tester — Test Runner (renderer process library)

import type {
  TestAssertion,
  TestResult,
  ApiResponse,
  ConsoleLog,
  KeyValuePair
} from '../types'

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

    const result = doc.evaluate(
      xpath,
      doc,
      null,
      XPathResult.STRING_TYPE,
      null
    )
    return result.stringValue || undefined
  } catch {
    return undefined
  }
}

// ─── Assertion Runner ────────────────────────────────────────────

export function runAssertions(
  assertions: TestAssertion[],
  response: ApiResponse
): TestResult[] {
  return assertions
    .filter((a) => a.enabled)
    .map((assertion) => evaluateAssertion(assertion, response))
}

function evaluateAssertion(
  assertion: TestAssertion,
  response: ApiResponse
): TestResult {
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
      case 'custom_script':
        return { assertion, passed: true, actual: 'script' }
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

function assertHeaderExists(assertion: TestAssertion, response: ApiResponse): TestResult {
  const headerName = (assertion.headerName ?? '').toLowerCase()
  const headers = response.headers ?? {}
  const found = Object.keys(headers).some((k) => k.toLowerCase() === headerName)
  return { assertion, passed: found, actual: found ? 'exists' : 'not found' }
}

function assertHeaderEquals(assertion: TestAssertion, response: ApiResponse): TestResult {
  const headerName = (assertion.headerName ?? '').toLowerCase()
  const headers = response.headers ?? {}
  const entry = Object.entries(headers).find(([k]) => k.toLowerCase() === headerName)
  const actual = entry ? entry[1] : ''
  const expected = String(assertion.expected ?? '')
  return { assertion, passed: actual === expected, actual }
}

function assertHeaderContains(assertion: TestAssertion, response: ApiResponse): TestResult {
  const headerName = (assertion.headerName ?? '').toLowerCase()
  const headers = response.headers ?? {}
  const entry = Object.entries(headers).find(([k]) => k.toLowerCase() === headerName)
  const actual = entry ? entry[1] : ''
  const expected = String(assertion.expected ?? '')
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
  a(type: string): void
  an(type: string): void
  above(n: number): void
  below(n: number): void
  true: void
  false: void
  null: void
  undefined: void
}

interface HaveChain {
  length(n: number): void
  property(name: string): void
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
    responseTime: number
    responseSize: number
  }
  request: {
    method: string
    url: string
    headers: Record<string, string>
  }
  environment: {
    set(key: string, value: string): void
    get(key: string): string | undefined
  }
  globals: {
    set(key: string, value: string): void
    get(key: string): string | undefined
  }
  variables: {
    set(key: string, value: string): void
    get(key: string): string | undefined
  }
  expect(value: unknown): AssertionChain
  test(name: string, fn: () => void): void
  _testResults: PmTestResult[]
  _envUpdates: Map<string, string>
  _globalUpdates: Map<string, string>
}

export function createPmApi(
  response: ApiResponse,
  envVars: Map<string, string>,
  globalVars: Map<string, string>
): PmApi {
  const testResults: PmTestResult[] = []
  const envUpdates = new Map<string, string>()
  const globalUpdates = new Map<string, string>()
  const localVars = new Map<string, string>()

  const pmApi: PmApi = {
    response: {
      get code(): number { return response.status ?? 0 },
      get status(): string { return response.statusText ?? '' },
      json(): unknown {
        try { return JSON.parse(response.body ?? '{}') }
        catch { return null }
      },
      text(): string { return response.body ?? '' },
      headers: {
        get(name: string): string | undefined {
          const lowerName = name.toLowerCase()
          const headers = response.headers ?? {}
          const entry = Object.entries(headers).find(([k]) => k.toLowerCase() === lowerName)
          return entry ? entry[1] : undefined
        }
      },
      get responseTime(): number { return response.timing.total },
      get responseSize(): number { return response.bodySize ?? 0 }
    },
    request: {
      method: response.actualRequest?.method ?? '',
      url: response.actualRequest?.url ?? '',
      headers: response.actualRequest?.headers ?? {}
    },
    environment: {
      set(key: string, value: string): void {
        envVars.set(key, value)
        envUpdates.set(key, value)
      },
      get(key: string): string | undefined {
        return envVars.get(key)
      }
    },
    globals: {
      set(key: string, value: string): void {
        globalVars.set(key, value)
        globalUpdates.set(key, value)
      },
      get(key: string): string | undefined {
        return globalVars.get(key)
      }
    },
    variables: {
      set(key: string, value: string): void {
        localVars.set(key, value)
      },
      get(key: string): string | undefined {
        return localVars.get(key) ?? envVars.get(key) ?? globalVars.get(key)
      }
    },
    expect(value: unknown): AssertionChain {
      return createExpectChain(value)
    },
    test(name: string, fn: () => void): void {
      try {
        fn()
        testResults.push({ name, passed: true })
      } catch (e) {
        testResults.push({ name, passed: false, error: (e as Error).message })
      }
    },
    _testResults: testResults,
    _envUpdates: envUpdates,
    _globalUpdates: globalUpdates
  }

  return pmApi
}

function createExpectChain(value: unknown): AssertionChain {
  function assertionError(message: string): never {
    throw new Error(message)
  }

  const beChain: BeChain = {
    a(type: string): void {
      const actual = typeof value
      if (actual !== type) {
        assertionError(`Expected type "${type}" but got "${actual}"`)
      }
    },
    an(type: string): void {
      this.a(type)
    },
    above(n: number): void {
      if (typeof value !== 'number' || value <= n) {
        assertionError(`Expected ${String(value)} to be above ${n}`)
      }
    },
    below(n: number): void {
      if (typeof value !== 'number' || value >= n) {
        assertionError(`Expected ${String(value)} to be below ${n}`)
      }
    },
    get true(): void {
      if (value !== true) assertionError(`Expected true but got ${String(value)}`)
    },
    get false(): void {
      if (value !== false) assertionError(`Expected false but got ${String(value)}`)
    },
    get null(): void {
      if (value !== null) assertionError(`Expected null but got ${String(value)}`)
    },
    get undefined(): void {
      if (value !== undefined) assertionError(`Expected undefined but got ${String(value)}`)
    }
  }

  const haveChain: HaveChain = {
    length(n: number): void {
      const actual = (value as string | unknown[])?.length
      if (actual !== n) {
        assertionError(`Expected length ${n} but got ${String(actual)}`)
      }
    },
    property(name: string): void {
      if (typeof value !== 'object' || value === null || !(name in (value as Record<string, unknown>))) {
        assertionError(`Expected object to have property "${name}"`)
      }
    }
  }

  const notChain: NotChain = {
    equal(expected: unknown): void {
      if (value === expected) {
        assertionError(`Expected ${String(value)} to not equal ${String(expected)}`)
      }
    }
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
    have: haveChain
  }

  return { to: toChain }
}

// ─── Script Runner ───────────────────────────────────────────────

export interface ScriptRunResult {
  results: TestResult[]
  consoleLogs: ConsoleLog[]
  envUpdates: Record<string, string>
  globalUpdates: Record<string, string>
}

export function runScript(
  script: string,
  pmApi: PmApi
): ScriptRunResult {
  const consoleLogs: ConsoleLog[] = []

  // Create console capture
  const captureConsole = {
    log(...args: unknown[]): void {
      consoleLogs.push({
        level: 'log',
        message: args.map(String).join(' '),
        timestamp: Date.now()
      })
    },
    warn(...args: unknown[]): void {
      consoleLogs.push({
        level: 'warn',
        message: args.map(String).join(' '),
        timestamp: Date.now()
      })
    },
    error(...args: unknown[]): void {
      consoleLogs.push({
        level: 'error',
        message: args.map(String).join(' '),
        timestamp: Date.now()
      })
    }
  }

  try {
    // Use new Function to create a sandboxed execution context
    const fn = new Function('pm', 'console', script)
    fn(pmApi, captureConsole)
  } catch (e) {
    consoleLogs.push({
      level: 'error',
      message: `Script error: ${(e as Error).message}`,
      timestamp: Date.now()
    })
  }

  // Convert pm test results to TestResult format
  const results: TestResult[] = pmApi._testResults.map((tr) => ({
    assertion: {
      id: `script-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name: tr.name,
      type: 'custom_script' as const,
      enabled: true
    },
    passed: tr.passed,
    error: tr.error
  }))

  // Convert Map to Record
  const envUpdates: Record<string, string> = {}
  pmApi._envUpdates.forEach((val, key) => { envUpdates[key] = val })

  const globalUpdates: Record<string, string> = {}
  pmApi._globalUpdates.forEach((val, key) => { globalUpdates[key] = val })

  return { results, consoleLogs, envUpdates, globalUpdates }
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
  extraction: ExtractionConfig
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
