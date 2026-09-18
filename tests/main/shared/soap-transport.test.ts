/**
 * src/shared/soap-transport.ts — ONE rule for SOAP → HTTP transport headers,
 * used by renderer Send and main-process Runner (issue #124 follow-up).
 */
import { describe, it, expect } from 'vitest'
import {
  soapTransportHeaders,
  soapTransportFromMeta,
  withSoapTransportHeaders,
} from '../../../src/shared/soap-transport'

describe('soapTransportHeaders', () => {
  it('SOAP 1.1 → text/xml + quoted SOAPAction', () => {
    expect(soapTransportHeaders('soap11', 'urn:Echo')).toEqual([
      { key: 'Content-Type', value: 'text/xml; charset=utf-8', enabled: true },
      { key: 'SOAPAction', value: '"urn:Echo"', enabled: true },
    ])
    expect(soapTransportHeaders(undefined, '')).toEqual([
      { key: 'Content-Type', value: 'text/xml; charset=utf-8', enabled: true },
      { key: 'SOAPAction', value: '""', enabled: true },
    ])
  })

  it('SOAP 1.2 → application/soap+xml with action parameter, no SOAPAction header', () => {
    expect(soapTransportHeaders('soap12', 'urn:Echo')).toEqual([
      {
        key: 'Content-Type',
        value: 'application/soap+xml; charset=utf-8; action="urn:Echo"',
        enabled: true,
      },
    ])
    expect(soapTransportHeaders('soap12', '')[0].value).toBe('application/soap+xml; charset=utf-8')
  })
})

describe('soapTransportFromMeta', () => {
  it('manual mode reads the manual form fields', () => {
    expect(
      soapTransportFromMeta({ mode: 'manual', manualSoapVersion: 'soap12', manualSoapAction: 'a' }),
    ).toEqual({ version: 'soap12', action: 'a' })
    expect(soapTransportFromMeta({ mode: 'manual' })).toEqual({ version: 'soap11', action: '' })
  })

  it('wsdl mode reads the operation fields; nothing usable → null', () => {
    expect(
      soapTransportFromMeta({ mode: 'wsdl', soapVersion: 'soap11', soapAction: 'urn:Op' }),
    ).toEqual({ version: 'soap11', action: 'urn:Op' })
    expect(soapTransportFromMeta({ mode: 'wsdl' })).toBeNull()
    expect(soapTransportFromMeta(null)).toBeNull()
    expect(soapTransportFromMeta(undefined)).toBeNull()
  })

  it('legacy rows without mode: no soapAction ⇒ manual', () => {
    expect(soapTransportFromMeta({ manualSoapVersion: 'soap12', manualSoapAction: 'x' })).toEqual({
      version: 'soap12',
      action: 'x',
    })
  })
})

describe('withSoapTransportHeaders', () => {
  it('prepends transport headers to the stored list', () => {
    const out = withSoapTransportHeaders(
      [{ key: 'X-Trace', value: '1', enabled: true }],
      'soap11',
      'urn:Echo',
    )
    expect(out.map((h) => h.key)).toEqual(['Content-Type', 'SOAPAction', 'X-Trace'])
  })

  it('respects user-supplied Content-Type / SOAPAction (case-insensitive), ignores disabled rows', () => {
    const out = withSoapTransportHeaders(
      [
        { key: 'content-type', value: 'text/xml; charset=iso-8859-9', enabled: true },
        { key: 'SOAPAction', value: '"old"', enabled: false },
      ],
      'soap11',
      'urn:New',
    )
    expect(out.filter((h) => h.key.toLowerCase() === 'content-type')).toHaveLength(1)
    expect(out.find((h) => h.key.toLowerCase() === 'content-type')?.value).toBe(
      'text/xml; charset=iso-8859-9',
    )
    // disabled SOAPAction row does not count as supplied → transport one added
    expect(out.filter((h) => h.key === 'SOAPAction' && h.enabled)).toHaveLength(1)
    expect(out.find((h) => h.key === 'SOAPAction' && h.enabled)?.value).toBe('"urn:New"')
  })
})
