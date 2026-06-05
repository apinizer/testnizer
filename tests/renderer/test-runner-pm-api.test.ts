// Comprehensive coverage for the pm.* scripting surface built by createPmApi()
// + executed by runScript() in src/renderer/lib/test-runner.ts — everything
// beyond the already-covered pm.test/pm.expect basics.
//
// Covered: pm.environment.{get,set,has,unset}, pm.globals.*,
// pm.collectionVariables.*, pm.variables.{get,set} (local + fallback chain),
// pm.response.{json,text,code,status,responseTime,responseSize,headers.get},
// pre-request env side effects surfaced via runScript().envUpdates,
// pm.execution.skipRequest(), pm.request.headers mutation, pm.info, and the
// pre-request pm.response guard.
//
// NOTE: the RENDERER pm surface intentionally has NO pm.iterationData — that
// lives only in the main-process runner (src/main/ipc/runner.handler.ts ->
// newScriptContext). See REPORT for the one-line reason.

import { describe, expect, it } from 'vitest'
import { createPmApi, runScript } from '../../src/renderer/lib/test-runner'
import type { ApiResponse } from '../../src/renderer/types'

// ─── Helpers ─────────────────────────────────────────────────────

function makeResponse(overrides: Partial<ApiResponse> = {}): ApiResponse {
  return {
    requestId: 'r-pm',
    protocol: 'http',
    status: 200,
    statusText: 'OK',
    headers: { 'Content-Type': 'application/json' },
    body: '{"hello":"world"}',
    bodySize: 17,
    timing: { total: 12 },
    ...overrides,
  }
}

function makePm(
  response: ApiResponse,
  env: Record<string, string> = {},
  globals: Record<string, string> = {},
  meta?: Parameters<typeof createPmApi>[3],
) {
  return createPmApi(
    response,
    new Map(Object.entries(env)),
    new Map(Object.entries(globals)),
    meta ?? { eventName: 'test', requestName: 'pm-api-test' },
  )
}

// ─── pm.environment ──────────────────────────────────────────────

describe('pm.environment', () => {
  it('get returns a seeded value and has() reflects presence', async () => {
    const pm = makePm(makeResponse(), { base: 'https://api.test' })
    const script = `
      pm.test('env-get', () => {
        pm.expect(pm.environment.get('base')).to.equal('https://api.test')
        pm.expect(pm.environment.has('base')).to.equal(true)
        pm.expect(pm.environment.has('nope')).to.equal(false)
      })`
    const out = await runScript(script, pm)
    expect(out.results[0].passed).toBe(true)
  })

  it('set is captured in envUpdates returned by runScript', async () => {
    const pm = makePm(makeResponse())
    const out = await runScript(`pm.environment.set('token', 'abc-123')`, pm)
    expect(out.envUpdates).toEqual({ token: 'abc-123' })
  })

  it('a value set earlier in the same script is readable by later code', async () => {
    const pm = makePm(makeResponse())
    const script = `
      pm.environment.set('t', '1')
      pm.test('readback', () => {
        pm.expect(pm.environment.get('t')).to.equal('1')
      })`
    const out = await runScript(script, pm)
    expect(out.results[0].passed).toBe(true)
    expect(out.envUpdates).toEqual({ t: '1' })
  })

  it('unset records an empty-string deletion marker in envUpdates', async () => {
    const pm = makePm(makeResponse(), { stale: 'old' })
    const out = await runScript(`pm.environment.unset('stale')`, pm)
    expect(out.envUpdates).toEqual({ stale: '' })
  })
})

// ─── pm.globals ──────────────────────────────────────────────────

describe('pm.globals', () => {
  it('get/has read the seeded global map', async () => {
    const pm = makePm(makeResponse(), {}, { gKey: 'gVal' })
    const script = `
      pm.test('globals-get', () => {
        pm.expect(pm.globals.get('gKey')).to.equal('gVal')
        pm.expect(pm.globals.has('gKey')).to.equal(true)
      })`
    const out = await runScript(script, pm)
    expect(out.results[0].passed).toBe(true)
  })

  it('set is captured in globalUpdates (separate from envUpdates)', async () => {
    const pm = makePm(makeResponse())
    const out = await runScript(`pm.globals.set('flag', 'on')`, pm)
    expect(out.globalUpdates).toEqual({ flag: 'on' })
    expect(out.envUpdates).toEqual({})
  })

  it('unset records the empty-string deletion marker in globalUpdates', async () => {
    const pm = makePm(makeResponse(), {}, { g: 'x' })
    const out = await runScript(`pm.globals.unset('g')`, pm)
    expect(out.globalUpdates).toEqual({ g: '' })
  })
})

// ─── pm.collectionVariables ──────────────────────────────────────

describe('pm.collectionVariables', () => {
  it('shares the env backing store: set surfaces in envUpdates and env.get reads it', async () => {
    const pm = makePm(makeResponse())
    const script = `
      pm.collectionVariables.set('cv', 'val')
      pm.test('cv', () => {
        pm.expect(pm.collectionVariables.get('cv')).to.equal('val')
        pm.expect(pm.environment.get('cv')).to.equal('val')
      })`
    const out = await runScript(script, pm)
    expect(out.results[0].passed).toBe(true)
    expect(out.envUpdates).toEqual({ cv: 'val' })
  })
})

// ─── pm.variables (local + fallback chain) ───────────────────────

describe('pm.variables', () => {
  it('set/get round-trips a local variable WITHOUT touching env/global updates', async () => {
    const pm = makePm(makeResponse())
    const script = `
      pm.variables.set('local', 'L')
      pm.test('local', () => {
        pm.expect(pm.variables.get('local')).to.equal('L')
      })`
    const out = await runScript(script, pm)
    expect(out.results[0].passed).toBe(true)
    // local vars are script-scoped only — not persisted.
    expect(out.envUpdates).toEqual({})
    expect(out.globalUpdates).toEqual({})
  })

  it('get falls back to env then global when no local var exists', async () => {
    const pm = makePm(makeResponse(), { fromEnv: 'E' }, { fromGlobal: 'G' })
    const script = `
      pm.test('fallback', () => {
        pm.expect(pm.variables.get('fromEnv')).to.equal('E')
        pm.expect(pm.variables.get('fromGlobal')).to.equal('G')
        pm.expect(pm.variables.get('missing')).to.equal(undefined)
      })`
    const out = await runScript(script, pm)
    expect(out.results[0].passed).toBe(true)
  })

  it('a local var shadows an env var of the same name', async () => {
    const pm = makePm(makeResponse(), { dup: 'env-value' })
    const script = `
      pm.variables.set('dup', 'local-value')
      pm.test('shadow', () => {
        pm.expect(pm.variables.get('dup')).to.equal('local-value')
      })`
    const out = await runScript(script, pm)
    expect(out.results[0].passed).toBe(true)
  })
})

// ─── pm.response ─────────────────────────────────────────────────

describe('pm.response', () => {
  it('code/status reflect status + statusText', async () => {
    const pm = makePm(makeResponse({ status: 201, statusText: 'Created' }))
    const script = `
      pm.test('code', () => {
        pm.expect(pm.response.code).to.equal(201)
        pm.expect(pm.response.status).to.equal('Created')
      })`
    const out = await runScript(script, pm)
    expect(out.results[0].passed).toBe(true)
  })

  it('json() parses the body, text() returns it raw', async () => {
    const pm = makePm(makeResponse({ body: '{"id":7,"name":"Ada"}' }))
    const script = `
      pm.test('json', () => {
        var j = pm.response.json()
        pm.expect(j.id).to.equal(7)
        pm.expect(j.name).to.equal('Ada')
        pm.expect(pm.response.text()).to.equal('{"id":7,"name":"Ada"}')
      })`
    const out = await runScript(script, pm)
    expect(out.results[0].passed).toBe(true)
  })

  it('json() returns null when the body is not valid JSON', async () => {
    const pm = makePm(makeResponse({ body: 'plain text' }))
    const script = `
      pm.test('json-null', () => {
        pm.expect(pm.response.json()).to.equal(null)
      })`
    const out = await runScript(script, pm)
    expect(out.results[0].passed).toBe(true)
  })

  it('headers.get does a case-insensitive lookup', async () => {
    const pm = makePm(makeResponse({ headers: { 'Content-Type': 'application/json' } }))
    const script = `
      pm.test('hdr', () => {
        pm.expect(pm.response.headers.get('content-type')).to.equal('application/json')
        pm.expect(pm.response.headers.get('x-missing')).to.equal(undefined)
      })`
    const out = await runScript(script, pm)
    expect(out.results[0].passed).toBe(true)
  })

  it('responseTime and responseSize expose timing.total and bodySize', async () => {
    const pm = makePm(makeResponse({ timing: { total: 42 }, bodySize: 999 }))
    const script = `
      pm.test('timing', () => {
        pm.expect(pm.response.responseTime).to.equal(42)
        pm.expect(pm.response.responseSize).to.equal(999)
      })`
    const out = await runScript(script, pm)
    expect(out.results[0].passed).toBe(true)
  })

  it('pm.response.to.have.status / be.ok fluent chain works', async () => {
    const pm = makePm(makeResponse({ status: 200 }))
    const script = `
      pm.test('chain', () => {
        pm.response.to.have.status(200)
        pm.response.to.be.ok
        pm.response.to.have.header('Content-Type')
      })`
    const out = await runScript(script, pm)
    expect(out.results[0].passed).toBe(true)
  })
})

// ─── pre-request script side effects ─────────────────────────────

describe('pre-request scripts', () => {
  it('pm.environment.set in a pre-request script surfaces in envUpdates', async () => {
    const pm = makePm(makeResponse(), {}, {}, { eventName: 'prerequest', requestName: 'pre' })
    const out = await runScript(`pm.environment.set('t', '1')`, pm)
    expect(out.envUpdates).toEqual({ t: '1' })
    // env updates from the pre-request stage are what request.store folds back
    // into the variable space for the subsequent request + its assertions.
  })

  it('pm.execution.skipRequest() aborts the script and sets skipRequest', async () => {
    const pm = makePm(makeResponse(), {}, {}, { eventName: 'prerequest', requestName: 'pre' })
    const script = `
      pm.environment.set('before', 'yes')
      pm.execution.skipRequest()
      pm.environment.set('after', 'should-not-run')`
    const out = await runScript(script, pm)
    expect(out.skipRequest).toBe(true)
    // Code before skipRequest ran; code after did not (sentinel throw).
    expect(out.envUpdates).toEqual({ before: 'yes' })
    // The sentinel error must be swallowed — no "Script error" console log.
    expect(out.consoleLogs.some((l) => l.level === 'error')).toBe(false)
  })

  it('accessing pm.response in a pre-request script throws a clear error', async () => {
    const pm = makePm(makeResponse(), {}, {}, { eventName: 'prerequest', requestName: 'pre' })
    const out = await runScript(`var c = pm.response.code`, pm)
    // The guard throws; runScript captures it as an error console log.
    const errLog = out.consoleLogs.find((l) => l.level === 'error')
    expect(errLog).toBeDefined()
    expect(errLog?.message).toMatch(/pm\.response is not available in pre-request scripts/)
  })

  it('pm.info exposes eventName and requestName', async () => {
    const pm = makePm(makeResponse(), {}, {}, {
      eventName: 'prerequest',
      requestName: 'Login Request',
    })
    const out = await runScript(
      `pm.environment.set('en', pm.info.eventName); pm.environment.set('rn', pm.info.requestName)`,
      pm,
    )
    expect(out.envUpdates).toEqual({ en: 'prerequest', rn: 'Login Request' })
  })
})

// ─── pm.request.headers mutation ─────────────────────────────────

describe('pm.request.headers', () => {
  it('upsert is case-insensitive and surfaces in runScript().requestHeaders', async () => {
    const pm = makePm(makeResponse(), {}, {}, {
      eventName: 'prerequest',
      requestName: 'pre',
      request: {
        method: 'POST',
        url: 'https://api.test/login',
        headers: { 'Content-Type': 'text/plain' },
      },
    })
    const script = `
      // overwrite an existing header (different case) + add a new one
      pm.request.headers.upsert({ key: 'content-type', value: 'application/json' })
      pm.request.headers.add({ key: 'X-Trace', value: 't-1' })`
    const out = await runScript(script, pm)
    const asMap = Object.fromEntries(out.requestHeaders.map((h) => [h.key.toLowerCase(), h.value]))
    // no ghost duplicate — single case-folded content-type with the new value.
    expect(asMap['content-type']).toBe('application/json')
    expect(asMap['x-trace']).toBe('t-1')
    expect(out.requestHeaders.filter((h) => h.key.toLowerCase() === 'content-type')).toHaveLength(1)
  })

  it('remove deletes a header and get/has reflect mutations mid-script', async () => {
    const pm = makePm(makeResponse(), {}, {}, {
      eventName: 'prerequest',
      requestName: 'pre',
      request: {
        method: 'GET',
        url: 'https://api.test',
        headers: { Authorization: 'Bearer old', 'X-Drop': '1' },
      },
    })
    const script = `
      pm.request.headers.remove('x-drop')
      pm.test('hdr-state', () => {
        pm.expect(pm.request.headers.has('x-drop')).to.equal(false)
        pm.expect(pm.request.headers.get('authorization')).to.equal('Bearer old')
      })`
    const out = await runScript(script, pm)
    expect(out.results[0].passed).toBe(true)
    const keys = out.requestHeaders.map((h) => h.key.toLowerCase())
    expect(keys).toContain('authorization')
    expect(keys).not.toContain('x-drop')
  })

  it('pm.request.method and url reflect the caller-provided request', async () => {
    const pm = makePm(makeResponse(), {}, {}, {
      eventName: 'prerequest',
      requestName: 'pre',
      request: { method: 'PUT', url: 'https://api.test/item/9', headers: {} },
    })
    const out = await runScript(
      `pm.environment.set('m', pm.request.method); pm.environment.set('u', pm.request.url)`,
      pm,
    )
    expect(out.envUpdates).toEqual({ m: 'PUT', u: 'https://api.test/item/9' })
  })
})

// ─── runScript plumbing ──────────────────────────────────────────

describe('runScript plumbing', () => {
  it('captures console.log/warn/error into consoleLogs', async () => {
    const pm = makePm(makeResponse())
    const out = await runScript(
      `console.log('hi', 1); console.warn('careful'); console.error('boom')`,
      pm,
    )
    const byLevel = out.consoleLogs.reduce<Record<string, string[]>>((acc, l) => {
      ;(acc[l.level] ??= []).push(l.message)
      return acc
    }, {})
    expect(byLevel.log).toContain('hi 1')
    expect(byLevel.warn).toContain('careful')
    expect(byLevel.error).toContain('boom')
  })

  it('the `t` alias binds to the same pm API', async () => {
    const pm = makePm(makeResponse({ status: 200 }))
    const out = await runScript(
      `t.test('via-t-alias', () => { t.expect(t.response.code).to.equal(200) })`,
      pm,
    )
    expect(out.results[0].passed).toBe(true)
    expect(out.results[0].assertion.name).toBe('via-t-alias')
  })

  it('an uncaught script error is recorded but does not throw', async () => {
    const pm = makePm(makeResponse())
    const out = await runScript(`throw new Error('kaboom')`, pm)
    const err = out.consoleLogs.find((l) => l.level === 'error')
    expect(err?.message).toMatch(/Script error: kaboom/)
    expect(out.results).toHaveLength(0)
  })
})
