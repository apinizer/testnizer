/**
 * #17 — A manual SOAP request must send its configured SOAP Action in the
 * transport-correct place per version:
 *   SOAP 1.1 → quoted `SOAPAction:` header + text/xml
 *   SOAP 1.2 → `action="…"` inside Content-Type (application/soap+xml), no
 *              SOAPAction header
 * Before the fix the action was component-local state that never reached the
 * request, so SOAPAction went out empty.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useSoapStore } from '../../src/renderer/stores/soap.store'
import { useEnvironmentStore } from '../../src/renderer/stores/environment.store'
import { useResponseStore } from '../../src/renderer/stores/response.store'
import { useTabsStore } from '../../src/renderer/stores/tabs.store'

type KV = { key: string; value: string; enabled: boolean }
let sendSpy: ReturnType<typeof vi.fn>

function header(payload: { headers?: KV[] }, key: string): string | undefined {
  return payload.headers?.find((h) => h.key.toLowerCase() === key.toLowerCase())?.value
}

beforeEach(() => {
  sendSpy = vi.fn(async () => ({
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
  useTabsStore.setState({ tabs: [], activeTabId: null })
  useSoapStore.setState({
    ...useSoapStore.getState(),
    parsedWsdl: null,
    selectedService: null,
    selectedPort: null,
    selectedOperation: null,
    rawXml: '<soapenv:Envelope/>',
    endpointUrl: 'http://www.dneonline.com/calculator.asmx',
    manualSoapAction: 'http://tempuri.org/Add',
    manualSoapVersion: 'soap11',
  })
})

describe('soap.store.sendSoap manual transport headers (#17)', () => {
  it('SOAP 1.1 → quoted SOAPAction header + text/xml', async () => {
    await useSoapStore.getState().sendSoap()
    expect(sendSpy).toHaveBeenCalledTimes(1)
    const payload = sendSpy.mock.calls[0][0] as { headers?: KV[] }
    expect(header(payload, 'Content-Type')).toBe('text/xml; charset=utf-8')
    expect(header(payload, 'SOAPAction')).toBe('"http://tempuri.org/Add"')
  })

  it('SOAP 1.2 → action="…" in Content-Type, no SOAPAction header', async () => {
    useSoapStore.setState({ ...useSoapStore.getState(), manualSoapVersion: 'soap12' })
    await useSoapStore.getState().sendSoap()
    const payload = sendSpy.mock.calls[0][0] as { headers?: KV[] }
    const ct = header(payload, 'Content-Type') ?? ''
    expect(ct).toContain('application/soap+xml')
    expect(ct).toContain('action="http://tempuri.org/Add"')
    expect(header(payload, 'SOAPAction')).toBeUndefined()
  })
})
