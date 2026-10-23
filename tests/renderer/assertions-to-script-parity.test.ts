/**
 * Issue #270 — Tests-tab rows exported as pm.test code must give the SAME
 * verdict Testnizer gives on Send.
 *
 * Oracle: the Send evaluator (`resolveAssertionVars` + `runAssertions`, what
 * request.store runs). Candidate: `assertionsToScript(rows)` run through the
 * Send scripting path (`createPmApi` + `runScript`, the shared runtime in
 * src/shared/script/ — the same one a re-imported collection runs on). For
 * every kind, a table of passing and failing responses; per-row verdicts must
 * match in order. The `insomnia.` prefix runs through the same runtime.
 */
import { describe, expect, it } from 'vitest'
import {
  createPmApi,
  resolveAssertionVars,
  runAssertions,
  runScript,
} from '../../src/renderer/lib/test-runner'
import { resolveVariables } from '../../src/renderer/lib/variable-resolver'
import type { ApiResponse, TestAssertion } from '../../src/renderer/types'
import {
  assertionsToScript,
  type AssertionScriptPrefix,
} from '../../src/shared/assertions-to-script'

interface Resp {
  status?: number
  headers?: Record<string, string>
  body?: string
  time?: number
  size?: number
}

function apiResponse(r: Resp): ApiResponse {
  const body = r.body ?? '{}'
  return {
    requestId: 'r270',
    protocol: 'http',
    status: r.status ?? 200,
    statusText: 'OK',
    headers: r.headers ?? { 'Content-Type': 'application/json' },
    body,
    cookies: [],
    bodySize: r.size ?? body.length,
    timing: { total: r.time ?? 50 },
  }
}

const VARS: Record<string, string> = { code: '201', greeting: 'hello', hdr: 'X-Trace' }

let seq = 0
function row(type: TestAssertion['type'], extra: Partial<TestAssertion> = {}): TestAssertion {
  seq += 1
  return { id: `a${seq}`, name: `row ${seq}`, type, enabled: true, ...extra }
}

/** Send oracle: the rows' verdicts as request.store computes them. */
function sendVerdicts(rows: TestAssertion[], resp: ApiResponse): boolean[] {
  const resolved = resolveAssertionVars(rows, (t) => resolveVariables(t, VARS))
  return runAssertions(resolved, resp).map((r) => r.passed)
}

/** Exported script verdicts, via the shared runtime. */
async function scriptVerdicts(
  rows: TestAssertion[],
  resp: ApiResponse,
  prefix: AssertionScriptPrefix = 'pm',
): Promise<boolean[]> {
  const pm = createPmApi(resp, new Map(Object.entries(VARS)), new Map(), { eventName: 'test' })
  const out = await runScript(assertionsToScript(rows, prefix), pm)
  expect(out.scriptError, 'generated script must not throw').toBeUndefined()
  return out.results.map((r) => r.passed)
}

interface Case {
  label: string
  row: TestAssertion
  resp: Resp
  passed: boolean
}

const BODY = JSON.stringify({
  id: 7,
  user: { name: 'Ada', tags: ['x', 'y'] },
  items: [{ n: 1 }, { n: 2 }],
})

const cases: Case[] = [
  // status_equals
  {
    label: 'status 200 = 200',
    row: row('status_equals', { expected: 200 }),
    resp: {},
    passed: true,
  },
  {
    label: 'status "200" text = 200',
    row: row('status_equals', { expected: '200' }),
    resp: {},
    passed: true,
  },
  {
    label: 'status 201 ≠ 200',
    row: row('status_equals', { expected: 201 }),
    resp: {},
    passed: false,
  },
  {
    label: 'status {{code}} = 201',
    row: row('status_equals', { expected: '{{code}}' }),
    resp: { status: 201 },
    passed: true,
  },
  { label: 'status missing expected', row: row('status_equals'), resp: {}, passed: false },
  // status_in_range
  {
    label: 'range 200-299 ∋ 204',
    row: row('status_in_range', { rangeMin: 200, rangeMax: 299 }),
    resp: { status: 204 },
    passed: true,
  },
  {
    label: 'range 200-299 ∌ 404',
    row: row('status_in_range', { rangeMin: 200, rangeMax: 299 }),
    resp: { status: 404 },
    passed: false,
  },
  {
    label: 'range inclusive max',
    row: row('status_in_range', { rangeMin: 200, rangeMax: 299 }),
    resp: { status: 299 },
    passed: true,
  },
  {
    label: 'range defaults 0-999',
    row: row('status_in_range'),
    resp: { status: 503 },
    passed: true,
  },
  // body_contains
  {
    label: 'body contains Ada',
    row: row('body_contains', { expected: 'Ada' }),
    resp: { body: BODY },
    passed: true,
  },
  {
    label: 'body lacks Bob',
    row: row('body_contains', { expected: 'Bob' }),
    resp: { body: BODY },
    passed: false,
  },
  {
    label: 'body contains {{greeting}}',
    row: row('body_contains', { expected: '{{greeting}}' }),
    resp: { body: 'say hello' },
    passed: true,
  },
  {
    label: 'body contains quotes',
    row: row('body_contains', { expected: '"name":"Ada"' }),
    resp: { body: BODY },
    passed: true,
  },
  // body_equals_json
  {
    label: 'json equal',
    row: row('body_equals_json', { expected: '{"a":1,"b":[1,2]}' }),
    resp: { body: '{ "a": 1, "b": [1, 2] }' },
    passed: true,
  },
  {
    label: 'json reordered keys fail (stringify compare)',
    row: row('body_equals_json', { expected: '{"b":2,"a":1}' }),
    resp: { body: '{"a":1,"b":2}' },
    passed: false,
  },
  {
    label: 'json body not JSON',
    row: row('body_equals_json', { expected: '{}' }),
    resp: { body: 'plain' },
    passed: false,
  },
  // body_jsonpath
  {
    label: 'jsonpath $.user.name = Ada',
    row: row('body_jsonpath', { jsonPath: '$.user.name', expected: 'Ada' }),
    resp: { body: BODY },
    passed: true,
  },
  {
    label: 'jsonpath $.id = 7 (number)',
    row: row('body_jsonpath', { jsonPath: '$.id', expected: '7' }),
    resp: { body: BODY },
    passed: true,
  },
  {
    label: 'jsonpath mismatch',
    row: row('body_jsonpath', { jsonPath: '$.user.name', expected: 'Bob' }),
    resp: { body: BODY },
    passed: false,
  },
  {
    label: 'jsonpath exists (empty expected)',
    row: row('body_jsonpath', { jsonPath: '$.user.tags' }),
    resp: { body: BODY },
    passed: true,
  },
  {
    label: 'jsonpath missing (empty expected)',
    row: row('body_jsonpath', { jsonPath: '$.user.age' }),
    resp: { body: BODY },
    passed: false,
  },
  {
    label: 'jsonpath .length',
    row: row('body_jsonpath', { jsonPath: '$.user.tags.length', expected: '2' }),
    resp: { body: BODY },
    passed: true,
  },
  {
    label: 'jsonpath [*] wildcard',
    row: row('body_jsonpath', { jsonPath: '$.items[*].n', expected: '[1,2]' }),
    resp: { body: BODY },
    passed: true,
  },
  {
    label: "jsonpath ['key'] bracket",
    row: row('body_jsonpath', { jsonPath: "$['user']['tags'][1]", expected: 'y' }),
    resp: { body: BODY },
    passed: true,
  },
  {
    label: 'jsonpath object as JSON',
    row: row('body_jsonpath', { jsonPath: '$.items[0]', expected: '{"n":1}' }),
    resp: { body: BODY },
    passed: true,
  },
  // header_exists
  {
    label: 'header exists, other case',
    row: row('header_exists', { headerName: 'content-type' }),
    resp: {},
    passed: true,
  },
  {
    label: 'header name padded',
    row: row('header_exists', { headerName: '  Content-Type ' }),
    resp: {},
    passed: true,
  },
  {
    label: 'header missing',
    row: row('header_exists', { headerName: 'X-Nope' }),
    resp: {},
    passed: false,
  },
  {
    label: 'header {{hdr}} exists',
    row: row('header_exists', { headerName: '{{hdr}}' }),
    resp: { headers: { 'x-trace': 'abc' } },
    passed: true,
  },
  // header_equals
  {
    label: 'header equals trimmed',
    row: row('header_equals', { headerName: 'X-Trace', expected: ' abc ' }),
    resp: { headers: { 'x-trace': 'abc ' } },
    passed: true,
  },
  {
    label: 'header equals mismatch',
    row: row('header_equals', { headerName: 'X-Trace', expected: 'abd' }),
    resp: { headers: { 'X-Trace': 'abc' } },
    passed: false,
  },
  {
    label: 'missing header equals ""',
    row: row('header_equals', { headerName: 'X-Nope', expected: '' }),
    resp: {},
    passed: true,
  },
  // header_contains
  {
    label: 'header contains json',
    row: row('header_contains', { headerName: 'CONTENT-TYPE', expected: 'json' }),
    resp: { headers: { 'Content-Type': 'application/json; charset=utf-8' } },
    passed: true,
  },
  {
    label: 'header contains no',
    row: row('header_contains', { headerName: 'Content-Type', expected: 'xml' }),
    resp: {},
    passed: false,
  },
  // response_time_under
  {
    label: 'time 50 < 100',
    row: row('response_time_under', { expected: 100 }),
    resp: { time: 50 },
    passed: true,
  },
  {
    label: 'time 150 !< 100',
    row: row('response_time_under', { expected: '100' }),
    resp: { time: 150 },
    passed: false,
  },
  {
    label: 'time equal is not under',
    row: row('response_time_under', { expected: 50 }),
    resp: { time: 50 },
    passed: false,
  },
  // response_size_under
  {
    label: 'size 10 < 1024',
    row: row('response_size_under', { expected: 1024 }),
    resp: { size: 10 },
    passed: true,
  },
  {
    label: 'size 2048 !< 1024',
    row: row('response_size_under', { expected: 1024 }),
    resp: { size: 2048 },
    passed: false,
  },
]

describe('issue #270 — exported assertion script ≡ Send evaluator', () => {
  for (const c of cases) {
    it(`${c.row.type}: ${c.label}`, async () => {
      const resp = apiResponse(c.resp)
      const send = sendVerdicts([c.row], resp)
      expect(send, 'oracle sanity').toEqual([c.passed])
      expect(await scriptVerdicts([c.row], resp)).toEqual(send)
      expect(await scriptVerdicts([c.row], resp, 'insomnia')).toEqual(send)
    })
  }

  it('a mixed block keeps per-row verdicts and order', async () => {
    const rows = cases.map((c) => c.row)
    const resp = apiResponse({
      body: BODY,
      headers: { 'Content-Type': 'application/json', 'X-Trace': 'abc' },
    })
    expect(await scriptVerdicts(rows, resp)).toEqual(sendVerdicts(rows, resp))
  })

  it('a user `const` after the block does not clash with the block’s names', async () => {
    const rows = [row('body_jsonpath', { jsonPath: '$.id', expected: '7' })]
    const resp = apiResponse({ body: BODY })
    const pm = createPmApi(resp, new Map(), new Map(), { eventName: 'test' })
    const script = `${assertionsToScript(rows)}\nconst e = 1, v = 2, __tnJsonPath = 3\npm.test('user', () => pm.expect(e + v).to.equal(3))`
    const out = await runScript(script, pm)
    expect(out.scriptError).toBeUndefined()
    expect(out.results.map((r) => r.passed)).toEqual([true, true])
  })
})
