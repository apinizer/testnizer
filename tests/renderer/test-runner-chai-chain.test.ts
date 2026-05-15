// Regression coverage for the Chai-BDD fluent chain that v1.3.1 broke. The
// three failing assertions in `testnizer-bugs-v1.3.1-eren-#5.txt` §5.12 (A/B/C)
// each exercise a different missing chain connector.

import { describe, expect, it } from 'vitest'
import { createPmApi, runScript } from '../../src/renderer/lib/test-runner'
import type { ApiResponse } from '../../src/renderer/types'

function makePm() {
  const apiResponse: ApiResponse = {
    requestId: 'r-test',
    protocol: 'http',
    status: 200,
    statusText: 'OK',
    headers: {},
    body: '',
    bodySize: 0,
    timing: { total: 0 },
  }
  return createPmApi(apiResponse, new Map<string, string>(), new Map<string, string>(), {
    eventName: 'test',
    requestName: 'chai-chain-test',
  })
}

describe('pm.expect chai chain', () => {
  it('A) .to.be.an("array").that.is.empty passes for []', async () => {
    const script = `pm.test('A', function () {
      pm.expect([]).to.be.an('array').that.is.empty;
    });`
    const pm = makePm()
    const out = await runScript(script, pm)
    expect(out.results).toHaveLength(1)
    expect(out.results[0].passed).toBe(true)
  })

  it('B) .to.be.an("array").with.lengthOf(1) passes for 1-element array', async () => {
    const script = `pm.test('B', function () {
      pm.expect([{}]).to.be.an('array').with.lengthOf(1);
    });`
    const pm = makePm()
    const out = await runScript(script, pm)
    expect(out.results).toHaveLength(1)
    expect(out.results[0].passed).toBe(true)
  })

  it('C) .to.be.an("array").that.is.empty passes when data: []', async () => {
    const script = `var res = { data: [], errors: [] };
    pm.test('C-empty-data', function () {
      pm.expect(res.data).to.be.an('array').that.is.empty;
    });`
    const pm = makePm()
    const out = await runScript(script, pm)
    expect(out.results).toHaveLength(1)
    expect(out.results[0].passed).toBe(true)
  })

  it('fails when array is not empty', async () => {
    const script = `pm.test('not-empty-should-fail', function () {
      pm.expect([1,2]).to.be.an('array').that.is.empty;
    });`
    const pm = makePm()
    const out = await runScript(script, pm)
    expect(out.results[0].passed).toBe(false)
  })

  it('fails when lengthOf does not match', async () => {
    const script = `pm.test('len-mismatch-fail', function () {
      pm.expect([1]).to.be.an('array').with.lengthOf(2);
    });`
    const pm = makePm()
    const out = await runScript(script, pm)
    expect(out.results[0].passed).toBe(false)
  })

  it('still supports legacy .to.have.length(n)', async () => {
    const script = `pm.test('legacy', function () {
      pm.expect([1,2,3]).to.have.length(3);
    });`
    const pm = makePm()
    const out = await runScript(script, pm)
    expect(out.results[0].passed).toBe(true)
  })
})
