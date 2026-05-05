import { describe, it, expect } from 'vitest'
import { evaluateXPath } from '../../../src/renderer/lib/tools/xpath'

const SAMPLE = `<?xml version="1.0"?>
<library>
  <book id="1">
    <title>Sayings</title>
    <author>Nigel Rees</author>
    <price>8.95</price>
  </book>
  <book id="2">
    <title>Moby Dick</title>
    <author>Herman Melville</author>
    <price>8.99</price>
  </book>
</library>`

const SOAP_SAMPLE = `<?xml version="1.0"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <ns:GetPrice xmlns:ns="urn:example">
      <ns:Symbol>AAPL</ns:Symbol>
    </ns:GetPrice>
  </soap:Body>
</soap:Envelope>`

describe('evaluateXPath — node selection', () => {
  it('selects all titles', () => {
    const r = evaluateXPath(SAMPLE, '//title')
    expect(r.ok).toBe(true)
    if (r.ok && r.kind === 'nodes') {
      expect(r.count).toBe(2)
      expect(r.values.join('|')).toContain('Sayings')
      expect(r.values.join('|')).toContain('Moby Dick')
    }
  })

  it('selects attribute', () => {
    const r = evaluateXPath(SAMPLE, '//book/@id')
    expect(r.ok).toBe(true)
    if (r.ok && r.kind === 'nodes') {
      expect(r.count).toBe(2)
    }
  })

  it('predicate filter', () => {
    const r = evaluateXPath(SAMPLE, "//book[author='Nigel Rees']/title")
    expect(r.ok).toBe(true)
    if (r.ok && r.kind === 'nodes') {
      expect(r.count).toBe(1)
      expect(r.values[0]).toContain('Sayings')
    }
  })
})

describe('evaluateXPath — typed results', () => {
  it('count() returns number', () => {
    const r = evaluateXPath(SAMPLE, 'count(//book)')
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.kind).toBe('number')
      if (r.kind === 'number') expect(r.value).toBe(2)
    }
  })

  it('boolean expression', () => {
    const r = evaluateXPath(SAMPLE, '//book/@id="1"')
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.kind).toBe('boolean')
  })

  it('string-valued expression', () => {
    const r = evaluateXPath(SAMPLE, 'string(//title)')
    expect(r.ok).toBe(true)
    if (r.ok && r.kind === 'string') {
      expect(r.value).toBe('Sayings')
    }
  })
})

describe('evaluateXPath — namespaces', () => {
  it('resolves SOAP namespace bindings', () => {
    const r = evaluateXPath(SOAP_SAMPLE, '//ns:Symbol', {
      ns: 'urn:example',
    })
    expect(r.ok).toBe(true)
    if (r.ok && r.kind === 'nodes') {
      expect(r.count).toBe(1)
      expect(r.values[0]).toContain('AAPL')
    }
  })

  it('SOAP body via combined namespaces', () => {
    const r = evaluateXPath(SOAP_SAMPLE, '/soap:Envelope/soap:Body', {
      soap: 'http://schemas.xmlsoap.org/soap/envelope/',
    })
    expect(r.ok).toBe(true)
    if (r.ok && r.kind === 'nodes') {
      expect(r.count).toBe(1)
    }
  })

  it('without namespace bindings, prefixed selectors do not match', () => {
    const r = evaluateXPath(SOAP_SAMPLE, '//ns:Symbol')
    // Implementation may surface this as either an XPath error or zero matches.
    if (r.ok && r.kind === 'nodes') {
      expect(r.count).toBe(0)
    } else {
      expect(r.ok).toBe(false)
    }
  })
})

describe('evaluateXPath — errors', () => {
  it('rejects empty expression', () => {
    expect(evaluateXPath(SAMPLE, '').ok).toBe(false)
  })

  it('rejects invalid XML', () => {
    const r = evaluateXPath('<a><b></a>', '//b')
    expect(r.ok).toBe(false)
  })

  it('rejects malformed XPath', () => {
    const r = evaluateXPath(SAMPLE, '////invalid[[')
    expect(r.ok).toBe(false)
  })
})
