/**
 * Issue #270 — converter shape: disabled rows skipped, unexportable kinds
 * become comments (never dropped silently), strings JSON-escaped, and the
 * import-side strip removes exactly the tests x-apinizer restores.
 * Verdict parity per kind lives in tests/renderer/assertions-to-script-parity.test.ts.
 */
import { describe, expect, it } from 'vitest'
import {
  ASSERTION_BLOCK_BEGIN,
  ASSERTION_BLOCK_END,
  assertionsToScript,
  stripExportedAssertions,
  withAssertionScript,
} from '../../../src/shared/assertions-to-script'
import { buildScriptBindings } from '../../../src/shared/script'
import { makeFakePm } from './helpers'

function run(script: string, response = makeFakePm()): { name: string; passed: boolean }[] {
  const { bindings } = buildScriptBindings(response.ctx)
  const names = Object.keys(bindings)
  new Function(...names, script)(...names.map((n) => bindings[n]))
  return response.sink.map(({ name, passed }) => ({ name, passed }))
}

describe('assertionsToScript', () => {
  it('returns nothing for no rows or only disabled rows', () => {
    expect(assertionsToScript([])).toBe('')
    expect(assertionsToScript(undefined)).toBe('')
    expect(assertionsToScript([{ type: 'status_equals', enabled: false, expected: 200 }])).toBe('')
  })

  it('skips disabled rows and keeps enabled ones in order', () => {
    const s = assertionsToScript([
      { name: 'A', type: 'status_equals', enabled: true, expected: 200 },
      { name: 'B', type: 'body_contains', enabled: false, expected: 'x' },
      { name: 'C', type: 'header_exists', enabled: true, headerName: 'X-Trace' },
    ])
    expect(s.startsWith(ASSERTION_BLOCK_BEGIN)).toBe(true)
    expect(s.endsWith(ASSERTION_BLOCK_END)).toBe(true)
    expect(s).toContain('pm.test("A"')
    expect(s).not.toContain('pm.test("B"')
    expect(run(s)).toEqual([
      { name: 'A', passed: true },
      { name: 'C', passed: true },
    ])
  })

  it('XPath and unknown kinds become comments, not silent drops', () => {
    const s = assertionsToScript([
      { name: 'xp', type: 'body_xpath', enabled: true, xPath: '//a', expected: '1' },
      { name: 'weird', type: 'future_kind', enabled: true },
    ])
    expect(s).toContain('// tn-assert:body_xpath\n// not exportable')
    expect(s).toContain('"//a"')
    expect(s).toContain('// Testnizer assertion "future_kind" not exportable')
    expect(run(s)).toEqual([])
  })

  it('JSON-escapes user strings (quotes, newlines, backslashes) so the script stays valid', () => {
    const nasty = 'a"b\'c\\d\ne</script>'
    const s = assertionsToScript([
      { name: nasty, type: 'body_contains', enabled: true, expected: nasty },
    ])
    // One tag line + exactly one test line — a raw newline would split it.
    const lines = s.split('\n')
    const tag = lines.indexOf('// tn-assert:body_contains')
    expect(lines[tag + 1].startsWith('pm.test(')).toBe(true)
    expect(lines[tag + 2]).toBe('})();')
    const fake = makeFakePm({
      response: {
        code: 200,
        statusText: 'OK',
        headers: {},
        body: `xx${nasty}yy`,
        cookies: [],
        responseTime: 1,
        responseSize: 1,
      },
    })
    expect(run(s, fake)).toEqual([{ name: nasty, passed: true }])
  })

  it('uses the insomnia object with the insomnia prefix', () => {
    const s = assertionsToScript(
      [{ name: 'S', type: 'status_equals', enabled: true, expected: 200 }],
      'insomnia',
    )
    expect(s).toContain('insomnia.test("S"')
    expect(s).not.toContain('pm.')
    expect(run(s)).toEqual([{ name: 'S', passed: true }])
  })
})

describe('withAssertionScript', () => {
  const rows = [{ name: 'S', type: 'status_equals', enabled: true, expected: 200 }]
  it('puts the block before the user script', () => {
    const out = withAssertionScript("pm.test('user', () => {})", rows) ?? ''
    expect(out.indexOf(ASSERTION_BLOCK_END)).toBeLessThan(out.indexOf("pm.test('user'"))
  })
  it('passes the user script through when there are no rows', () => {
    expect(withAssertionScript('x()', [])).toBe('x()')
    expect(withAssertionScript('  ', [])).toBeUndefined()
    expect(withAssertionScript(undefined, rows)).toBe(assertionsToScript(rows))
  })
})

describe('stripExportedAssertions', () => {
  const restored = new Set(['status_equals', 'body_jsonpath'])
  const rows = [
    { name: 'S', type: 'status_equals', enabled: true, expected: 200 },
    { name: 'H', type: 'header_exists', enabled: true, headerName: 'X-Trace' },
    { name: 'J', type: 'body_jsonpath', enabled: true, jsonPath: '$.id', expected: '1' },
  ]

  it('drops restored kinds, keeps the others and the user script', () => {
    const script = withAssertionScript("pm.test('user', () => {})", rows) ?? ''
    const out = stripExportedAssertions(script, restored)
    expect(out).not.toContain('pm.test("S"')
    expect(out).not.toContain('pm.test("J"')
    expect(out).toContain('pm.test("H"')
    expect(out).toContain("pm.test('user'")
    expect(run(out).map((t) => t.name)).toEqual(['H', 'user'])
  })

  it('removes the whole block when every test is restored', () => {
    const script =
      withAssertionScript(
        'x()',
        rows.filter((r) => r.type !== 'header_exists'),
      ) ?? ''
    expect(stripExportedAssertions(script, restored)).toBe('x()')
    expect(stripExportedAssertions(assertionsToScript([rows[0]]), restored)).toBe('')
  })

  it('leaves scripts without the marker untouched', () => {
    expect(stripExportedAssertions("pm.test('a', () => {})", restored)).toBe(
      "pm.test('a', () => {})",
    )
  })
})
