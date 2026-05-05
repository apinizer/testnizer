import { describe, it, expect } from 'vitest'
import { formatJson, minifyJson } from '../../../src/renderer/lib/tools/json-format'

describe('formatJson — pretty print', () => {
  it('default indent is 2 spaces', () => {
    const r = formatJson('{"a":1}')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.output).toBe('{\n  "a": 1\n}')
  })

  it('indent 4', () => {
    const r = formatJson('{"a":1}', { indent: 4 })
    if (!r.ok) throw new Error()
    expect(r.output).toBe('{\n    "a": 1\n}')
  })

  it('indent tab', () => {
    const r = formatJson('{"a":1}', { indent: '\t' })
    if (!r.ok) throw new Error()
    expect(r.output).toBe('{\n\t"a": 1\n}')
  })

  it('handles nested objects and arrays', () => {
    const input = '{"a":{"b":[1,2,{"c":3}]}}'
    const r = formatJson(input)
    if (!r.ok) throw new Error()
    expect(r.output).toContain('  "a"')
    expect(r.output).toContain('    "b"')
    expect(r.output).toContain('"c": 3')
  })

  it('preserves special characters in strings', () => {
    const r = formatJson('{"newline":"a\\nb","tab":"a\\tb","unicode":"\\u00e7akal"}')
    if (!r.ok) throw new Error()
    expect(r.output).toContain('a\\nb')
    expect(r.output).toContain('çakal')
  })

  it('formats top-level primitives', () => {
    expect(formatJson('null')).toMatchObject({ ok: true, output: 'null' })
    expect(formatJson('true')).toMatchObject({ ok: true, output: 'true' })
    expect(formatJson('false')).toMatchObject({ ok: true, output: 'false' })
    expect(formatJson('123')).toMatchObject({ ok: true, output: '123' })
    expect(formatJson('"hello"')).toMatchObject({ ok: true, output: '"hello"' })
  })

  it('formats top-level arrays', () => {
    const r = formatJson('[1,2,3]')
    if (!r.ok) throw new Error()
    expect(r.output).toBe('[\n  1,\n  2,\n  3\n]')
  })

  it('handles UTF-8 (Türkçe + emoji)', () => {
    const r = formatJson('{"name":"Yıldız","emoji":"🚀"}')
    if (!r.ok) throw new Error()
    expect(r.output).toContain('Yıldız')
    expect(r.output).toContain('🚀')
  })
})

describe('formatJson — minify', () => {
  it('indent 0 produces minified output', () => {
    const r = formatJson('{\n  "a": 1\n}', { indent: 0 })
    if (!r.ok) throw new Error()
    expect(r.output).toBe('{"a":1}')
  })

  it("empty string indent ('') produces minified output", () => {
    const r = formatJson('{\n  "a": 1\n}', { indent: '' })
    if (!r.ok) throw new Error()
    expect(r.output).toBe('{"a":1}')
  })

  it('minifyJson() shorthand', () => {
    const r = minifyJson('{\n  "a": [1, 2]\n}')
    if (!r.ok) throw new Error()
    expect(r.output).toBe('{"a":[1,2]}')
  })

  it('minify → pretty round-trip identity', () => {
    const original = '{"x":[1,{"y":"z"}],"n":null}'
    const minified = formatJson(original, { indent: 0 })
    if (!minified.ok) throw new Error()
    const reformatted = formatJson(minified.output, { indent: 2 })
    if (!reformatted.ok) throw new Error()
    const reMinified = formatJson(reformatted.output, { indent: 0 })
    if (!reMinified.ok) throw new Error()
    expect(reMinified.output).toBe(minified.output)
  })
})

describe('formatJson — sortKeys', () => {
  it('shallow sort', () => {
    const r = formatJson('{"c":1,"a":2,"b":3}', { sortKeys: true })
    if (!r.ok) throw new Error()
    expect(r.output).toMatch(/"a".*"b".*"c"/s)
  })

  it('deep sort', () => {
    const r = formatJson('{"z":{"d":1,"a":2}}', { sortKeys: true })
    if (!r.ok) throw new Error()
    expect(r.output).toMatch(/"a".*"d"/s)
  })

  it('sort is case-sensitive (uppercase before lowercase)', () => {
    const r = formatJson('{"b":1,"A":2,"a":3}', { sortKeys: true })
    if (!r.ok) throw new Error()
    expect(r.output.indexOf('"A"')).toBeLessThan(r.output.indexOf('"a"'))
    expect(r.output.indexOf('"a"')).toBeLessThan(r.output.indexOf('"b"'))
  })

  it('sortKeys does not affect array order', () => {
    const r = formatJson('[3,1,2]', { sortKeys: true })
    if (!r.ok) throw new Error()
    expect(r.output).toMatch(/3,\s*1,\s*2/s)
  })
})

describe('formatJson — error handling', () => {
  it('rejects empty input', () => {
    const r = formatJson('')
    expect(r.ok).toBe(false)
  })

  it('rejects whitespace-only input', () => {
    const r = formatJson('   \n\t')
    expect(r.ok).toBe(false)
  })

  it('rejects null input', () => {
    const r = formatJson(null as unknown as string)
    expect(r.ok).toBe(false)
  })

  it('rejects trailing comma', () => {
    const r = formatJson('{"a":1,}')
    expect(r.ok).toBe(false)
  })

  it('rejects single quotes', () => {
    const r = formatJson("{'a': 1}")
    expect(r.ok).toBe(false)
  })

  it('rejects unterminated string', () => {
    const r = formatJson('{"a":"unterm')
    expect(r.ok).toBe(false)
  })

  it('reports line/column when V8 includes position info', () => {
    // Modern V8 omits position from many error messages; only check format
    // when present. Either way, error must be a non-empty string.
    const r = formatJson('{\n  "a": 1,\n  "b": ,\n}')
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error.length).toBeGreaterThan(0)
    if (r.line !== undefined) {
      expect(r.line).toBeTypeOf('number')
      expect(r.column).toBeTypeOf('number')
    }
  })
})

describe('formatJson — large input', () => {
  it('formats a 100KB JSON without crashing', () => {
    const arr = new Array(2000).fill(0).map((_, i) => ({ id: i, name: `item-${i}` }))
    const big = JSON.stringify(arr)
    const r = formatJson(big)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.output.length).toBeGreaterThan(big.length)
  })
})
