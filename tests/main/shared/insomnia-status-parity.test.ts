/**
 * Regression: Insomnia `.status` is the numeric HTTP code, not the reason
 * phrase (issue #47).
 *
 * The Insomnia importer used to rewrite `insomnia.response.status` →
 * `pm.response.status`, silently flipping it from the numeric code to the
 * reason-phrase text. A common user guard —
 *   `var s = insomnia.response.status; if (s < 200 || s >= 300) throw ...`
 * — then fired BEFORE the (fully populated) body was read whenever the server
 * sent an empty reason phrase (`"" < 200` → true), so every body assertion
 * failed while `Status code is 200` still passed. This asserts the shared
 * runtime's `insomnia` binding keeps `.status` numeric so the guard passes and
 * the body is read.
 */
import { describe, it, expect } from 'vitest'
import { buildScriptBindings } from '../../../src/shared/script'
import { makeFakePm } from './helpers'
import type { NormalizedResponse } from '../../../src/shared/script/types'

// A 200 with an EMPTY reason phrase (real servers often omit it) and a full
// JSON body — the exact shape that tripped the reporter.
const resp: NormalizedResponse = {
  code: 200,
  statusText: '',
  headers: { 'Content-Type': 'application/json' },
  body: '{"resultList":[{"name":"secret-key","keyType":"PUBLIC_KEY"}]}',
  cookies: [],
  responseTime: 20,
  responseSize: 60,
}

const SCRIPT = `
  function parseJsonResponse() {
    var status = insomnia.response.status;
    if (status < 200 || status >= 300) throw new Error('HTTP ' + status);
    var raw = String(insomnia.response.body || '').trim();
    if (!raw) return {};
    try { return insomnia.response.json(); } catch (e) { return JSON.parse(raw); }
  }
  insomnia.test("body field present", function () {
    var json = parseJsonResponse();
    insomnia.expect(json.resultList[0].name).to.be.a("string").and.not.empty;
  });
`

async function run(script: string, response: NormalizedResponse) {
  const { pm, sink } = makeFakePm({ response })
  const { bindings } = buildScriptBindings({ pm, normalizedResponse: response })
  const names = Object.keys(bindings)
  const values = names.map((n) => bindings[n])
  const AsyncFunction = Object.getPrototypeOf(async function () {})
    .constructor as FunctionConstructor
  await new AsyncFunction(...names, `{\n${script}\n}`)(...values)
  return sink
}

describe('insomnia.response.status is numeric (issue #47)', () => {
  it('exposes the numeric code even when the reason phrase is empty', () => {
    const { pm } = makeFakePm({ response: resp })
    const { bindings } = buildScriptBindings({ pm, normalizedResponse: resp })
    const insomnia = bindings.insomnia as { response: { status: number; body: string } }
    expect(insomnia.response.status).toBe(200)
    expect(insomnia.response.body).toContain('resultList')
  })

  it('body-reading assertion passes (guard does not throw on empty reason)', async () => {
    const sink = await run(SCRIPT, resp)
    expect(sink).toEqual([{ name: 'body field present', passed: true }])
  })
})
