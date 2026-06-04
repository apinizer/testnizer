import { describe, it, expect } from 'vitest'
import { formatXml, minifyXml } from '../../../src/renderer/lib/tools/xml-format'

describe('formatXml — pretty print', () => {
  it('formats single-line XML with default indent (2 spaces)', () => {
    const r = formatXml('<root><a>1</a><b>2</b></root>')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.output).toContain('<root>')
    expect(r.output).toContain('  <a>1</a>')
    expect(r.output).toContain('  <b>2</b>')
  })

  it('preserves XML declaration', () => {
    const r = formatXml('<?xml version="1.0" encoding="UTF-8"?><root/>')
    if (!r.ok) throw new Error()
    expect(r.output).toContain('<?xml')
    expect(r.output).toContain('version="1.0"')
  })

  it('preserves namespaces and prefixes', () => {
    const input =
      '<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body><foo/></soap:Body></soap:Envelope>'
    const r = formatXml(input)
    if (!r.ok) throw new Error()
    expect(r.output).toContain('soap:Envelope')
    expect(r.output).toContain('xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"')
  })

  it('preserves attributes', () => {
    const r = formatXml('<a x="1" y="2">v</a>')
    if (!r.ok) throw new Error()
    expect(r.output).toContain('x="1"')
    expect(r.output).toContain('y="2"')
  })

  it('preserves CDATA sections', () => {
    const r = formatXml('<a><![CDATA[<b/>raw]]></a>')
    if (!r.ok) throw new Error()
    expect(r.output).toContain('<![CDATA[')
    expect(r.output).toContain('<b/>raw')
  })

  it('preserves XML comments', () => {
    const r = formatXml('<root><!-- a comment --><a/></root>')
    if (!r.ok) throw new Error()
    expect(r.output).toContain('a comment')
  })

  it('handles deeply nested elements', () => {
    const r = formatXml('<a><b><c><d>x</d></c></b></a>')
    if (!r.ok) throw new Error()
    expect(r.output).toContain('      <d>x</d>')
  })

  it('indent 4', () => {
    const r = formatXml('<a><b>1</b></a>', { indent: 4 })
    if (!r.ok) throw new Error()
    expect(r.output).toContain('    <b>1</b>')
  })

  it('indent tab', () => {
    const r = formatXml('<a><b>1</b></a>', { indent: '\t' })
    if (!r.ok) throw new Error()
    expect(r.output).toContain('\t<b>')
  })

  it('handles UTF-8 (Türkçe)', () => {
    const r = formatXml('<isim>Yıldız</isim>')
    if (!r.ok) throw new Error()
    expect(r.output).toContain('Yıldız')
  })
})

describe('formatXml — minify', () => {
  it('removes whitespace between tags', () => {
    const r = formatXml('<a>\n  <b>1</b>\n  <c>2</c>\n</a>', { indent: 0 })
    if (!r.ok) throw new Error()
    expect(r.output).not.toContain('\n  ')
  })

  it('minifyXml() shorthand', () => {
    const r = minifyXml('<a>\n  <b/>\n</a>')
    if (!r.ok) throw new Error()
    expect(r.output).not.toContain('\n')
  })

  it('minify → format round-trip preserves data', () => {
    const original = '<root><a x="1">v</a><b/></root>'
    const min = formatXml(original, { indent: 0 })
    if (!min.ok) throw new Error()
    const pretty = formatXml(min.output, { indent: 2 })
    if (!pretty.ok) throw new Error()
    expect(pretty.output).toContain('<a x="1">v</a>')
  })
})

describe('formatXml — sortAttributes', () => {
  it('sorts attributes alphabetically when requested', () => {
    const r = formatXml('<a z="1" m="2" b="3"/>', { sortAttributes: true })
    if (!r.ok) throw new Error()
    const idxB = r.output.indexOf('b=')
    const idxM = r.output.indexOf('m=')
    const idxZ = r.output.indexOf('z=')
    expect(idxB).toBeLessThan(idxM)
    expect(idxM).toBeLessThan(idxZ)
  })

  it('preserves original attribute order by default', () => {
    const r = formatXml('<a z="1" m="2" b="3"/>')
    if (!r.ok) throw new Error()
    const idxZ = r.output.indexOf('z=')
    const idxM = r.output.indexOf('m=')
    const idxB = r.output.indexOf('b=')
    expect(idxZ).toBeLessThan(idxM)
    expect(idxM).toBeLessThan(idxB)
  })
})

describe('formatXml — error handling', () => {
  it('rejects empty input', () => {
    const r = formatXml('')
    expect(r.ok).toBe(false)
  })

  it('rejects whitespace-only input', () => {
    const r = formatXml('   \n\t')
    expect(r.ok).toBe(false)
  })

  it('rejects null input', () => {
    const r = formatXml(null as unknown as string)
    expect(r.ok).toBe(false)
  })

  it('rejects unclosed tag', () => {
    const r = formatXml('<a><b></a>')
    expect(r.ok).toBe(false)
  })

  it('rejects mismatched tag', () => {
    const r = formatXml('<a></b>')
    expect(r.ok).toBe(false)
  })

  it('reports line/column for invalid XML', () => {
    const r = formatXml('<a>\n<b\n')
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.line).toBeTypeOf('number')
  })
})
