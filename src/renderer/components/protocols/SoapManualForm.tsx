import { useState } from 'react'
import { useSoapStore } from '../../stores/soap.store'

const INPUT =
  'w-full rounded-lg border border-[var(--border)] bg-[var(--white)] px-2.5 py-1.5 text-sm text-[var(--text)] outline-none focus:border-[var(--accent)]'

const LABEL = 'mb-1 block text-xs font-medium uppercase tracking-widest text-[var(--muted)]'

const SOAP11_NS = 'http://schemas.xmlsoap.org/soap/envelope/'
const SOAP12_NS = 'http://www.w3.org/2003/05/soap-envelope'

type SoapVersion = 'soap11' | 'soap12'

/**
 * Manual SOAP method form — for invoking a SOAP service without a WSDL.
 *
 * Captures the metadata needed to build a request: endpoint URL, SOAP
 * version, SOAPAction, operation name and namespace. "Generate Envelope"
 * writes a minimal envelope template to the Body sub-tab where the user
 * fine-tunes the actual XML payload.
 */
export default function SoapManualForm() {
  const endpointUrl = useSoapStore((s) => s.endpointUrl)
  const setEndpointUrl = useSoapStore((s) => s.setEndpointUrl)
  const setRawXml = useSoapStore((s) => s.setRawXml)

  const [version, setVersion] = useState<SoapVersion>('soap11')
  const [soapAction, setSoapAction] = useState('')
  const [operationName, setOperationName] = useState('Echo')
  const [operationNamespace, setOperationNamespace] = useState('http://example.com/echo')

  function generateEnvelope(): string {
    const soapNs = version === 'soap12' ? SOAP12_NS : SOAP11_NS
    return [
      `<soap:Envelope xmlns:soap="${soapNs}" xmlns:tns="${operationNamespace}">`,
      '  <soap:Header/>',
      '  <soap:Body>',
      `    <tns:${operationName}>`,
      `      <!-- Replace with request payload, e.g. <tns:Param>value</tns:Param> -->`,
      `    </tns:${operationName}>`,
      '  </soap:Body>',
      '</soap:Envelope>',
    ].join('\n')
  }

  function handleGenerate() {
    setRawXml(generateEnvelope())
  }

  return (
    <div className="space-y-3">
      <div>
        <label className={LABEL}>Endpoint URL</label>
        <input
          type="text"
          value={endpointUrl}
          onChange={(e) => setEndpointUrl(e.target.value)}
          className={INPUT}
          placeholder="https://example.com/services/Echo"
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={LABEL}>SOAP Version</label>
          <select
            value={version}
            onChange={(e) => setVersion(e.target.value as SoapVersion)}
            className={`${INPUT} cursor-pointer`}
          >
            <option value="soap11">SOAP 1.1</option>
            <option value="soap12">SOAP 1.2</option>
          </select>
        </div>
        <div>
          <label className={LABEL}>SOAPAction</label>
          <input
            type="text"
            value={soapAction}
            onChange={(e) => setSoapAction(e.target.value)}
            className={INPUT}
            placeholder='e.g. "urn:Echo"'
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={LABEL}>Operation Name</label>
          <input
            type="text"
            value={operationName}
            onChange={(e) => setOperationName(e.target.value)}
            className={INPUT}
            placeholder="Echo"
          />
        </div>
        <div>
          <label className={LABEL}>Operation Namespace</label>
          <input
            type="text"
            value={operationNamespace}
            onChange={(e) => setOperationNamespace(e.target.value)}
            className={INPUT}
            placeholder="http://example.com/echo"
          />
        </div>
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={handleGenerate}
          className="rounded-lg px-4 py-2 text-sm font-medium text-white"
          style={{ background: 'var(--accent)', border: 'none' }}
        >
          Generate Envelope → Body
        </button>
        <span className="text-xs text-[var(--muted)]">
          Writes a SOAP envelope template into the Body tab
        </span>
      </div>
    </div>
  )
}
