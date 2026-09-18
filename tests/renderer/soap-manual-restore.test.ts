/**
 * Issue #124 — a SOAP request built in Manual mode must reopen with its
 * endpoint URL, operation name/namespace, body, SOAPAction and version in the
 * UI. snapshotProtocol never wrote the manual fields and the restore path
 * always fabricated a synthetic WSDL, so the Manual form and raw body came
 * back blank (while the HTTP-level url/body still made Send "work").
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { snapshotProtocol, restoreProtocolFromMetadata } from '../../src/renderer/lib/save-active-request'
import { useSoapStore } from '../../src/renderer/stores/soap.store'
import { useRequestStore } from '../../src/renderer/stores/request.store'
import { useTabsStore } from '../../src/renderer/stores/tabs.store'
import { useEnvironmentStore } from '../../src/renderer/stores/environment.store'
import { useResponseStore } from '../../src/renderer/stores/response.store'
import type { Tab } from '../../src/renderer/types'

const ENVELOPE = '<soap:Envelope><soap:Body><tns:Echo/></soap:Body></soap:Envelope>'

const tab = { id: 'tab-soap', name: 'Echo', protocol: 'soap', savedRequestId: 'sr-1' } as Tab

function seedManualState(): void {
  useSoapStore.getState().switchToTab('tab-soap')
  useSoapStore.setState({
    ...useSoapStore.getState(),
    mode: 'manual',
    wsdlUrl: '',
    parsedWsdl: null,
    selectedService: null,
    selectedPort: null,
    selectedOperation: null,
    endpointUrl: 'https://svc.example/Echo',
    rawXml: ENVELOPE,
    manualSoapAction: 'urn:Echo',
    manualSoapVersion: 'soap12',
    manualOperationName: 'EchoString',
    manualOperationNamespace: 'http://svc.example/echo',
  })
}

function wipeSoapState(): void {
  useSoapStore.setState({
    ...useSoapStore.getState(),
    _tabStates: new Map(),
    _currentTabId: null,
    mode: 'wsdl',
    wsdlUrl: '',
    parsedWsdl: null,
    selectedOperation: null,
    endpointUrl: '',
    rawXml: '',
    manualSoapAction: '',
    manualSoapVersion: 'soap11',
    manualOperationName: 'Echo',
    manualOperationNamespace: 'http://example.com/echo',
  })
}

beforeEach(() => {
  useTabsStore.setState({ tabs: [{ ...tab, isDirty: false }], activeTabId: 'tab-soap' })
  useRequestStore.setState({ ...useRequestStore.getState(), url: '', body: { type: 'none' } })
})

describe('SOAP manual mode save → reopen (issue #124)', () => {
  it('snapshotProtocol writes the manual fields into metadata', () => {
    seedManualState()
    const snap = snapshotProtocol(tab)
    expect(snap.effectiveUrl).toBe('https://svc.example/Echo')
    expect(snap.effectiveBody).toEqual({ type: 'xml', content: ENVELOPE })
    const soap = (snap.protocolMeta as { soap: Record<string, unknown> }).soap
    expect(soap).toMatchObject({
      mode: 'manual',
      endpointUrl: 'https://svc.example/Echo',
      rawXml: ENVELOPE,
      manualSoapAction: 'urn:Echo',
      manualSoapVersion: 'soap12',
      manualOperationName: 'EchoString',
      manualOperationNamespace: 'http://svc.example/echo',
    })
  })

  it('round-trips: restore shows every manual field and does NOT fabricate a WSDL', () => {
    seedManualState()
    const snap = snapshotProtocol(tab)
    wipeSoapState()
    // Callers hydrate the request store first (what the row's url/body hold).
    useRequestStore.setState({
      ...useRequestStore.getState(),
      url: snap.effectiveUrl,
      body: snap.effectiveBody as never,
    })

    restoreProtocolFromMetadata('soap', snap.protocolMeta)

    const s = useSoapStore.getState()
    expect(s.mode).toBe('manual')
    expect(s.parsedWsdl).toBeNull()
    expect(s.endpointUrl).toBe('https://svc.example/Echo')
    expect(s.rawXml).toBe(ENVELOPE)
    expect(s.manualSoapAction).toBe('urn:Echo')
    expect(s.manualSoapVersion).toBe('soap12')
    expect(s.manualOperationName).toBe('EchoString')
    expect(s.manualOperationNamespace).toBe('http://svc.example/echo')
    // Reopening a saved request must read as clean.
    expect(useTabsStore.getState().tabs[0].isDirty).toBe(false)
  })

  it('legacy rows (no mode / manual fields) fall back to the request-store url + body', () => {
    wipeSoapState()
    useRequestStore.setState({
      ...useRequestStore.getState(),
      url: 'https://legacy.example/Calc',
      body: { type: 'xml', content: '<legacy/>' },
    })
    // What snapshotProtocol wrote before this fix for a manual request.
    restoreProtocolFromMetadata('soap', {
      soap: {
        wsdlUrl: '',
        selectedService: null,
        selectedPort: null,
        selectedOperation: null,
        bodyMode: 'raw',
      },
    })
    const s = useSoapStore.getState()
    expect(s.mode).toBe('manual')
    expect(s.parsedWsdl).toBeNull()
    expect(s.endpointUrl).toBe('https://legacy.example/Calc')
    expect(s.rawXml).toBe('<legacy/>')
  })

  it('WSDL-mode rows still restore through the synthetic-WSDL branch with the body', () => {
    wipeSoapState()
    useRequestStore.setState({
      ...useRequestStore.getState(),
      url: 'https://wsdl.example/svc',
      body: { type: 'xml', content: '<fromWsdl/>' },
    })
    restoreProtocolFromMetadata('soap', {
      soap: {
        wsdlUrl: 'https://wsdl.example/svc?wsdl',
        selectedService: 'CalcService',
        selectedPort: 'CalcPort',
        selectedOperation: 'Add',
        bodyMode: 'raw',
      },
    })
    const s = useSoapStore.getState()
    expect(s.mode).toBe('wsdl')
    expect(s.parsedWsdl).not.toBeNull()
    expect(s.selectedOperation).toBe('Add')
    expect(s.endpointUrl).toBe('https://wsdl.example/svc')
    expect(s.rawXml).toBe('<fromWsdl/>')
  })

  it('sendSoap in manual mode targets the manual Endpoint URL even if a WSDL is loaded', async () => {
    const sendSpy = vi.fn(async () => ({
      success: true,
      data: { requestId: 'r', protocol: 'soap', status: 200, timing: { total: 1 } },
    }))
    ;(globalThis as unknown as { window: { api: unknown } }).window = {
      api: { request: { send: sendSpy, cancel: vi.fn() } },
    }
    useEnvironmentStore.setState({
      ...useEnvironmentStore.getState(),
      environments: [],
      globalVariables: [],
      activeEnvironmentId: null,
    })
    useResponseStore.setState({ response: null, isLoading: false })
    seedManualState()
    useSoapStore.setState({
      ...useSoapStore.getState(),
      parsedWsdl: {
        services: [{ name: 'S', ports: [{ name: 'P', endpointUrl: 'https://other.example/x', operations: [] }] }],
        endpointUrl: 'https://other.example/x',
        soapVersion: 'soap11',
        rawWsdl: '',
      },
      selectedService: 'S',
      selectedPort: 'P',
    })
    await useSoapStore.getState().sendSoap()
    const payload = sendSpy.mock.calls[0][0] as { url: string }
    expect(payload.url).toBe('https://svc.example/Echo')
  })
})
