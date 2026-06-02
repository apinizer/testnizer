/**
 * SOAP envelope generation (issue #16): the request body template must carry
 * the WSDL's real target namespace, not the hardcoded http://tempuri.org/
 * default — servers reject the wrong namespace.
 */
import { describe, it, expect } from 'vitest'
import { generateEnvelope } from '../../src/main/protocols/soap.engine'

describe('generateEnvelope — namespace (#16)', () => {
  it('uses the supplied operation namespace, not tempuri', () => {
    const xml = generateEnvelope(
      'NumberToWords',
      { ubiNum: '?' },
      'soap11',
      'http://www.dataaccess.com/webservicesserver/NumberToWords',
      'http://www.dataaccess.com/webservicesserver/',
    )
    expect(xml).toContain('xmlns:ns1="http://www.dataaccess.com/webservicesserver/"')
    expect(xml).not.toContain('tempuri.org')
    expect(xml).toContain('<ns1:NumberToWords>')
    expect(xml).toContain('<ns1:ubiNum>?</ns1:ubiNum>')
  })

  it('falls back to tempuri only when no namespace is known', () => {
    const xml = generateEnvelope('Echo', { msg: '?' }, 'soap11')
    expect(xml).toContain('xmlns:ns1="http://tempuri.org/"')
  })

  it('emits the SOAP 1.2 envelope namespace for soap12', () => {
    const xml = generateEnvelope('Add', { a: '?' }, 'soap12', '', 'http://x/')
    expect(xml).toContain('http://www.w3.org/2003/05/soap-envelope')
    expect(xml).toContain('xmlns:ns1="http://x/"')
  })

  it('indents nested body children consistently under <soap:Body>', () => {
    const xml = generateEnvelope('Op', { a: '1', b: '2' }, 'soap11', '', 'http://x/')
    // Every child element line is indented past <soap:Body> (no left-shift).
    for (const line of xml.split('\n')) {
      if (line.includes('<ns1:a>') || line.includes('<ns1:b>')) {
        expect(line.startsWith('      ')).toBe(true)
      }
    }
  })
})
