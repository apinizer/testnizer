/**
 * Send ≡ Run for SOAP in WSDL mode (issue #124 follow-up). The Runner has no
 * WSDL: it can only send the right Content-Type / SOAPAction if the row's
 * `metadata.soap` carries the selected operation's action and the document's
 * version. `snapshotProtocol` used to write neither, so
 * `soapTransportFromMeta` returned null and the Runner posted plain XML.
 *
 * Also: a SOAP row with NO metadata at all (pre-metadata rows) opens on the
 * Manual form with the action/version recovered from its stored headers, not
 * on an empty WSDL editor.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { snapshotProtocol } from '../../src/renderer/lib/save-active-request'
import { soapTransportFromMeta, withSoapTransportHeaders } from '../../src/shared/soap-transport'
import { useSoapStore } from '../../src/renderer/stores/soap.store'
import type { Tab, WsdlParseResult } from '../../src/renderer/types'

const tab = { id: 'tab-wsdl', name: 'Echo', protocol: 'soap', savedRequestId: 'sr-2' } as Tab

const wsdl: WsdlParseResult = {
  services: [
    {
      name: 'EchoService',
      ports: [
        {
          name: 'EchoPort',
          endpointUrl: 'https://svc.example/Echo',
          operations: [
            {
              name: 'EchoString',
              soapAction: 'urn:svc:EchoString',
              inputSchema: {},
              outputSchema: {},
              exampleRequest: '<e/>',
              exampleResponse: '<r/>',
            },
          ],
        },
      ],
    },
  ],
  endpointUrl: 'https://svc.example/Echo',
  soapVersion: 'soap12',
  rawWsdl: '<definitions/>',
}

beforeEach(() => {
  useSoapStore.getState().switchToTab(tab.id)
  useSoapStore.setState({
    ...useSoapStore.getState(),
    mode: 'wsdl',
    wsdlUrl: 'https://svc.example/Echo?wsdl',
    parsedWsdl: wsdl,
    selectedService: 'EchoService',
    selectedPort: 'EchoPort',
    selectedOperation: 'EchoString',
    endpointUrl: 'https://svc.example/Echo',
    rawXml: '<e/>',
  })
})

describe('WSDL-mode snapshot feeds the Runner transport', () => {
  it('writes soapVersion + the selected operation soapAction into metadata.soap', () => {
    const snap = snapshotProtocol(tab)
    const soap = (snap.protocolMeta as { soap: Record<string, unknown> }).soap
    expect(soap.soapVersion).toBe('soap12')
    expect(soap.soapAction).toBe('urn:svc:EchoString')

    const transport = soapTransportFromMeta(soap as never)
    expect(transport).toEqual({ version: 'soap12', action: 'urn:svc:EchoString' })
    const headers = withSoapTransportHeaders([], transport!.version, transport!.action)
    expect(headers).toEqual([
      {
        key: 'Content-Type',
        value: 'application/soap+xml; charset=utf-8; action="urn:svc:EchoString"',
        enabled: true,
      },
    ])
  })
})

describe('SOAP row without any metadata', () => {
  it('opens on the Manual form and recovers action/version from its headers', () => {
    useSoapStore.getState().loadFromEndpoint({
      url: 'https://legacy.example/Svc',
      body: { type: 'xml', content: '<Envelope/>' },
      headers: [
        { key: 'Content-Type', value: 'text/xml; charset=utf-8', enabled: true },
        { key: 'SOAPAction', value: '"urn:legacy:Do"', enabled: true },
      ],
      soap: undefined,
    })
    const s = useSoapStore.getState()
    expect(s.mode).toBe('manual')
    expect(s.endpointUrl).toBe('https://legacy.example/Svc')
    expect(s.rawXml).toBe('<Envelope/>')
    expect(s.manualSoapAction).toBe('urn:legacy:Do')
    expect(s.manualSoapVersion).toBe('soap11')
  })

  it('recognises the SOAP 1.2 action parameter', () => {
    useSoapStore.getState().loadFromEndpoint({
      url: 'https://legacy.example/Svc',
      body: { type: 'xml', content: '<Envelope/>' },
      headers: [
        {
          key: 'content-type',
          value: 'application/soap+xml; charset=utf-8; action="urn:legacy:Do12"',
          enabled: true,
        },
      ],
      soap: undefined,
    })
    const s = useSoapStore.getState()
    expect(s.mode).toBe('manual')
    expect(s.manualSoapVersion).toBe('soap12')
    expect(s.manualSoapAction).toBe('urn:legacy:Do12')
  })
})
