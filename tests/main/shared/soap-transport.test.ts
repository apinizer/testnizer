/**
 * src/shared/soap-transport.ts — ONE rule for SOAP → HTTP transport headers,
 * used by renderer Send and main-process Runner (issue #124 follow-up).
 */
import { describe, it, expect } from 'vitest'
import {
  soapTransportHeaders,
  soapTransportFromMeta,
  soapTransportForRow,
  soapVersionAndAction,
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

// Issue #298 follow-up: the rule Send applies (`soapSendTarget`) and the
// Runner applies to a saved row are one function — never null.
describe('soapVersionAndAction', () => {
  it('a WSDL operation wins: the document version, the action (manual as fallback)', () => {
    expect(soapVersionAndAction({ op: { soapAction: 'urn:Op' }, wsdlVersion: 'soap12' })).toEqual({
      version: 'soap12',
      action: 'urn:Op',
    })
    expect(
      soapVersionAndAction({
        op: { soapAction: '' },
        manualSoapAction: 'urn:m',
        manualSoapVersion: 'soap12',
      }),
    ).toEqual({ version: 'soap11', action: 'urn:m' })
  })
  it('no operation → the manual form; defaults SOAP 1.1 + empty action', () => {
    expect(soapVersionAndAction({ manualSoapVersion: 'soap12', manualSoapAction: 'a' })).toEqual({
      version: 'soap12',
      action: 'a',
    })
    expect(soapVersionAndAction({})).toEqual({ version: 'soap11', action: '' })
  })
})

describe('soapTransportForRow', () => {
  it('WSDL meta without action / version → SOAP 1.1 + "" (soapTransportFromMeta gave null)', () => {
    expect(soapTransportFromMeta({ mode: 'wsdl' })).toBeNull()
    expect(soapTransportForRow({ mode: 'wsdl', selectedOperation: 'Add' }, [])).toEqual({
      version: 'soap11',
      action: '',
    })
  })
  it('WSDL meta → saved version + action; manual action as fallback', () => {
    expect(
      soapTransportForRow({ mode: 'wsdl', soapVersion: 'soap12', soapAction: 'urn:Op' }, []),
    ).toEqual({ version: 'soap12', action: 'urn:Op' })
    expect(soapTransportForRow({ mode: 'wsdl', manualSoapAction: 'urn:m' }, [])).toEqual({
      version: 'soap11',
      action: 'urn:m',
    })
  })
  it('legacy meta: no mode, an operation → WSDL rule; no WSDL / operation → manual rule', () => {
    expect(
      soapTransportForRow(
        { operationName: 'Add', soapAction: 'urn:Add', soapVersion: 'soap11' },
        [],
      ),
    ).toEqual({ version: 'soap11', action: 'urn:Add' })
    expect(soapTransportForRow({ manualSoapAction: 'x', manualSoapVersion: 'soap12' }, [])).toEqual(
      { version: 'soap12', action: 'x' },
    )
  })
  it('no meta → version / action read back from the stored headers', () => {
    expect(soapTransportForRow(undefined, [])).toEqual({ version: 'soap11', action: '' })
    expect(
      soapTransportForRow(undefined, [{ key: 'SOAPAction', value: '"urn:H"', enabled: true }]),
    ).toEqual({ version: 'soap11', action: 'urn:H' })
    expect(
      soapTransportForRow(undefined, [
        { key: 'Content-Type', value: 'application/soap+xml; action="urn:12"', enabled: true },
      ]),
    ).toEqual({ version: 'soap12', action: 'urn:12' })
  })
})
