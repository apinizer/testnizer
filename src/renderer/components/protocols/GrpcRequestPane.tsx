import { useState } from 'react'
import {
  Upload,
  Play,
  Lock,
  Unlock,
  ChevronDown,
  ChevronRight,
  Settings2,
} from 'lucide-react'
import { useGrpcStore } from '../../stores/grpc.store'
import type { GrpcMethodType } from '../../stores/grpc.store'
import MonacoWrapper from '../shared/MonacoWrapper'
import KeyValueTable from '../shared/KeyValueTable'

const METHOD_TYPE_COLORS: Record<GrpcMethodType, { bg: string; color: string; label: string }> = {
  unary: { bg: '#e8f4ff', color: '#0066cc', label: 'Unary' },
  server_streaming: { bg: '#e8f9f1', color: '#1a7a4a', label: 'Server Stream' },
  client_streaming: { bg: '#fff4e0', color: '#b35a00', label: 'Client Stream' },
  bidi_streaming: { bg: '#f0ecff', color: '#5b52d4', label: 'Bidi Stream' },
}

export default function GrpcRequestPane() {
  const address = useGrpcStore((s) => s.address)
  const setAddress = useGrpcStore((s) => s.setAddress)
  const useTls = useGrpcStore((s) => s.useTls)
  const setUseTls = useGrpcStore((s) => s.setUseTls)
  const protoLoaded = useGrpcStore((s) => s.protoLoaded)
  const protoPath = useGrpcStore((s) => s.protoPath)
  const services = useGrpcStore((s) => s.services)
  const selectedService = useGrpcStore((s) => s.selectedService)
  const selectedMethod = useGrpcStore((s) => s.selectedMethod)
  const selectService = useGrpcStore((s) => s.selectService)
  const selectMethod = useGrpcStore((s) => s.selectMethod)
  const requestBody = useGrpcStore((s) => s.requestBody)
  const setRequestBody = useGrpcStore((s) => s.setRequestBody)
  const metadata = useGrpcStore((s) => s.metadata)
  const addMetadata = useGrpcStore((s) => s.addMetadata)
  const updateMetadata = useGrpcStore((s) => s.updateMetadata)
  const removeMetadata = useGrpcStore((s) => s.removeMetadata)
  const isLoading = useGrpcStore((s) => s.isLoading)
  const isStreaming = useGrpcStore((s) => s.isStreaming)
  const errorMessage = useGrpcStore((s) => s.errorMessage)
  const loadProto = useGrpcStore((s) => s.loadProto)
  const execute = useGrpcStore((s) => s.execute)
  const cancelStream = useGrpcStore((s) => s.cancelStream)
  const getSelectedMethod = useGrpcStore((s) => s.getSelectedMethod)

  const [metadataExpanded, setMetadataExpanded] = useState(false)
  const currentMethod = getSelectedMethod()
  const methodType = currentMethod?.type
  const methodTypeInfo = methodType ? METHOD_TYPE_COLORS[methodType] : null
  const enabledMetaCount = metadata.filter((m) => m.enabled && m.key.trim()).length

  return (
    <div className="flex h-full flex-col overflow-hidden bg-[var(--white)]">
      {/* Tab bar label */}
      <div className="flex shrink-0 items-center gap-2 border-b border-[var(--border)] bg-[var(--white)] px-3.5 py-2">
        <span className="text-[0.875rem] font-medium" style={{ color: 'var(--accent-text)' }}>
          gRPC
        </span>
        {methodTypeInfo && (
          <span
            className="rounded-full px-2 py-0.5 text-[0.875rem] font-medium"
            style={{ background: methodTypeInfo.bg, color: methodTypeInfo.color }}
          >
            {methodTypeInfo.label}
          </span>
        )}
      </div>

      {/* Scrollable content */}
      <div className="flex-1 space-y-3 overflow-y-auto p-3.5">
        {/* Server address + TLS */}
        <div className="space-y-2">
          <label className="text-[0.875rem] font-medium text-[var(--muted)]">Server Address</label>
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="localhost:50051"
              className="flex-1 rounded-lg border border-[var(--border)] bg-[var(--white)] px-3 py-2 font-mono text-sm text-[var(--text)] outline-none transition-colors placeholder:text-[var(--hint)] focus:border-[var(--accent)]"
            />

            {/* TLS toggle */}
            <button
              type="button"
              onClick={() => setUseTls(!useTls)}
              className="flex shrink-0 cursor-pointer items-center gap-1.5 rounded-lg border px-2.5 py-2 text-[0.875rem] font-medium transition-colors"
              style={{
                borderColor: useTls ? '#1a7a4a' : 'var(--border)',
                background: useTls ? '#e8f9f1' : 'transparent',
                color: useTls ? '#1a7a4a' : 'var(--muted)',
              }}
            >
              {useTls ? <Lock size={12} /> : <Unlock size={12} />}
              TLS
            </button>

            {/* Load Proto */}
            <button
              type="button"
              onClick={loadProto}
              disabled={isLoading}
              className="flex shrink-0 cursor-pointer items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium text-white transition-opacity disabled:cursor-not-allowed disabled:opacity-50"
              style={{ background: 'var(--accent)', border: 'none' }}
            >
              <Upload size={13} />
              {isLoading && !protoLoaded ? 'Loading...' : 'Load Proto'}
            </button>
          </div>
        </div>

        {/* Proto path indicator */}
        {protoPath && (
          <div className="flex items-center gap-2 rounded-lg bg-[var(--surface)] px-3 py-1.5">
            <span className="text-[0.875rem] text-[var(--muted)]">Proto:</span>
            <span className="truncate font-mono text-[0.875rem] text-[var(--text)]">{protoPath}</span>
          </div>
        )}

        {/* Error message */}
        {errorMessage && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">
            {errorMessage}
          </div>
        )}

        {/* Service & Method dropdowns */}
        {protoLoaded && (
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="mb-1 block text-[0.875rem] font-medium text-[var(--muted)]">Service</label>
              <select
                value={selectedService || ''}
                onChange={(e) => selectService(e.target.value)}
                className="w-full rounded-lg border border-[var(--border)] bg-[var(--white)] px-3 py-2 text-sm text-[var(--text)] outline-none focus:border-[var(--accent)]"
              >
                {services.map((svc) => (
                  <option key={svc.name} value={svc.name}>
                    {svc.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-[0.875rem] font-medium text-[var(--muted)]">Method</label>
              <select
                value={selectedMethod || ''}
                onChange={(e) => selectMethod(e.target.value)}
                className="w-full rounded-lg border border-[var(--border)] bg-[var(--white)] px-3 py-2 text-sm text-[var(--text)] outline-none focus:border-[var(--accent)]"
              >
                {(services.find((s) => s.name === selectedService)?.methods || []).map((m) => (
                  <option key={m.name} value={m.name}>
                    {m.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
        )}

        {/* Request body */}
        {protoLoaded && (
          <div>
            <label className="mb-1 block text-[0.875rem] font-medium text-[var(--muted)]">
              Request Message (JSON)
            </label>
            <div className="overflow-hidden rounded-lg border border-[var(--border)]">
              <MonacoWrapper
                value={requestBody}
                onChange={setRequestBody}
                language="json"
                height="200px"
              />
            </div>
          </div>
        )}

        {/* Metadata (collapsible) */}
        {protoLoaded && (
          <div className="rounded-lg border border-[var(--border)]">
            <button
              type="button"
              onClick={() => setMetadataExpanded((v) => !v)}
              className="flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-left text-sm font-medium text-[var(--text)] transition-colors hover:bg-[var(--surface)]"
              style={{ background: 'transparent', border: 'none' }}
            >
              {metadataExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              <Settings2 size={14} className="text-[var(--muted)]" />
              <span>Metadata</span>
              {enabledMetaCount > 0 && (
                <span
                  className="ml-1 rounded-full px-[5px] text-[0.875rem]"
                  style={{ background: 'var(--green-bg)', color: 'var(--green)' }}
                >
                  {enabledMetaCount}
                </span>
              )}
            </button>
            {metadataExpanded && (
              <div className="border-t border-[var(--border)] p-3">
                <KeyValueTable
                  rows={metadata}
                  onUpdate={updateMetadata}
                  onRemove={removeMetadata}
                  onAdd={addMetadata}
                  addLabel="+ Add Metadata"
                />
              </div>
            )}
          </div>
        )}

        {/* Execute / Cancel button */}
        {protoLoaded && (
          <div>
            {isStreaming ? (
              <button
                type="button"
                onClick={cancelStream}
                className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-lg py-2.5 text-sm font-medium text-white transition-opacity"
                style={{ background: '#cc2200', border: 'none' }}
              >
                Cancel Stream
              </button>
            ) : (
              <button
                type="button"
                onClick={execute}
                disabled={isLoading || !selectedService || !selectedMethod}
                className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-lg py-2.5 text-sm font-medium text-white transition-opacity disabled:cursor-not-allowed disabled:opacity-50"
                style={{ background: 'var(--accent)', border: 'none' }}
              >
                <Play size={14} />
                {isLoading ? 'Calling...' : 'Execute'}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
