import { useState, useEffect, useRef } from 'react'
import { useGrpcStore } from '../../stores/grpc.store'
import { useResponseStore } from '../../stores/response.store'
import MonacoWrapper from '../shared/MonacoWrapper'

function formatTimestamp(ts: number): string {
  const d = new Date(ts)
  return (
    d.toLocaleTimeString('en-US', {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }) +
    '.' +
    String(d.getMilliseconds()).padStart(3, '0')
  )
}

function formatJson(str: string): string {
  try {
    return JSON.stringify(JSON.parse(str), null, 2)
  } catch {
    return str
  }
}

function truncate(str: string, max: number): string {
  return str.length > max ? str.slice(0, max) + '...' : str
}

export default function GrpcResponsePane() {
  const response = useResponseStore((s) => s.response)
  const isLoading = useResponseStore((s) => s.isLoading)
  const streamEvents = useGrpcStore((s) => s.streamEvents)
  const isStreaming = useGrpcStore((s) => s.isStreaming)
  const getSelectedMethod = useGrpcStore((s) => s.getSelectedMethod)
  const errorMessage = useGrpcStore((s) => s.errorMessage)

  const currentMethod = getSelectedMethod()
  const isStreamMethod = currentMethod?.type !== 'unary'

  // Show stream view if we have a streaming method
  if (isStreamMethod && (streamEvents.length > 0 || isStreaming)) {
    return <StreamView />
  }

  return <UnaryView response={response} isLoading={isLoading} error={errorMessage} />
}

// ─── Unary Response View ─────────────────────────────────────

function UnaryView({
  response,
  isLoading,
  error,
}: {
  response: ReturnType<typeof useResponseStore.getState>['response']
  isLoading: boolean
  error: string | null
}) {
  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center bg-[var(--white)] text-[var(--muted)]">
        Calling gRPC method...
      </div>
    )
  }

  if (error && !response) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 bg-[var(--white)] p-4">
        <span className="font-medium text-red-500">Error</span>
        <span className="text-center text-[var(--muted)]">{error}</span>
      </div>
    )
  }

  if (!response) {
    return (
      <div className="flex h-full items-center justify-center bg-[var(--white)] text-[var(--hint)]">
        Execute a gRPC call to see the response
      </div>
    )
  }

  if (response.error && !response.body) {
    // gRPC error: response.status carries the gRPC status code (mapped from
    // grpcStatus by grpc.store), response.statusText carries the details
    // string. Surface a status badge alongside the message so the
    // human-readable code (UNAVAILABLE / UNAUTHENTICATED / ...) the engine
    // produced is easy to read.
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 bg-[var(--white)] p-4">
        <span className="font-medium text-red-500">
          {typeof response.status === 'number'
            ? `gRPC error (code ${response.status})`
            : 'gRPC error'}
        </span>
        <span className="max-w-[600px] text-center text-[var(--muted)]">{response.error}</span>
        {response.statusText && response.statusText !== response.error && (
          <span className="max-w-[600px] text-center text-[var(--hint)]">
            {response.statusText}
          </span>
        )}
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col bg-[var(--white)]">
      {/* Meta bar */}
      <div className="flex shrink-0 items-center gap-3 border-b border-[var(--border)] px-3.5 py-2">
        <span className="font-medium" style={{ color: 'var(--accent-text)' }}>
          Response
        </span>
        {response.status !== undefined && (
          <span
            className="rounded-full px-2 py-0.5 font-semibold"
            style={{
              background: response.status === 0 ? '#e8f9f1' : '#fff0f0',
              color: response.status === 0 ? '#1a7a4a' : '#cc2200',
            }}
          >
            {response.status === 0 ? 'OK' : `Code ${response.status}`}
          </span>
        )}
        <span className="text-[var(--muted)]">{response.timing.total}ms</span>
        {response.bodySize !== undefined && (
          <span className="text-[var(--hint)]">
            {response.bodySize > 1024
              ? `${(response.bodySize / 1024).toFixed(1)} KB`
              : `${response.bodySize} B`}
          </span>
        )}
      </div>

      {/* Body */}
      <div className="flex-1 min-h-0">
        <MonacoWrapper value={response.body || ''} readOnly language="json" height="100%" />
      </div>
    </div>
  )
}

// ─── Stream View ─────────────────────────────────────────────

function StreamView() {
  const streamEvents = useGrpcStore((s) => s.streamEvents)
  const isStreaming = useGrpcStore((s) => s.isStreaming)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [autoScroll, setAutoScroll] = useState(true)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (autoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [streamEvents, autoScroll])

  return (
    <div className="flex h-full flex-col overflow-hidden bg-[var(--white)]">
      {/* Header */}
      <div className="flex shrink-0 items-center gap-2 border-b border-[var(--border)] px-3.5 py-2">
        <span className="font-medium" style={{ color: 'var(--accent-text)' }}>
          Stream Events
        </span>
        {isStreaming && (
          <span
            className="rounded-full px-2 py-0.5 font-medium"
            style={{ background: '#e8f9f1', color: '#1a7a4a' }}
          >
            Streaming
          </span>
        )}
      </div>

      {/* Event list */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        {streamEvents.length === 0 ? (
          <div className="flex h-full items-center justify-center text-[var(--hint)]">
            Waiting for stream events...
          </div>
        ) : (
          streamEvents.map((event) => {
            const isExpanded = expandedId === event.id
            return (
              <div
                key={event.id}
                className="cursor-pointer border-b border-[var(--border)] px-3 py-1.5 transition-colors hover:bg-[var(--surface)]"
                onClick={() => setExpandedId(isExpanded ? null : event.id)}
              >
                <div className="flex items-center gap-2">
                  <span
                    className="shrink-0 rounded px-1.5 py-0.5 font-medium"
                    style={{ background: '#e8f4ff', color: '#0066cc' }}
                  >
                    #{event.index + 1}
                  </span>
                  <span className="flex-1 truncate font-mono text-[var(--text)]">
                    {truncate(event.data.replace(/\n/g, ' '), 80)}
                  </span>
                  <span className="shrink-0 text-[var(--hint)]">
                    {formatTimestamp(event.timestamp)}
                  </span>
                </div>
                {isExpanded && (
                  <pre className="mt-1.5 max-h-48 overflow-auto rounded-lg bg-[var(--surface)] p-2 font-mono text-[var(--text)]">
                    {formatJson(event.data)}
                  </pre>
                )}
              </div>
            )
          })
        )}
      </div>

      {/* Footer */}
      <div className="flex shrink-0 items-center justify-between border-t border-[var(--border)] bg-[var(--surface)] px-3 py-1.5">
        <span className="text-[var(--muted)]">
          {streamEvents.length} event{streamEvents.length !== 1 ? 's' : ''}
        </span>
        <label className="flex cursor-pointer items-center gap-1.5">
          <input
            type="checkbox"
            checked={autoScroll}
            onChange={(e) => setAutoScroll(e.target.checked)}
            className="accent-[var(--accent)]"
          />
          <span className="text-[var(--muted)]">Auto-scroll</span>
        </label>
      </div>
    </div>
  )
}
