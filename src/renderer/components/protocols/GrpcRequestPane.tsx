import { useState } from 'react'
import {
  Upload,
  Play,
  Lock,
  Unlock,
  ChevronDown,
  ChevronRight,
  Settings2,
  Globe,
  RefreshCw,
  FileCode2,
} from 'lucide-react'
import { useGrpcStore } from '../../stores/grpc.store'
import type { GrpcMethodType } from '../../stores/grpc.store'
import MonacoWrapper from '../shared/MonacoWrapper'
import KeyValueTable from '../shared/KeyValueTable'
import { useTranslation } from '../../lib/i18n'

const METHOD_TYPE_COLORS: Record<GrpcMethodType, { bg: string; color: string; label: string }> = {
  unary: { bg: '#e8f4ff', color: '#0066cc', label: 'Unary' },
  server_streaming: { bg: '#e8f9f1', color: '#1a7a4a', label: 'Server Stream' },
  client_streaming: { bg: '#fff4e0', color: '#b35a00', label: 'Client Stream' },
  bidi_streaming: { bg: '#f0ecff', color: '#5b52d4', label: 'Bidi Stream' },
}

export default function GrpcRequestPane() {
  const { t } = useTranslation()

  const address = useGrpcStore((s) => s.address)
  const setAddress = useGrpcStore((s) => s.setAddress)
  const useTls = useGrpcStore((s) => s.useTls)
  const setUseTls = useGrpcStore((s) => s.setUseTls)
  const protoSource = useGrpcStore((s) => s.protoSource)
  const setProtoSource = useGrpcStore((s) => s.setProtoSource)
  const protoUrl = useGrpcStore((s) => s.protoUrl)
  const setProtoUrl = useGrpcStore((s) => s.setProtoUrl)
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
  const halfClosed = useGrpcStore((s) => s.halfClosed)
  const errorMessage = useGrpcStore((s) => s.errorMessage)
  const loadProto = useGrpcStore((s) => s.loadProto)
  const loadProtoFromUrl = useGrpcStore((s) => s.loadProtoFromUrl)
  const loadFromReflection = useGrpcStore((s) => s.loadFromReflection)
  const execute = useGrpcStore((s) => s.execute)
  const cancelStream = useGrpcStore((s) => s.cancelStream)
  const cancelUnary = useGrpcStore((s) => s.cancelUnary)
  const endClientStream = useGrpcStore((s) => s.endClientStream)
  const getSelectedMethod = useGrpcStore((s) => s.getSelectedMethod)

  const [metadataExpanded, setMetadataExpanded] = useState(false)
  const [defExpanded, setDefExpanded] = useState(true)
  const currentMethod = getSelectedMethod()
  const methodType = currentMethod?.type
  const methodTypeInfo = methodType ? METHOD_TYPE_COLORS[methodType] : null
  const enabledMetaCount = metadata.filter((m) => m.enabled && m.key.trim()).length

  function triggerLoadFromCurrentSource(): void {
    if (protoSource === 'reflection') loadFromReflection()
    else if (protoSource === 'url') loadProtoFromUrl()
    else loadProto()
  }

  return (
    <div className="flex h-full flex-col overflow-hidden bg-[var(--white)]">
      {/* Tab bar label */}
      <div className="flex shrink-0 items-center gap-2 border-b border-[var(--border)] bg-[var(--white)] px-3.5 py-2">
        <span className="font-medium" style={{ color: 'var(--accent-text)' }}>
          gRPC
        </span>
        {methodTypeInfo && (
          <span
            className="rounded-full px-2 py-0.5 font-medium"
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
          <label className="font-medium text-[var(--muted)]">{t('grpc.serverAddress')}</label>
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              data-testid="grpc-address"
              placeholder={t('grpc.serverAddressPlaceholder')}
              className="flex-1 rounded-lg border border-[var(--border)] bg-[var(--white)] px-3 py-2 font-mono text-[var(--text)] outline-none transition-colors placeholder:text-[var(--hint)] focus:border-[var(--accent)]"
            />

            {/* TLS toggle */}
            <button
              type="button"
              onClick={() => setUseTls(!useTls)}
              className="flex shrink-0 cursor-pointer items-center gap-1.5 rounded-lg border px-2.5 py-2 font-medium transition-colors"
              style={{
                borderColor: useTls ? '#1a7a4a' : 'var(--border)',
                background: useTls ? '#e8f9f1' : 'transparent',
                color: useTls ? '#1a7a4a' : 'var(--muted)',
              }}
            >
              {useTls ? <Lock size={12} /> : <Unlock size={12} />}
              {t('grpc.tls')}
            </button>
          </div>
        </div>

        {/* Service definition (3 ways) */}
        <div className="rounded-lg border border-[var(--border)]">
          <button
            type="button"
            onClick={() => setDefExpanded((v) => !v)}
            className="flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-left font-medium text-[var(--text)] transition-colors hover:bg-[var(--surface)]"
            style={{ background: 'transparent', border: 'none' }}
          >
            {defExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            <span>{t('grpc.protoSource.title')}</span>
            {protoLoaded && (
              <span
                className="ml-auto rounded-full px-2 py-0.5 font-medium"
                style={{ background: 'var(--green-bg)', color: 'var(--green)' }}
              >
                {t('grpc.protoLoaded')}
              </span>
            )}
          </button>

          {defExpanded && (
            <div className="space-y-3 border-t border-[var(--border)] p-3">
              {/* Source selector — radio buttons */}
              <div className="grid grid-cols-3 gap-2">
                <SourceTile
                  active={protoSource === 'reflection'}
                  icon={<RefreshCw size={14} />}
                  label={t('grpc.protoSource.reflection')}
                  onClick={() => setProtoSource('reflection')}
                />
                <SourceTile
                  active={protoSource === 'url'}
                  icon={<Globe size={14} />}
                  label={t('grpc.protoSource.url')}
                  onClick={() => setProtoSource('url')}
                />
                <SourceTile
                  active={protoSource === 'file'}
                  icon={<FileCode2 size={14} />}
                  label={t('grpc.protoSource.file')}
                  onClick={() => setProtoSource('file')}
                />
              </div>

              {/* Source-specific input */}
              {protoSource === 'reflection' && (
                <div className="text-[var(--muted)]">{t('grpc.protoSource.reflectionDesc')}</div>
              )}
              {protoSource === 'url' && (
                <input
                  type="text"
                  value={protoUrl}
                  onChange={(e) => setProtoUrl(e.target.value)}
                  placeholder={t('grpc.protoSource.urlPlaceholder')}
                  className="w-full rounded-lg border border-[var(--border)] bg-[var(--white)] px-3 py-2 font-mono text-[var(--text)] outline-none transition-colors placeholder:text-[var(--hint)] focus:border-[var(--accent)]"
                />
              )}
              {protoSource === 'file' && (
                <div className="text-[var(--muted)]">{t('grpc.protoSource.fileDesc')}</div>
              )}

              {/* Load action */}
              <button
                type="button"
                onClick={triggerLoadFromCurrentSource}
                disabled={isLoading}
                className="flex cursor-pointer items-center gap-1.5 rounded-lg px-3 py-2 font-medium text-white transition-opacity disabled:cursor-not-allowed disabled:opacity-50"
                style={{ background: 'var(--accent)', border: 'none' }}
              >
                <Upload size={13} />
                {isLoading
                  ? '...'
                  : protoSource === 'reflection'
                    ? t('grpc.useReflection')
                    : protoSource === 'url'
                      ? t('grpc.loadFromUrl')
                      : t('grpc.loadFromFile')}
              </button>
            </div>
          )}
        </div>

        {/* Proto path indicator */}
        {protoPath && (
          <div className="flex items-center gap-2 rounded-lg bg-[var(--surface)] px-3 py-1.5">
            <span className="text-[var(--muted)]">Proto:</span>
            <span className="truncate font-mono text-[var(--text)]">{protoPath}</span>
          </div>
        )}

        {/* Error message */}
        {errorMessage && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-red-600">
            {errorMessage}
          </div>
        )}

        {/* How-to guide when nothing is loaded yet */}
        {!protoLoaded && !errorMessage && (
          <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-sm text-[var(--muted)]">
            <p className="mb-1 font-semibold text-[var(--text)]">{t('grpc.guide.title')}</p>
            <ol className="list-inside list-decimal space-y-1">
              <li>{t('grpc.guide.step1').replace('{address}', 'demo.connectrpc.com:443')}</li>
              <li>{t('grpc.guide.step2')}</li>
              <li>{t('grpc.guide.step3')}</li>
              <li>{t('grpc.guide.step4')}</li>
            </ol>
            <p className="mt-2 text-xs text-[var(--hint)]">
              {t('grpc.guide.demo')}: <span className="font-mono">demo.connectrpc.com:443</span>
              {' · '}
              <a
                href="https://github.com/connectrpc/examples-go/blob/main/proto/connectrpc/eliza/v1/eliza.proto"
                className="underline"
              >
                eliza.proto
              </a>
            </p>
          </div>
        )}

        {/* Service & Method dropdowns */}
        {protoLoaded && services.length > 0 && (
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="mb-1 block font-medium text-[var(--muted)]">
                {t('grpc.service')}
              </label>
              <select
                value={selectedService || ''}
                onChange={(e) => selectService(e.target.value)}
                className="w-full rounded-lg border border-[var(--border)] bg-[var(--white)] px-3 py-2 text-[var(--text)] outline-none focus:border-[var(--accent)]"
              >
                {services.map((svc) => (
                  <option key={svc.name} value={svc.name}>
                    {svc.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block font-medium text-[var(--muted)]">
                {t('grpc.method')}
              </label>
              <select
                value={selectedMethod || ''}
                onChange={(e) => selectMethod(e.target.value)}
                className="w-full rounded-lg border border-[var(--border)] bg-[var(--white)] px-3 py-2 text-[var(--text)] outline-none focus:border-[var(--accent)]"
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
            <label className="mb-1 block font-medium text-[var(--muted)]">
              {t('grpc.requestMessage')}
            </label>
            <div
              className="overflow-hidden rounded-lg border border-[var(--border)]"
              data-testid="grpc-request-editor"
            >
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
              className="flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-left font-medium text-[var(--text)] transition-colors hover:bg-[var(--surface)]"
              style={{ background: 'transparent', border: 'none' }}
            >
              {metadataExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              <Settings2 size={14} className="text-[var(--muted)]" />
              <span>{t('grpc.metadata')}</span>
              {enabledMetaCount > 0 && (
                <span
                  className="ml-1 rounded-full px-[5px]"
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
              // Bidi / client-stream: keep Send live so the user can push more
              // messages, plus an "End Streaming" half-close and a Cancel.
              // Server-stream: only Cancel makes sense (no client writes).
              methodType === 'bidi_streaming' || methodType === 'client_streaming' ? (
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={execute}
                    disabled={!selectedService || !selectedMethod || halfClosed}
                    title={halfClosed ? t('grpc.streamHalfClosed') : undefined}
                    className="flex flex-1 cursor-pointer items-center justify-center gap-2 rounded-lg py-2.5 font-medium text-white transition-opacity disabled:cursor-not-allowed disabled:opacity-50"
                    style={{ background: 'var(--accent)', border: 'none' }}
                  >
                    <Play size={14} />
                    {t('grpc.send')}
                  </button>
                  <button
                    type="button"
                    onClick={endClientStream}
                    disabled={halfClosed}
                    className="flex cursor-pointer items-center justify-center gap-2 rounded-lg border px-3 py-2.5 font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50"
                    style={{
                      borderColor: 'var(--border)',
                      background: 'transparent',
                      color: 'var(--text)',
                    }}
                  >
                    {t('grpc.endStreaming')}
                  </button>
                  <button
                    type="button"
                    onClick={cancelStream}
                    className="flex cursor-pointer items-center justify-center gap-2 rounded-lg py-2.5 px-3 font-medium text-white transition-opacity"
                    style={{ background: '#cc2200', border: 'none' }}
                  >
                    {t('grpc.cancelStream')}
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={cancelStream}
                  className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-lg py-2.5 font-medium text-white transition-opacity"
                  style={{ background: '#cc2200', border: 'none' }}
                >
                  {t('grpc.cancelStream')}
                </button>
              )
            ) : (
              <button
                type="button"
                onClick={() => (isLoading ? cancelUnary() : execute())}
                disabled={!isLoading && (!selectedService || !selectedMethod)}
                data-testid="grpc-execute"
                className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-lg py-2.5 font-medium text-white transition-opacity disabled:cursor-not-allowed disabled:opacity-50"
                style={{
                  background: isLoading ? '#cc2200' : 'var(--accent)',
                  border: 'none',
                }}
              >
                <Play size={14} />
                {isLoading ? t('grpc.cancel') : t('grpc.execute')}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
function SourceTile({
  active,
  icon,
  label,
  onClick,
}: {
  active: boolean
  icon: React.ReactNode
  label: string
  onClick: () => void
}): React.ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex cursor-pointer items-center justify-center gap-1.5 rounded-lg border px-3 py-2 font-medium transition-colors"
      style={{
        borderColor: active ? 'var(--accent)' : 'var(--border)',
        background: active ? 'var(--accent-light)' : 'transparent',
        color: active ? 'var(--accent-text)' : 'var(--muted)',
      }}
    >
      {icon}
      <span className="truncate">{label}</span>
    </button>
  )
}
