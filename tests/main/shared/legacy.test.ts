/**
 * src/shared/script/legacy.ts — buildLegacyGlobals(ctx): the pre-`pm` sandbox
 * interface (postman.*, responseBody, responseCode, responseHeaders, tests,
 * xml2Json, environment/globals/data snapshots).
 */
import { describe, it, expect as vi } from 'vitest'
import { buildLegacyGlobals } from '../../../src/shared/script/legacy'
import { makeFakePm, json200 } from './helpers'

describe('buildLegacyGlobals — response snapshots (200 JSON)', () => {
  const fake = makeFakePm({ response: json200 })
  const { globals } = buildLegacyGlobals(fake.ctx)

  it('responseBody === normalized body', () => {
    vi(globals.responseBody).toBe(json200.body)
  })
  it('responseCode.code === 200 & .name === statusText', () => {
    const rc = globals.responseCode as { code: number; name: string; details: string }
    vi(rc.code).toBe(200)
    vi(rc.name).toBe('OK')
    vi(rc.details).toBe('OK')
  })
  it('responseHeaders is a plain copy', () => {
    vi(globals.responseHeaders).toEqual(json200.headers)
    // copy, not the same reference
    vi(globals.responseHeaders).not.toBe(json200.headers)
  })
  it('responseTime', () => {
    vi(globals.responseTime).toBe(json200.responseTime)
  })
  it('responseCookies', () => {
    vi(globals.responseCookies).toEqual(json200.cookies)
  })
})

describe('buildLegacyGlobals — pre-request scope (no response)', () => {
  it('omits response.* snapshots when normalizedResponse is null', () => {
    const fake = makeFakePm({ response: null })
    const { globals } = buildLegacyGlobals(fake.ctx)
    vi('responseBody' in globals).toBe(false)
    vi('responseCode' in globals).toBe(false)
    vi('responseHeaders' in globals).toBe(false)
  })
})

describe('buildLegacyGlobals — postman.* environment/global setters', () => {
  it('setEnvironmentVariable writes through pm.environment', () => {
    const fake = makeFakePm()
    const { globals } = buildLegacyGlobals(fake.ctx)
    const postman = globals.postman as { setEnvironmentVariable(k: string, v: unknown): void }
    postman.setEnvironmentVariable('token', 'xyz')
    vi(fake.pm.environment.get('token')).toBe('xyz')
  })
  it('getEnvironmentVariable reads from pm.environment', () => {
    const fake = makeFakePm({ envInit: { host: 'api.local' } })
    const { globals } = buildLegacyGlobals(fake.ctx)
    const postman = globals.postman as { getEnvironmentVariable(k: string): unknown }
    vi(postman.getEnvironmentVariable('host')).toBe('api.local')
  })
  it('clearEnvironmentVariable / clearEnvironmentVariables', () => {
    const fake = makeFakePm({ envInit: { a: '1', b: '2' } })
    const { globals } = buildLegacyGlobals(fake.ctx)
    const postman = globals.postman as {
      clearEnvironmentVariable(k: string): void
      clearEnvironmentVariables(): void
    }
    postman.clearEnvironmentVariable('a')
    vi(fake.pm.environment.has('a')).toBe(false)
    vi(fake.pm.environment.has('b')).toBe(true)
    postman.clearEnvironmentVariables()
    vi(fake.pm.environment.has('b')).toBe(false)
  })
  it('global setters/getters delegate to pm.globals', () => {
    const fake = makeFakePm()
    const { globals } = buildLegacyGlobals(fake.ctx)
    const postman = globals.postman as {
      setGlobalVariable(k: string, v: unknown): void
      getGlobalVariable(k: string): unknown
      clearGlobalVariable(k: string): void
    }
    postman.setGlobalVariable('g', 'G1')
    vi(fake.pm.globals.get('g')).toBe('G1')
    vi(postman.getGlobalVariable('g')).toBe('G1')
    postman.clearGlobalVariable('g')
    vi(fake.pm.globals.has('g')).toBe(false)
  })
})

describe('buildLegacyGlobals — postman.setNextRequest delegates', () => {
  it('forwards to pm.execution.setNextRequest', () => {
    const fake = makeFakePm()
    const { globals } = buildLegacyGlobals(fake.ctx)
    const postman = globals.postman as { setNextRequest(name: string | null): void }
    postman.setNextRequest('Login')
    vi(fake.nextRequest.value).toBe('Login')
    postman.setNextRequest(null)
    vi(fake.nextRequest.value).toBeNull()
  })
})

describe('buildLegacyGlobals — getResponseCookie / getResponseHeader', () => {
  it('getResponseCookie delegates to pm.cookies', () => {
    const fake = makeFakePm({ cookies: { session: 'S1' } })
    const { globals } = buildLegacyGlobals(fake.ctx)
    const postman = globals.postman as { getResponseCookie(name: string): unknown }
    vi(postman.getResponseCookie('session')).toBe('S1')
  })
  it('getResponseHeader delegates to pm.response.headers (case-insensitive)', () => {
    const fake = makeFakePm({ response: json200 })
    const { globals } = buildLegacyGlobals(fake.ctx)
    const postman = globals.postman as { getResponseHeader(name: string): unknown }
    vi(postman.getResponseHeader('content-type')).toBe('application/json')
  })
})

describe('buildLegacyGlobals — tests is the mutable collector', () => {
  it('the returned tests object is the same bound object scripts mutate', () => {
    const fake = makeFakePm()
    const { globals, tests } = buildLegacyGlobals(fake.ctx)
    vi(globals.tests).toBe(tests)
    ;(globals.tests as Record<string, boolean>)['status is 200'] = true
    vi(tests['status is 200']).toBe(true)
  })
})

describe('buildLegacyGlobals — variable & request snapshots', () => {
  it('environment / globals / data snapshots reflect scopes', () => {
    const fake = makeFakePm({
      envInit: { e: 'E' },
      globalsInit: { g: 'G' },
      iterationData: { d: 'D' },
    })
    const { globals } = buildLegacyGlobals(fake.ctx)
    vi(globals.environment).toEqual({ e: 'E' })
    vi(globals.globals).toEqual({ g: 'G' })
    vi(globals.data).toEqual({ d: 'D' })
  })
  it('request snapshot mirrors pm.request', () => {
    const fake = makeFakePm({
      request: {
        method: 'POST',
        url: 'https://x/y',
        name: 'Create',
        id: 'rq9',
        headers: { A: '1' },
      },
    })
    const { globals } = buildLegacyGlobals(fake.ctx)
    const req = globals.request as {
      method: string
      url: string
      name: string
      id: string
      headers: unknown
    }
    vi(req.method).toBe('POST')
    vi(req.url).toBe('https://x/y')
    vi(req.name).toBe('Create')
    vi(req.id).toBe('rq9')
    vi(req.headers).toEqual({ A: '1' })
  })
})

describe('buildLegacyGlobals — xml2Json', () => {
  it('parses XML synchronously into an object', () => {
    const fake = makeFakePm()
    const { globals } = buildLegacyGlobals(fake.ctx)
    const xml2Json = globals.xml2Json as (xml: string) => unknown
    const out = xml2Json('<a><b>1</b></a>') as { a: { b: string } }
    vi(out.a.b).toBe('1')
  })
})
