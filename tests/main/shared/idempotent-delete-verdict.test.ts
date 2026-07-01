/**
 * Regression: idempotent-DELETE verdict parity (issue #16 follow-up).
 *
 * A Test-Suite setup step deletes a resource "if it exists". The API returns
 * 400 "not found" when it doesn't, and the collection's test explicitly allows
 * it: `insomnia.expect(code).to.be.oneOf([200, 204, 404, 400])`. That assertion
 * PASSES, yet the run summary reported the request as "Failed" because the
 * renderer results UIs bucketed every 4xx/5xx as failed via a stale
 * `status < 400` check — the correct assertion-aware verdict lived only in the
 * main process. Both halves are covered here:
 *   1. the shared script runtime resolves `insomnia.response.code` on a 400 and
 *      the oneOf assertion passes;
 *   2. `endpointDidPass` (shared/runner-verdict.ts) — the SINGLE verdict rule —
 *      counts that request as passed.
 */
import { describe, it, expect } from 'vitest'
import { buildScriptBindings } from '../../../src/shared/script'
import { endpointDidPass } from '../../../src/shared/runner-verdict'
import { makeFakePm } from './helpers'
import type { NormalizedResponse } from '../../../src/shared/script/types'

const resp400: NormalizedResponse = {
  code: 400,
  statusText: 'Bad Request',
  headers: { 'Content-Type': 'application/json' },
  body: '{"message":"not found"}',
  cookies: [],
  responseTime: 12,
  responseSize: 24,
}

const SCRIPT = `insomnia.test("Idempotent delete (200, 204, 404 or 400)", function () {
  var code = insomnia.response.code;
  insomnia.expect(code).to.be.oneOf([200, 204, 404, 400]);
});`

async function runInsomniaScript(script: string, response: NormalizedResponse) {
  const { pm, sink } = makeFakePm({ response })
  const { bindings } = buildScriptBindings({ pm, normalizedResponse: response })
  const names = Object.keys(bindings)
  const values = names.map((n) => bindings[n])
  const AsyncFunction = Object.getPrototypeOf(async function () {})
    .constructor as FunctionConstructor
  const fn = new AsyncFunction(...names, `{\n${script}\n}`)
  await fn(...values)
  return sink
}

describe('idempotent-delete verdict parity', () => {
  it('shared runtime: insomnia.response.code is the numeric 400', () => {
    const { pm } = makeFakePm({ response: resp400 })
    const { bindings } = buildScriptBindings({ pm, normalizedResponse: resp400 })
    const insomnia = bindings.insomnia as { response: { code: number } }
    expect(insomnia.response.code).toBe(400)
  })

  it('shared runtime: oneOf([200,204,404,400]) passes on a 400', async () => {
    const sink = await runInsomniaScript(SCRIPT, resp400)
    expect(sink).toEqual([{ name: 'Idempotent delete (200, 204, 404 or 400)', passed: true }])
  })

  it('endpointDidPass: a 400 with a passing assertion is PASSED', () => {
    // The exact shape the runner emits for this request.
    expect(
      endpointDidPass({
        error: undefined,
        failed: 0,
        status: 400,
        assertions: { length: 1 },
      }),
    ).toBe(true)
  })

  it('endpointDidPass: a 400 with NO assertions falls back to failed', () => {
    expect(
      endpointDidPass({ error: undefined, failed: 0, status: 400, assertions: { length: 0 } }),
    ).toBe(false)
  })

  it('endpointDidPass: a 2xx with no assertions is passed', () => {
    expect(
      endpointDidPass({ error: undefined, failed: 0, status: 200, assertions: { length: 0 } }),
    ).toBe(true)
  })

  it('endpointDidPass: a failing assertion fails regardless of status', () => {
    expect(
      endpointDidPass({ error: undefined, failed: 1, status: 200, assertions: { length: 2 } }),
    ).toBe(false)
  })

  it('endpointDidPass: a transport error always fails', () => {
    expect(
      endpointDidPass({ error: 'ECONNREFUSED', failed: 0, status: null, assertions: { length: 0 } }),
    ).toBe(false)
  })

  it('endpointDidPass: a 500 with a passing assertion is passed', () => {
    expect(
      endpointDidPass({ error: undefined, failed: 0, status: 500, assertions: { length: 1 } }),
    ).toBe(true)
  })
})
