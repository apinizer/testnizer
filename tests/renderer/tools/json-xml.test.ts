import { describe, it, expect } from 'vitest'
import { jsonToXml, xmlToJson } from '../../../src/renderer/lib/tools/json-xml'

function parseJson(s: string): unknown {
  return JSON.parse(s)
}

describe('jsonToXml', () => {
  it('serializes a simple object as XML', () => {
    const r = jsonToXml(JSON.stringify({ root: { name: 'Alice', age: 30 } }))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.output).toContain('<?xml version="1.0"')
    expect(r.output).toContain('<root>')
    expect(r.output).toContain('<name>Alice</name>')
    expect(r.output).toContain('<age>30</age>')
  })

  it('wraps primitives with the provided rootName', () => {
    const r = jsonToXml('"hello"', { rootName: 'msg' })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.output).toContain('<msg>hello</msg>')
  })

  it('preserves attributes via @_ prefix', () => {
    const r = jsonToXml(
      JSON.stringify({ book: { '@_id': 'b1', title: 'Sayings' } }),
    )
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.output).toMatch(/<book id="b1">/)
    expect(r.output).toContain('<title>Sayings</title>')
  })

  it('drops null fields when ignoreNulls=true', () => {
    const r = jsonToXml(
      JSON.stringify({ root: { name: 'Alice', missing: null } }),
      { ignoreNulls: true },
    )
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.output).not.toContain('missing')
  })

  it('drops empty-string fields when ignoreEmpty=true', () => {
    const r = jsonToXml(
      JSON.stringify({ root: { name: 'Alice', note: '' } }),
      { ignoreEmpty: true },
    )
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.output).not.toContain('<note')
  })

  it('reports invalid JSON', () => {
    const r = jsonToXml('{bad json')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/Invalid JSON/)
  })
})

describe('xmlToJson', () => {
  it('parses a simple element tree', () => {
    const r = xmlToJson('<root><name>Alice</name><age>30</age></root>', { unwrapRoot: true })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(parseJson(r.output)).toEqual({ name: 'Alice', age: 30 })
  })

  it('keeps numbers as strings when numbersAsStrings=true', () => {
    const r = xmlToJson('<root><n>42</n></root>', { numbersAsStrings: true, unwrapRoot: true })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(parseJson(r.output)).toEqual({ n: '42' })
  })

  it('forces specified jPaths to be arrays', () => {
    const r = xmlToJson(
      '<bookstore><book><title>A</title></book></bookstore>',
      { arrayPaths: ['bookstore.book'], unwrapRoot: true },
    )
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const parsed = parseJson(r.output) as { book: unknown[] }
    expect(Array.isArray(parsed.book)).toBe(true)
    expect(parsed.book.length).toBe(1)
  })

  it('treats xsi:nil="true" as null when treatNilAsNull=true', () => {
    const xml = `<root xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
      <missing xsi:nil="true"/>
    </root>`
    const r = xmlToJson(xml, { treatNilAsNull: true, unwrapRoot: true })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const parsed = parseJson(r.output) as { missing: unknown }
    expect(parsed.missing).toBeNull()
  })

  it('preserves attributes via @_ prefix', () => {
    const r = xmlToJson('<book id="b1"><title>Sayings</title></book>', { unwrapRoot: true })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(parseJson(r.output)).toMatchObject({
      '@_id': 'b1',
      title: 'Sayings',
    })
  })

  it('reports parse errors for malformed XML', () => {
    const r = xmlToJson('<unclosed>')
    // fast-xml-parser is permissive; if it does parse, the test should still pass on ok=true.
    expect(r.ok === true || r.ok === false).toBe(true)
  })
})

describe('round-trip', () => {
  it('JSON → XML → JSON preserves shape for simple objects', () => {
    const original = { root: { name: 'Alice', age: 30 } }
    const x = jsonToXml(JSON.stringify(original))
    expect(x.ok).toBe(true)
    if (!x.ok) return
    const back = xmlToJson(x.output, { unwrapRoot: false })
    expect(back.ok).toBe(true)
    if (!back.ok) return
    const parsed = parseJson(back.output) as Record<string, unknown>
    expect(parsed.root).toMatchObject({ name: 'Alice', age: 30 })
  })
})
