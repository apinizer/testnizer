import { useSoapStore } from '../../stores/soap.store'

export default function SoapOperationSelector() {
  const parsedWsdl = useSoapStore((s) => s.parsedWsdl)
  const selectedService = useSoapStore((s) => s.selectedService)
  const selectedPort = useSoapStore((s) => s.selectedPort)
  const selectedOperation = useSoapStore((s) => s.selectedOperation)
  const selectService = useSoapStore((s) => s.selectService)
  const selectPort = useSoapStore((s) => s.selectPort)
  const selectOperation = useSoapStore((s) => s.selectOperation)

  if (!parsedWsdl) return null

  const services = parsedWsdl.services
  const currentService = services.find((s) => s.name === selectedService)
  const ports = currentService?.ports || []
  const currentPort = ports.find((p) => p.name === selectedPort)
  const operations = currentPort?.operations || []

  return (
    <div className="space-y-3">
      <label className="text-[0.875rem] font-medium uppercase tracking-widest text-[var(--muted)]">
        Service Configuration
      </label>
      <div className="grid grid-cols-3 gap-3">
        {/* Service */}
        <div className="space-y-1">
          <span className="text-[0.875rem] text-[var(--muted)]">Service</span>
          <select
            value={selectedService || ''}
            onChange={(e) => selectService(e.target.value)}
            className="w-full cursor-pointer rounded-lg border border-[var(--border)] bg-[var(--white)] px-2.5 py-1.5 text-sm text-[var(--text)] outline-none focus:border-[var(--accent)]"
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
          <span className="text-[0.875rem] text-[var(--muted)]">Port</span>
          <select
            value={selectedPort || ''}
            onChange={(e) => selectPort(e.target.value)}
            className="w-full cursor-pointer rounded-lg border border-[var(--border)] bg-[var(--white)] px-2.5 py-1.5 text-sm text-[var(--text)] outline-none focus:border-[var(--accent)]"
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
          <span className="text-[0.875rem] text-[var(--muted)]">Operation</span>
          <select
            value={selectedOperation || ''}
            onChange={(e) => selectOperation(e.target.value)}
            className="w-full cursor-pointer rounded-lg border border-[var(--border)] bg-[var(--white)] px-2.5 py-1.5 text-sm text-[var(--text)] outline-none focus:border-[var(--accent)]"
          >
            {operations.map((op) => (
              <option key={op.name} value={op.name}>
                {op.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Endpoint URL display */}
      {currentPort && (
        <div className="flex items-center gap-2 rounded-lg bg-[var(--surface)] px-3 py-1.5">
          <span className="text-[0.875rem] font-medium uppercase text-[var(--hint)]">Endpoint</span>
          <span className="font-mono text-sm text-[var(--blue)]">{currentPort.endpointUrl}</span>
        </div>
      )}
    </div>
  )
}
