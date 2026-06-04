import { useSoapStore } from '../../stores/soap.store'

export default function SoapOperationSelector() {
  const parsedWsdl = useSoapStore((s) => s.parsedWsdl)
  const selectedService = useSoapStore((s) => s.selectedService)
  const selectedPort = useSoapStore((s) => s.selectedPort)
  const selectedOperation = useSoapStore((s) => s.selectedOperation)
  const selectService = useSoapStore((s) => s.selectService)
  const selectPort = useSoapStore((s) => s.selectPort)
  const selectOperation = useSoapStore((s) => s.selectOperation)
  const endpointUrl = useSoapStore((s) => s.endpointUrl)
  const setEndpointUrl = useSoapStore((s) => s.setEndpointUrl)

  if (!parsedWsdl) return null

  const services = parsedWsdl.services
  const currentService = services.find((s) => s.name === selectedService)
  const ports = currentService?.ports || []
  const currentPort = ports.find((p) => p.name === selectedPort)
  const operations = currentPort?.operations || []

  return (
    <div className="space-y-3">
      <label className="font-medium uppercase tracking-widest text-[var(--muted)]">
        Service Configuration
      </label>
      <div className="grid grid-cols-3 gap-3">
        {/* Service */}
        <div className="space-y-1">
          <span className="text-[var(--muted)]">Service</span>
          <select
            value={selectedService || ''}
            onChange={(e) => selectService(e.target.value)}
            className="w-full cursor-pointer rounded-lg border border-[var(--border)] bg-[var(--white)] px-2.5 py-1.5 text-[var(--text)] outline-none focus:border-[var(--accent)]"
          >
            {services.map((svc) => (
              <option key={svc.name} value={svc.name}>
                {svc.name}
              </option>
            ))}
          </select>
        </div>

        {/* Port */}
        <div className="space-y-1">
          <span className="text-[var(--muted)]">Port</span>
          <select
            value={selectedPort || ''}
            onChange={(e) => selectPort(e.target.value)}
            className="w-full cursor-pointer rounded-lg border border-[var(--border)] bg-[var(--white)] px-2.5 py-1.5 text-[var(--text)] outline-none focus:border-[var(--accent)]"
          >
            {ports.map((port) => (
              <option key={port.name} value={port.name}>
                {port.name}
              </option>
            ))}
          </select>
        </div>

        {/* Operation */}
        <div className="space-y-1">
          <span className="text-[var(--muted)]">Operation</span>
          <select
            value={selectedOperation || ''}
            onChange={(e) => selectOperation(e.target.value)}
            className="w-full cursor-pointer rounded-lg border border-[var(--border)] bg-[var(--white)] px-2.5 py-1.5 text-[var(--text)] outline-none focus:border-[var(--accent)]"
          >
            {operations.map((op) => (
              <option key={op.name} value={op.name}>
                {op.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Endpoint URL — editable */}
      {currentPort && (
        <div className="space-y-1">
          <span className="text-[var(--muted)]">Endpoint URL</span>
          <input
            type="text"
            value={endpointUrl || currentPort.endpointUrl}
            onChange={(e) => setEndpointUrl(e.target.value)}
            placeholder="https://example.com/services/Echo"
            className="w-full rounded-lg border border-[var(--border)] bg-[var(--white)] px-2.5 py-1.5 font-mono text-[var(--text)] outline-none focus:border-[var(--accent)]"
          />
        </div>
      )}
    </div>
  )
}
