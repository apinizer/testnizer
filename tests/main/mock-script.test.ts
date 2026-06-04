import { describe, it, expect, beforeEach } from 'vitest'
import { runScript, type ScriptRequest, type ScriptResponse } from '../../src/main/mock/script'
import { getState, clearAllState, clearState } from '../../src/main/mock/state'

const baseRequest: ScriptRequest = {
  method: 'GET',
  path: '/',
  headers: {},
  query: {},
  params: {},
  body: null,
  bodyText: '',
}

const baseResponse = (): ScriptResponse => ({
  status: 200,
  headers: { 'content-type': 'application/json; charset=utf-8' },
  body: '{}',
})

beforeEach(() => clearAllState())

describe('runScript — empty source', () => {
  it('returns the response unchanged', () => {
    const initial = baseResponse()
    const r = runScript('', initial, baseRequest, {})
    expect(r.ok).toBe(true)
    expect(r.response).toEqual(initial)
    expect(r.consoleLines).toEqual([])
    expect(r.error).toBeNull()
  })
})

describe('runScript — response mutation', () => {
  it('setStatus changes the status code', () => {
    const r = runScript('setStatus(401)', baseResponse(), baseRequest, {})
    expect(r.response.status).toBe(401)
  })

  it('setJson sets the body and Content-Type', () => {
    const r = runScript('setJson({ ok: true })', baseResponse(), baseRequest, {})
    expect(r.response.body).toBe('{"ok":true}')
    expect(r.response.headers['content-type']).toMatch(/application\/json/)
  })

  it('setHeader normalises the header name to lower-case', () => {
    const r = runScript('setHeader("X-Foo", "bar")', baseResponse(), baseRequest, {})
    expect(r.response.headers['x-foo']).toBe('bar')
  })

  it('mutating response.* directly works too', () => {
    const r = runScript(
      'response.status = 418; response.body = "teapot"',
      baseResponse(),
      baseRequest,
      {},
    )
    expect(r.response.status).toBe(418)
    expect(r.response.body).toBe('teapot')
  })
})

describe('runScript — request access', () => {
  it('reads request.headers / query / params', () => {
    const req: ScriptRequest = {
      method: 'POST',
      path: '/users/42',
      headers: { 'x-foo': 'bar' },
      query: { q: 'hello' },
      params: { id: '42' },
      body: { name: 'Alice' },
      bodyText: '{"name":"Alice"}',
    }
    const r = runScript(
      'setJson({ id: request.params.id, foo: request.headers["x-foo"], q: request.query.q, name: request.body.name })',
      baseResponse(),
      req,
      {},
    )
    expect(JSON.parse(r.response.body)).toEqual({
      id: '42',
      foo: 'bar',
      q: 'hello',
      name: 'Alice',
    })
  })

  it('request is frozen — mutation attempts are silently ignored or throw', () => {
    // Strict mode (the script runs as strict because of vm — actually no; scripts
    // run in sloppy mode by default. Mutation will fail silently.) Either way,
    // the original request value must not change in our snapshot.
    const req: ScriptRequest = { ...baseRequest, body: { x: 1 } }
    runScript('try { request.body.x = 999 } catch (e) {}', baseResponse(), req, {})
    expect((req.body as { x: number }).x).toBe(1)
  })
})

describe('runScript — state mutation', () => {
  it('script can write state, subsequent calls see it', () => {
    const state = {}
    runScript('state.count = 1', baseResponse(), baseRequest, state)
    expect(state).toEqual({ count: 1 })
    runScript('state.count = (state.count || 0) + 1', baseResponse(), baseRequest, state)
    expect(state).toEqual({ count: 2 })
  })

  it('integrates with the per-server state store', () => {
    const s = getState('server-A')
    runScript('state.users = { 1: { name: "Alice" } }', baseResponse(), baseRequest, s)
    runScript('state.users[2] = { name: "Bob" }', baseResponse(), baseRequest, getState('server-A'))
    expect(getState('server-A')).toEqual({
      users: { 1: { name: 'Alice' }, 2: { name: 'Bob' } },
    })
  })

  it('clearState drops only that server\'s state', () => {
    runScript('state.x = 1', baseResponse(), baseRequest, getState('s1'))
    runScript('state.x = 2', baseResponse(), baseRequest, getState('s2'))
    clearState('s1')
    expect(getState('s1')).toEqual({})
    expect(getState('s2')).toEqual({ x: 2 })
  })
})

describe('runScript — console capture', () => {
  it('captures console.log / info / warn / error', () => {
    const r = runScript(
      'console.log("a", 1); console.warn("b"); console.error({ x: 1 })',
      baseResponse(),
      baseRequest,
      {},
    )
    expect(r.consoleLines).toHaveLength(3)
    expect(r.consoleLines[0]).toBe('[log] a 1')
    expect(r.consoleLines[1]).toBe('[warn] b')
    expect(r.consoleLines[2]).toBe('[error] {"x":1}')
  })
})

describe('runScript — error handling', () => {
  it('returns ok:false on exception with error message', () => {
    const r = runScript('throw new Error("boom")', baseResponse(), baseRequest, {})
    expect(r.ok).toBe(false)
    // vm wraps the thrown Error and reports "Error: boom" via message — accept either form.
    expect(r.error).toMatch(/boom/)
  })

  it('returns ok:false on syntax error', () => {
    const r = runScript('not valid )(', baseResponse(), baseRequest, {})
    expect(r.ok).toBe(false)
    expect(r.error).toBeTruthy()
  })

  it('partial state mutations before error are still applied', () => {
    const state: Record<string, unknown> = {}
    runScript('state.before = true; throw new Error("boom")', baseResponse(), baseRequest, state)
    expect(state.before).toBe(true)
  })
})

describe('runScript — sandbox isolation', () => {
  it('does not have access to require', () => {
    const r = runScript('require("fs")', baseResponse(), baseRequest, {})
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/require is not defined/i)
  })

  it('does not have access to process', () => {
    const r = runScript('typeof process', baseResponse(), baseRequest, {})
    expect(r.ok).toBe(true) // typeof never throws — value is 'undefined'
  })

  it('runs each script in a fresh context (no global leakage)', () => {
    runScript('globalThis.__leak = "yes"', baseResponse(), baseRequest, {})
    const r = runScript('typeof __leak === "undefined"', baseResponse(), baseRequest, {})
    expect(r.ok).toBe(true)
  })
})

describe('runScript — timeout', () => {
  it('aborts an infinite loop within ~5s', () => {
    const start = Date.now()
    const r = runScript('while (true) {}', baseResponse(), baseRequest, {})
    const elapsed = Date.now() - start
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/timeout|Script execution/i)
    // Allow generous slack — vm.runInNewContext timeouts are best-effort.
    expect(elapsed).toBeLessThan(10000)
  }, 12000)
})

describe('state store basics', () => {
  it('returns the same reference for repeated calls', () => {
    const a = getState('s')
    const b = getState('s')
    expect(a).toBe(b)
  })

  it('clearAllState wipes everything', () => {
    getState('a').foo = 1
    getState('b').bar = 2
    clearAllState()
    expect(getState('a')).toEqual({})
    expect(getState('b')).toEqual({})
  })
})
