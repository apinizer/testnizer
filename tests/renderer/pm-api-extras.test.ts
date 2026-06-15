/**
 * Coverage for the pm API surface completed in v1.4.18:
 *   - pm.{environment,globals,collectionVariables,variables}.toObject()
 *   - pm.response.cookies.{get,has,toObject}
 *   - CryptoJS global binding in the Send (renderer) script runtime
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { createPmApi, runScript } from '../../src/renderer/lib/test-runner'
import type { ApiResponse } from '../../src/renderer/types'

function resp(over: Partial<ApiResponse> = {}): ApiResponse {
  return {
    requestId: 'r1',
    protocol: 'http',
    status: 200,
    statusText: 'OK',
    headers: {},
    body: '{}',
    timing: { total: 5 },
    ...over,
  } as ApiResponse
}

describe('pm.*.toObject()', () => {
  it('environment/globals/collectionVariables/variables snapshot the resolved maps', () => {
    const env = new Map([
      ['a', '1'],
      ['b', '2'],
    ])
    const globals = new Map([['g', '9']])
    const pm = createPmApi(resp(), env, globals, { eventName: 'test' })
    expect(pm.environment.toObject()).toEqual({ a: '1', b: '2' })
    expect(pm.globals.toObject()).toEqual({ g: '9' })
    expect(pm.collectionVariables.toObject()).toEqual({ a: '1', b: '2' })
    // variables = merged view (env over global here)
    expect(pm.variables.toObject()).toEqual({ a: '1', b: '2', g: '9' })
    expect(pm.environment.has('a')).toBe(true)
    expect(pm.environment.has('zzz')).toBe(false)
  })
})

describe('pm.response.cookies', () => {
  it('reads cookies the engine parsed (case-insensitive)', () => {
    const pm = createPmApi(
      resp({ cookies: [{ name: 'session', value: 'abc123' }] }),
      new Map(),
      new Map(),
      { eventName: 'test' },
    )
    expect(pm.response.cookies.get('session')).toBe('abc123')
    expect(pm.response.cookies.get('SESSION')).toBe('abc123')
    expect(pm.response.cookies.has('session')).toBe(true)
    expect(pm.response.cookies.has('missing')).toBe(false)
    expect(pm.response.cookies.toObject()).toEqual({ session: 'abc123' })
  })

  it('is empty (not throwing) when the response set no cookies', () => {
    const pm = createPmApi(resp(), new Map(), new Map(), { eventName: 'test' })
    expect(pm.response.cookies.get('x')).toBeUndefined()
    expect(pm.response.cookies.toObject()).toEqual({})
  })
})

describe('Send script runtime — CryptoJS + toObject usable from a real script', () => {
  it('CryptoJS is bound and a script can capture a cookie + sign it', async () => {
    const pm = createPmApi(
      resp({ cookies: [{ name: 'csrf', value: 'tok' }] }),
      new Map([['secret', 's3cr3t']]),
      new Map(),
      { eventName: 'test' },
    )
    const out = await runScript(
      `
        const csrf = pm.response.cookies.get('csrf')
        const sig = CryptoJS.HmacSHA256(csrf, pm.environment.get('secret')).toString()
        pm.environment.set('csrfSig', sig)
        pm.test('signed', function () { pm.expect(sig).to.be.a('string') })
      `,
      pm,
    )
    expect(out.results.find((r) => r.assertion.name === 'signed')?.passed).toBe(true)
    expect(out.envUpdates.csrfSig).toBeTruthy()
    expect(out.envUpdates.csrfSig.length).toBe(64) // hex sha256
  })
})

describe('pm.sendRequest (Send path)', () => {
  afterEach(() => {
    delete (window as unknown as { api?: unknown }).api
  })

  it('awaits an auxiliary request via window.api.request.send and exposes res.json()', async () => {
    const send = vi.fn(async () => ({
      success: true,
      data: { status: 200, statusText: 'OK', body: '{"tok":"XYZ"}', headers: {}, timing: { total: 1 } },
    }))
    ;(window as unknown as { api: unknown }).api = { request: { send } }
    const pm = createPmApi(resp(), new Map(), new Map(), { eventName: 'test' })
    const out = await runScript(
      `
        const r = await pm.sendRequest('https://auth/token')
        pm.environment.set('tok', r.json().tok)
        pm.test('got token', function () { pm.expect(r.code).to.equal(200) })
      `,
      pm,
    )
    expect(send).toHaveBeenCalledTimes(1)
    expect(out.envUpdates.tok).toBe('XYZ')
    expect(out.results.find((r) => r.assertion.name === 'got token')?.passed).toBe(true)
  })

  it('callback form completes even without await (host awaits pending sends)', async () => {
    const send = vi.fn(async () => ({
      success: true,
      data: { status: 201, statusText: 'Created', body: '{}', headers: {}, timing: { total: 1 } },
    }))
    ;(window as unknown as { api: unknown }).api = { request: { send } }
    const pm = createPmApi(resp(), new Map(), new Map(), { eventName: 'test' })
    const out = await runScript(
      `
        pm.sendRequest({ url: 'https://x', method: 'POST' }, function (err, res) {
          pm.environment.set('code', String(res.code))
        })
      `,
      pm,
    )
    expect(out.envUpdates.code).toBe('201')
  })

  it('rejects (await throws) when the request bridge is unavailable', async () => {
    const pm = createPmApi(resp(), new Map(), new Map(), { eventName: 'test' })
    const out = await runScript(
      `
        try { await pm.sendRequest('https://x') }
        catch (e) { pm.environment.set('err', 'caught') }
      `,
      pm,
    )
    expect(out.envUpdates.err).toBe('caught')
  })
})

describe('pm.response.body — raw string (real Postman/Insomnia token script)', () => {
  it('exposes the raw body string (alias of text(), never a parsed object)', () => {
    const pm = createPmApi(resp({ body: '{"access_token":"TOK-123"}' }), new Map(), new Map(), {
      eventName: 'test',
    })
    expect(typeof pm.response.body).toBe('string')
    expect(pm.response.body).toBe('{"access_token":"TOK-123"}')
    expect(pm.response.body).toBe(pm.response.text())
    // code is numeric, status is the Postman-style text — used by the script below
    expect(pm.response.code).toBe(200)
    expect(pm.response.status).toBe('OK')
  })

  // Regression for the reported bug: pm.response.body was undefined, so the
  // script's `String(pm.response.body || '').trim()` produced '', parseJsonResponse
  // returned {}, accessToken was set to undefined, and the next folder got 401.
  it("the real Create Token script extracts and saves the access token", async () => {
    const pm = createPmApi(
      resp({ status: 200, statusText: 'OK', body: '{"access_token":"TOK-123"}' }),
      new Map(),
      new Map(),
      { eventName: 'test' },
    )
    const out = await runScript(
      `
        function parseJsonResponse() {
          var status = pm.response.status;
          if (status < 200 || status >= 300) { throw new Error('HTTP ' + status); }
          var raw = String(pm.response.body || '').trim();
          if (!raw) { return {}; }
          if (raw.indexOf('<') === 0) { throw new Error('HTML response'); }
          try { return pm.response.json(); } catch (e) { return JSON.parse(raw); }
        }
        pm.test("Status code is 200", function () { pm.response.to.have.status(200); });
        var json = parseJsonResponse();
        pm.environment.set("accessToken", json.access_token);
        pm.test("access_token saved", function () {
          pm.expect(json.access_token).to.be.a("string").and.not.empty;
        });
      `,
      pm,
    )
    expect(out.envUpdates.accessToken).toBe('TOK-123')
    expect(out.results.find((r) => r.assertion.name === 'Status code is 200')?.passed).toBe(true)
    expect(out.results.find((r) => r.assertion.name === 'access_token saved')?.passed).toBe(true)
  })
})

describe('pm.expect — chai-style chain incl. negation (Send path parity)', () => {
  const passed = async (body: string): Promise<boolean | undefined> => {
    const pm = createPmApi(resp(), new Map(), new Map(), { eventName: 'test' })
    const out = await runScript(`pm.test('a', function () { ${body} })`, pm)
    return out.results.find((r) => r.assertion.name === 'a')?.passed
  }

  it('positive matchers pass', async () => {
    expect(await passed(`pm.expect('x').to.be.a('string')`)).toBe(true)
    expect(await passed(`pm.expect(5).to.equal(5)`)).toBe(true)
    expect(await passed(`pm.expect([1,2]).to.have.lengthOf(2)`)).toBe(true)
    expect(await passed(`pm.expect('abc').to.include('b')`)).toBe(true)
    expect(await passed(`pm.expect({a:1}).to.eql({a:1})`)).toBe(true)
    expect(await passed(`pm.expect(7).to.be.above(3).and.below(10)`)).toBe(true)
    // match (regex) + deep.equal — documented matchers that previously did not exist
    expect(await passed(`pm.expect('a@b.com').to.match(/@/)`)).toBe(true)
    expect(await passed(`pm.expect({a:1}).to.deep.equal({a:1})`)).toBe(true)
    expect(await passed(`pm.expect({a:1}).to.not.deep.equal({a:2})`)).toBe(true)
    expect(await passed(`pm.expect('xyz').to.not.match(/@/)`)).toBe(true)
  })

  // Regression: beChain had no `.not`, so `.and.not.empty` threw a TypeError and
  // every test using negation silently failed. Now `.not` flips the chain.
  it('negation (.not.*) works — the bug that broke .and.not.empty', async () => {
    expect(await passed(`pm.expect('tok').to.be.a('string').and.not.empty`)).toBe(true)
    expect(await passed(`pm.expect('').to.be.empty`)).toBe(true)
    expect(await passed(`pm.expect(5).to.not.equal(6)`)).toBe(true)
    expect(await passed(`pm.expect('x').to.not.be.a('number')`)).toBe(true)
    // negations that should FAIL the assertion (caught → passed:false)
    expect(await passed(`pm.expect('').to.not.be.empty`)).toBe(false)
    expect(await passed(`pm.expect(5).to.not.equal(5)`)).toBe(false)
  })
})
