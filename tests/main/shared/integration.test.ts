/**
 * src/shared/script/index.ts — buildScriptBindings(ctx) end-to-end: build the
 * binding set, execute a real script via `new Function(...keys, src)`, and prove
 * env/var writes, the legacy `tests` collector, the insomnia/bru aliases, and
 * `require` all wire through the SAME sandbox both paths share.
 */
import { describe, it, expect as vi } from 'vitest'
import { buildScriptBindings } from '../../../src/shared/script'
import { makeFakePm, json200 } from './helpers'

/** Run a script string with the assembled bindings, exactly like both paths do. */
function runScript(src: string, bindings: Record<string, unknown>): void {
  const keys = Object.keys(bindings)
  const fn = new Function(...keys, src)
  fn(...keys.map((k) => bindings[k]))
}

describe('buildScriptBindings — binding set shape', () => {
  it('exposes pm/t/insomnia/bru/req/res/expect/test/require + library globals + legacy', () => {
    const fake = makeFakePm()
    const { bindings } = buildScriptBindings(fake.ctx)
    for (const key of [
      'pm',
      't',
      'insomnia',
      'bru',
      'req',
      'res',
      'expect',
      'test',
      'require',
      'CryptoJS',
      '_',
      'atob',
      'btoa',
      'postman',
      'tests',
      'xml2Json',
      'environment',
      'globals',
      'responseBody',
    ]) {
      vi(key in bindings, `binding '${key}' missing`).toBe(true)
    }
  })
  it('t is the same object as pm (Testnizer brand alias)', () => {
    const fake = makeFakePm()
    const { bindings } = buildScriptBindings(fake.ctx)
    vi(bindings.t).toBe(bindings.pm)
  })
})

describe('buildScriptBindings — execute a full multi-API script', () => {
  it('runs a script using require + pm + legacy tests + insomnia + bru', () => {
    const fake = makeFakePm({ response: json200 })
    const { bindings, legacyTests } = buildScriptBindings(fake.ctx)

    const src = `
      var _ = require('lodash');
      if (_.chunk([1,2,3,4], 2).length !== 2) throw new Error('lodash failed');

      pm.environment.set('captured', 'yes');

      pm.test('status code is 200', function () {
        pm.expect(pm.response.code).to.equal(200);
      });

      tests['legacy ok'] = pm.response.code === 200;

      // Insomnia: response.status is the NUMERIC code (the trap)
      insomnia.expect(insomnia.response.status).to.equal(200);

      // Bruno: res.getStatus() numeric, write back via bru
      bru.setVar('lastStatus', res.getStatus());
    `

    runScript(src, bindings)

    // env write happened through the shared scope
    vi(fake.pm.environment.get('captured')).toBe('yes')
    // legacy collector mutated
    vi(legacyTests['legacy ok']).toBe(true)
    // pm.test sink recorded a pass
    vi(fake.sink).toContainEqual({ name: 'status code is 200', passed: true })
    // bru.setVar wrote into pm.variables
    vi(fake.pm.variables.get('lastStatus')).toBe(200)
  })

  it('records a FAILED test when an assertion throws (honest sink)', () => {
    const fake = makeFakePm({ response: json200 })
    const { bindings } = buildScriptBindings(fake.ctx)
    runScript(
      `pm.test('wrong code', function () { pm.expect(pm.response.code).to.equal(404); });`,
      bindings,
    )
    const entry = fake.sink.find((s) => s.name === 'wrong code')
    vi(entry?.passed).toBe(false)
    vi(entry?.error).toBeTruthy()
  })

  it('bare expect + test globals work without the pm prefix', () => {
    const fake = makeFakePm({ response: json200 })
    const { bindings } = buildScriptBindings(fake.ctx)
    runScript(
      `test('bare globals', function () { expect(res.getStatus()).to.equal(200); });`,
      bindings,
    )
    vi(fake.sink).toContainEqual({ name: 'bare globals', passed: true })
  })

  it('CryptoJS / atob / btoa globals are usable in-script', () => {
    const fake = makeFakePm()
    const { bindings } = buildScriptBindings(fake.ctx)
    runScript(
      `
        pm.environment.set('hash', CryptoJS.SHA256('x').toString());
        pm.environment.set('roundtrip', atob(btoa('héllo→世界')));
      `,
      bindings,
    )
    vi((fake.pm.environment.get('hash') as string).length).toBe(64)
    vi(fake.pm.environment.get('roundtrip')).toBe('héllo→世界')
  })

  it('legacy postman.setNextRequest flows through execution', () => {
    const fake = makeFakePm({ response: json200 })
    const { bindings } = buildScriptBindings(fake.ctx)
    runScript(`postman.setNextRequest('Cleanup');`, bindings)
    vi(fake.nextRequest.value).toBe('Cleanup')
  })

  it('require of an unknown module surfaces the sandbox error', () => {
    const fake = makeFakePm()
    const { bindings } = buildScriptBindings(fake.ctx)
    vi(() => runScript(`require('no-such-lib');`, bindings)).toThrow(/Cannot find module/)
  })
})
