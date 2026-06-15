/**
 * Minimal in-memory PmLike driver for the shared script-runtime suite.
 * No imports from src/main or src/renderer — the shared module must be
 * self-contained. A Map-backed PmScope plus fake info/request/execution/
 * cookies/test-sink, with `expect` and `createPmResponse` from the module.
 */
import { expect as moduleExpect } from '../../../src/shared/script/expect'
import { createPmResponse } from '../../../src/shared/script/response'
import type { NormalizedResponse } from '../../../src/shared/script/types'
import type { PmScope, PmLike, ScriptHostContext } from '../../../src/shared/script/pm-types'

/** Map-backed PmScope; replaceIn does {{k}} substitution from toObject(). */
export function makeScope(init: Record<string, unknown> = {}): PmScope {
  const m = new Map<string, unknown>(Object.entries(init))
  return {
    get: (k) => m.get(k),
    set: (k, v) => {
      m.set(k, v)
    },
    has: (k) => m.has(k),
    unset: (k) => {
      m.delete(k)
    },
    clear: () => {
      m.clear()
    },
    toObject: () => Object.fromEntries(m),
    replaceIn: (template) =>
      template.replace(/\{\{(\w+)\}\}/g, (_full, key) => {
        const v = m.get(key)
        return v === undefined ? '' : String(v)
      }),
  }
}

export interface TestSinkEntry {
  name: string
  passed: boolean
  error?: string
}

export interface FakePm {
  pm: PmLike
  ctx: ScriptHostContext
  /** Records of pm.test(name, fn) outcomes. */
  sink: TestSinkEntry[]
  /** Spy: last setNextRequest arg. */
  nextRequest: { value: string | null | undefined }
  /** Spy: sendRequest call log. */
  sentRequests: unknown[]
  env: PmScope & { name?: string }
  globals: PmScope
  collectionVariables: PmScope
  variables: PmScope
}

export interface FakePmOptions {
  /** Normalized response; pass null for a pre-request scope. */
  response?: NormalizedResponse | null
  envName?: string
  envInit?: Record<string, unknown>
  collectionInit?: Record<string, unknown>
  variablesInit?: Record<string, unknown>
  globalsInit?: Record<string, unknown>
  iterationData?: Record<string, unknown>
  request?: { method?: string; url?: unknown; headers?: unknown; id?: string; name?: string }
  cookies?: Record<string, string>
}

/** A 200 JSON response fixture used widely across the suite. */
export const json200: NormalizedResponse = {
  code: 200,
  statusText: 'OK',
  headers: { 'Content-Type': 'application/json', 'X-Trace': 'abc' },
  body: '{"id":1,"name":"Ada","tags":["x","y"]}',
  cookies: [{ name: 'sid', value: 'abc123' }],
  responseTime: 42,
  responseSize: 38,
}

export function makeFakePm(opts: FakePmOptions = {}): FakePm {
  const response = 'response' in opts ? opts.response : json200
  const env = makeScope(opts.envInit) as PmScope & { name?: string }
  env.name = opts.envName ?? 'Development'
  const globals = makeScope(opts.globalsInit)
  const collectionVariables = makeScope(opts.collectionInit)
  const variables = makeScope(opts.variablesInit)

  const sink: TestSinkEntry[] = []
  const nextRequest: { value: string | null | undefined } = { value: undefined }
  const sentRequests: unknown[] = []

  const iter = opts.iterationData ?? {}
  const cookieMap = opts.cookies ?? {}

  const pm: PmLike = {
    info: {
      eventName: 'test',
      iteration: 0,
      iterationCount: 1,
      requestName: opts.request?.name ?? 'Sample Request',
      requestId: opts.request?.id ?? 'req-1',
    },
    environment: env,
    globals,
    collectionVariables,
    variables,
    iterationData: {
      get: (k) => iter[k],
      has: (k) => k in iter,
      toObject: () => ({ ...iter }),
    },
    request: {
      method: opts.request?.method ?? 'GET',
      url: opts.request?.url ?? 'https://api.example.com/users',
      headers: opts.request?.headers ?? { Accept: 'application/json' },
      id: opts.request?.id ?? 'req-1',
      name: opts.request?.name ?? 'Sample Request',
    },
    response: response ? createPmResponse(response) : null,
    cookies: {
      get: (name) => cookieMap[name],
      has: (name) => name in cookieMap,
      toObject: () => ({ ...cookieMap }),
    },
    test: (name, fn) => {
      try {
        const out = fn()
        if (out && typeof (out as Promise<void>).then === 'function') {
          // Tests in this suite use sync fns only; record optimistic pass.
          sink.push({ name, passed: true })
          return
        }
        sink.push({ name, passed: true })
      } catch (e) {
        sink.push({ name, passed: false, error: (e as Error).message })
      }
    },
    expect: moduleExpect,
    sendRequest: async (input, cb) => {
      sentRequests.push(input)
      if (cb) cb(null, { stubbed: true })
      return { stubbed: true }
    },
    execution: {
      setNextRequest: (name) => {
        nextRequest.value = name
      },
      skipRequest: () => {},
    },
  }

  return {
    pm,
    ctx: { pm, normalizedResponse: response ?? null },
    sink,
    nextRequest,
    sentRequests,
    env,
    globals,
    collectionVariables,
    variables,
  }
}
