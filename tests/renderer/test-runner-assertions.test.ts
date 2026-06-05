// Comprehensive coverage for the declarative ("visual") assertion engine in
// src/renderer/lib/test-runner.ts. Every assertion `type` gets a PASS and a
// FAIL case, plus the codebase-critical header lookup contract
// (case-insensitive name + trimmed value, see the "Header assertion
// parallelism" gotcha in CLAUDE.md) and {{var}} pre-resolution of `expected`.
//
// NOTE: the renderer `runAssertions(assertions, response)` deliberately takes
// NO variable map — the caller (request.store) resolves {{var}} placeholders in
// `expected` *before* handing the assertion to the engine. We mirror that real
// path here using the renderer `resolveVariables` helper.

import { describe, expect, it } from 'vitest'
import { runAssertions } from '../../src/renderer/lib/test-runner'
import { resolveVariables } from '../../src/renderer/lib/variable-resolver'
import type { ApiResponse, TestAssertion } from '../../src/renderer/types'

// ─── Helpers ─────────────────────────────────────────────────────

function makeResponse(overrides: Partial<ApiResponse> = {}): ApiResponse {
  return {
    requestId: 'r-assert',
    protocol: 'http',
    status: 200,
    statusText: 'OK',
    headers: {},
    body: '',
    bodySize: 0,
    timing: { total: 0 },
    ...overrides,
  }
}

let idCounter = 0
function makeAssertion(partial: Omit<TestAssertion, 'id' | 'name' | 'enabled'> & {
  name?: string
  enabled?: boolean
}): TestAssertion {
  return {
    id: `a-${idCounter++}`,
    name: partial.name ?? partial.type,
    enabled: partial.enabled ?? true,
    type: partial.type,
    expected: partial.expected,
    jsonPath: partial.jsonPath,
    xPath: partial.xPath,
    headerName: partial.headerName,
    rangeMin: partial.rangeMin,
    rangeMax: partial.rangeMax,
  }
}

/** Run a single assertion and return its lone TestResult. */
function runOne(assertion: TestAssertion, response: ApiResponse) {
  const results = runAssertions([assertion], response)
  expect(results).toHaveLength(1)
  return results[0]
}

// ─── status_equals ───────────────────────────────────────────────

describe('status_equals', () => {
  it('passes when status matches (string expected is coerced to number)', () => {
    const res = makeResponse({ status: 200 })
    const r = runOne(makeAssertion({ type: 'status_equals', expected: '200' }), res)
    expect(r.passed).toBe(true)
    expect(r.actual).toBe(200)
  })

  it('fails when status differs', () => {
    const res = makeResponse({ status: 404 })
    const r = runOne(makeAssertion({ type: 'status_equals', expected: 200 }), res)
    expect(r.passed).toBe(false)
    expect(r.actual).toBe(404)
  })
})

// ─── status_in_range ─────────────────────────────────────────────

describe('status_in_range', () => {
  it('passes when status is inside [min,max]', () => {
    const res = makeResponse({ status: 204 })
    const r = runOne(makeAssertion({ type: 'status_in_range', rangeMin: 200, rangeMax: 299 }), res)
    expect(r.passed).toBe(true)
    expect(r.actual).toBe(204)
  })

  it('fails when status is outside the range', () => {
    const res = makeResponse({ status: 500 })
    const r = runOne(makeAssertion({ type: 'status_in_range', rangeMin: 200, rangeMax: 299 }), res)
    expect(r.passed).toBe(false)
  })
})

// ─── body_contains ───────────────────────────────────────────────

describe('body_contains', () => {
  it('passes when body contains the substring', () => {
    const res = makeResponse({ body: '{"hello":"world"}' })
    const r = runOne(makeAssertion({ type: 'body_contains', expected: 'world' }), res)
    expect(r.passed).toBe(true)
    expect(r.actual).toBe('contains')
  })

  it('fails when substring is absent', () => {
    const res = makeResponse({ body: '{"hello":"world"}' })
    const r = runOne(makeAssertion({ type: 'body_contains', expected: 'missing' }), res)
    expect(r.passed).toBe(false)
    expect(r.actual).toBe('not found')
  })
})

// ─── body_equals_json ────────────────────────────────────────────

describe('body_equals_json', () => {
  it('passes when JSON is structurally equal regardless of key order/whitespace', () => {
    const res = makeResponse({ body: '{ "a": 1, "b": 2 }' })
    const r = runOne(
      makeAssertion({ type: 'body_equals_json', expected: '{"a":1,"b":2}' }),
      res,
    )
    expect(r.passed).toBe(true)
  })

  it('fails when JSON differs', () => {
    const res = makeResponse({ body: '{"a":1}' })
    const r = runOne(makeAssertion({ type: 'body_equals_json', expected: '{"a":2}' }), res)
    expect(r.passed).toBe(false)
  })

  it('reports a parse error when body is not JSON', () => {
    const res = makeResponse({ body: 'not json' })
    const r = runOne(makeAssertion({ type: 'body_equals_json', expected: '{}' }), res)
    expect(r.passed).toBe(false)
    expect(r.error).toMatch(/JSON parse error/)
  })
})

// ─── body_jsonpath ───────────────────────────────────────────────

describe('body_jsonpath', () => {
  it('passes when the JSONPath value equals expected', () => {
    const res = makeResponse({ body: '{"user":{"id":42,"name":"Ada"}}' })
    const r = runOne(
      makeAssertion({ type: 'body_jsonpath', jsonPath: '$.user.name', expected: 'Ada' }),
      res,
    )
    expect(r.passed).toBe(true)
    expect(r.actual).toBe('Ada')
  })

  it('passes existence-only check when expected is empty', () => {
    const res = makeResponse({ body: '{"token":"abc"}' })
    const r = runOne(makeAssertion({ type: 'body_jsonpath', jsonPath: '$.token' }), res)
    expect(r.passed).toBe(true)
  })

  it('resolves array index paths', () => {
    const res = makeResponse({ body: '{"items":[{"id":1},{"id":2}]}' })
    const r = runOne(
      makeAssertion({ type: 'body_jsonpath', jsonPath: '$.items[1].id', expected: '2' }),
      res,
    )
    expect(r.passed).toBe(true)
    expect(r.actual).toBe('2')
  })

  it('fails when JSONPath value differs from expected', () => {
    const res = makeResponse({ body: '{"user":{"name":"Ada"}}' })
    const r = runOne(
      makeAssertion({ type: 'body_jsonpath', jsonPath: '$.user.name', expected: 'Bob' }),
      res,
    )
    expect(r.passed).toBe(false)
    expect(r.actual).toBe('Ada')
  })

  it('fails existence-only check when the path is missing', () => {
    const res = makeResponse({ body: '{"user":{}}' })
    const r = runOne(makeAssertion({ type: 'body_jsonpath', jsonPath: '$.user.name' }), res)
    expect(r.passed).toBe(false)
  })
})

// ─── body_xpath ──────────────────────────────────────────────────

describe('body_xpath', () => {
  const xml = '<root><user><name>Ada</name></user></root>'

  it('passes when the XPath string value equals expected', () => {
    const res = makeResponse({ body: xml })
    const r = runOne(
      makeAssertion({ type: 'body_xpath', xPath: '/root/user/name', expected: 'Ada' }),
      res,
    )
    expect(r.passed).toBe(true)
    expect(r.actual).toBe('Ada')
  })

  it('passes existence-only check when expected is empty', () => {
    const res = makeResponse({ body: xml })
    const r = runOne(makeAssertion({ type: 'body_xpath', xPath: '/root/user/name' }), res)
    expect(r.passed).toBe(true)
  })

  it('fails when the XPath value differs from expected', () => {
    const res = makeResponse({ body: xml })
    const r = runOne(
      makeAssertion({ type: 'body_xpath', xPath: '/root/user/name', expected: 'Bob' }),
      res,
    )
    expect(r.passed).toBe(false)
  })
})

// ─── header_exists ───────────────────────────────────────────────

describe('header_exists', () => {
  it('passes (case-insensitive name lookup) when the header is present', () => {
    const res = makeResponse({ headers: { 'Content-Type': 'application/json' } })
    // header typed in a different case than the response key.
    const r = runOne(makeAssertion({ type: 'header_exists', headerName: 'content-type' }), res)
    expect(r.passed).toBe(true)
    expect(r.actual).toBe('exists')
  })

  it('fails when the header is absent', () => {
    const res = makeResponse({ headers: { 'Content-Type': 'application/json' } })
    const r = runOne(makeAssertion({ type: 'header_exists', headerName: 'x-missing' }), res)
    expect(r.passed).toBe(false)
    expect(r.actual).toBe('not found')
  })
})

// ─── header_equals ───────────────────────────────────────────────

describe('header_equals', () => {
  it('passes with case-insensitive name AND trimmed value on both sides', () => {
    // Response header key is title-cased; value has surrounding whitespace.
    const res = makeResponse({ headers: { 'X-Token': '  abc123  ' } })
    const r = runOne(
      // header name typed lowercase + trailing space; expected has a trailing newline.
      makeAssertion({ type: 'header_equals', headerName: ' x-token ', expected: 'abc123\n' }),
      res,
    )
    expect(r.passed).toBe(true)
    expect(r.actual).toBe('abc123')
  })

  it('fails when the trimmed value differs', () => {
    const res = makeResponse({ headers: { 'X-Token': 'abc123' } })
    const r = runOne(
      makeAssertion({ type: 'header_equals', headerName: 'X-Token', expected: 'different' }),
      res,
    )
    expect(r.passed).toBe(false)
  })

  it('flattens array-shaped header bags (alternating [k,v] pairs)', () => {
    // SSE/gRPC engines surface headers as [['Content-Type','application/json'], ...]
    const res = makeResponse({
      headers: [['Content-Type', 'application/json']] as unknown as Record<string, string>,
    })
    const r = runOne(
      makeAssertion({
        type: 'header_equals',
        headerName: 'content-type',
        expected: 'application/json',
      }),
      res,
    )
    expect(r.passed).toBe(true)
  })
})

// ─── header_contains ─────────────────────────────────────────────

describe('header_contains', () => {
  it('passes with case-insensitive name and trimmed substring match', () => {
    const res = makeResponse({ headers: { 'Content-Type': '  application/json; charset=utf-8  ' } })
    const r = runOne(
      makeAssertion({ type: 'header_contains', headerName: 'CONTENT-TYPE', expected: 'json' }),
      res,
    )
    expect(r.passed).toBe(true)
    expect(r.actual).toBe('application/json; charset=utf-8')
  })

  it('fails when the substring is not present', () => {
    const res = makeResponse({ headers: { 'Content-Type': 'application/json' } })
    const r = runOne(
      makeAssertion({ type: 'header_contains', headerName: 'content-type', expected: 'xml' }),
      res,
    )
    expect(r.passed).toBe(false)
  })
})

// ─── response_time_under ─────────────────────────────────────────

describe('response_time_under', () => {
  it('passes when timing.total is strictly under the threshold', () => {
    const res = makeResponse({ timing: { total: 120 } })
    const r = runOne(makeAssertion({ type: 'response_time_under', expected: 200 }), res)
    expect(r.passed).toBe(true)
    expect(r.actual).toBe(120)
  })

  it('fails when timing.total meets or exceeds the threshold', () => {
    const res = makeResponse({ timing: { total: 200 } })
    const r = runOne(makeAssertion({ type: 'response_time_under', expected: 200 }), res)
    expect(r.passed).toBe(false)
  })
})

// ─── response_size_under ─────────────────────────────────────────

describe('response_size_under', () => {
  it('passes when bodySize is strictly under the threshold', () => {
    const res = makeResponse({ bodySize: 512 })
    const r = runOne(makeAssertion({ type: 'response_size_under', expected: 1024 }), res)
    expect(r.passed).toBe(true)
    expect(r.actual).toBe(512)
  })

  it('fails when bodySize meets or exceeds the threshold', () => {
    const res = makeResponse({ bodySize: 2048 })
    const r = runOne(makeAssertion({ type: 'response_size_under', expected: 1024 }), res)
    expect(r.passed).toBe(false)
  })
})

// ─── Engine-level behaviours ─────────────────────────────────────

describe('runAssertions engine', () => {
  it('skips disabled assertions', () => {
    const res = makeResponse({ status: 200 })
    const results = runAssertions(
      [
        makeAssertion({ type: 'status_equals', expected: 999, enabled: false }),
        makeAssertion({ type: 'status_equals', expected: 200, enabled: true }),
      ],
      res,
    )
    // Only the enabled assertion is evaluated.
    expect(results).toHaveLength(1)
    expect(results[0].passed).toBe(true)
  })

  it('returns a clear error for an unknown assertion type', () => {
    const res = makeResponse()
    const bogus = makeAssertion({
      type: 'totally_made_up' as unknown as TestAssertion['type'],
    })
    const r = runOne(bogus, res)
    expect(r.passed).toBe(false)
    expect(r.error).toMatch(/Unknown assertion type/)
  })
})

// ─── {{var}} resolution in `expected` (caller pre-resolves) ──────

describe('{{var}} resolution in expected (renderer path)', () => {
  const vars: Record<string, string> = { expectedStatus: '201', token: 'secret-xyz' }

  it('resolves a {{var}} in a status_equals expected before comparison (PASS)', () => {
    const res = makeResponse({ status: 201 })
    const raw = makeAssertion({ type: 'status_equals', expected: '{{expectedStatus}}' })
    // mirror request.store: resolve {{var}} placeholders in `expected` first.
    const resolved: TestAssertion = {
      ...raw,
      expected: resolveVariables(String(raw.expected), vars),
    }
    const r = runOne(resolved, res)
    expect(r.passed).toBe(true)
  })

  it('resolves a {{var}} in a header_equals expected before comparison (PASS)', () => {
    const res = makeResponse({ headers: { 'X-Token': 'secret-xyz' } })
    const raw = makeAssertion({
      type: 'header_equals',
      headerName: 'X-Token',
      expected: '{{token}}',
    })
    const resolved: TestAssertion = {
      ...raw,
      expected: resolveVariables(String(raw.expected), vars),
    }
    const r = runOne(resolved, res)
    expect(r.passed).toBe(true)
    expect(r.actual).toBe('secret-xyz')
  })

  it('fails when the resolved value does not match (FAIL)', () => {
    const res = makeResponse({ status: 500 })
    const raw = makeAssertion({ type: 'status_equals', expected: '{{expectedStatus}}' })
    const resolved: TestAssertion = {
      ...raw,
      expected: resolveVariables(String(raw.expected), vars),
    }
    const r = runOne(resolved, res)
    expect(r.passed).toBe(false)
  })
})
