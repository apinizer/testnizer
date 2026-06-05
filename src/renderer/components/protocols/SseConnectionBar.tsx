import { Plug, Unplug, RefreshCw, X } from 'lucide-react'
import { useSseStore, type SseHttpMethod } from '../../stores/sse.store'

const STATE_INDICATORS: Record<string, { color: string; bg: string; label: string }> = {
  disconnected: { color: '#888888', bg: '#f0f0f0', label: 'Disconnected' },
  connecting: { color: '#b38600', bg: '#fff8e0', label: 'Connecting...' },
  connected: { color: '#1a7a4a', bg: '#e8f9f1', label: 'Connected' },
  error: { color: '#cc2200', bg: '#fff0f0', label: 'Error' },
}

const METHODS: SseHttpMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']

export default function SseConnectionBar() {
  const url = useSseStore((s) => s.url)
  const setUrl = useSseStore((s) => s.setUrl)
  const method = useSseStore((s) => s.method)
  const setMethod = useSseStore((s) => s.setMethod)
  const connectionState = useSseStore((s) => s.connectionState)
  const errorMessage = useSseStore((s) => s.errorMessage)
  const connect = useSseStore((s) => s.connect)
  const disconnect = useSseStore((s) => s.disconnect)
  const reconnect = useSseStore((s) => s.reconnect)

  const indicator = STATE_INDICATORS[connectionState]
  const isConnected = connectionState === 'connected'
  const isConnecting = connectionState === 'connecting'

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        {/* Status indicator */}
        <div
          className="flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1.5"
          style={{ background: indicator.bg }}
        >
          <div
            className="h-2 w-2 rounded-full"
            style={{
              background: indicator.color,
              boxShadow: connectionState === 'connected' ? `0 0 6px ${indicator.color}` : 'none',
            }}
          />
          <span className="font-medium" style={{ color: indicator.color }}>
            {indicator.label}
          </span>
        </div>

        {/* Method dropdown */}
        <select
          value={method}
          onChange={(e) => setMethod(e.target.value as SseHttpMethod)}
          disabled={isConnected || isConnecting}
          className="shrink-0 rounded-lg border border-[var(--border)] bg-[var(--white)] px-2 py-2 font-mono font-medium text-[var(--text)] outline-none transition-colors focus:border-[var(--accent)] disabled:opacity-60"
        >
          {METHODS.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>

        {/* URL input */}
        <input
          type="text"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          disabled={isConnected || isConnecting}
          data-testid="sse-url"
          placeholder="https://api.example.com/events"
          className="flex-1 rounded-lg border border-[var(--border)] bg-[var(--white)] px-3 py-2 font-mono text-[var(--text)] outline-none transition-colors placeholder:text-[var(--hint)] focus:border-[var(--accent)] disabled:opacity-60"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !isConnected) connect()
          }}
        />

        {/* Connect / Cancel / Disconnect button */}
        {isConnected ? (
          <button
            type="button"
            onClick={disconnect}
            data-testid="sse-disconnect"
            className="flex shrink-0 cursor-pointer items-center gap-2 rounded-lg px-4 py-2 font-medium text-white transition-opacity"
            style={{ background: '#cc2200', border: 'none' }}
          >
            <Unplug size={14} />
            Disconnect
          </button>
        ) : isConnecting ? (
          <button
            type="button"
            onClick={disconnect}
            className="flex shrink-0 cursor-pointer items-center gap-2 rounded-lg px-4 py-2 font-medium text-white transition-opacity"
            style={{ background: '#cc2200', border: 'none' }}
          >
            <X size={14} />
            Cancel
          </button>
        ) : (
          <button
            type="button"
            onClick={connect}
            disabled={!url.trim()}
            data-testid="sse-connect"
            className="flex shrink-0 cursor-pointer items-center gap-2 rounded-lg px-4 py-2 font-medium text-white transition-opacity disabled:cursor-not-allowed disabled:opacity-50"
            style={{ background: 'var(--accent)', border: 'none' }}
          >
            <Plug size={14} />
            Connect
          </button>
        )}

        {/* Reconnect */}
        {isConnected && (
          <button
            type="button"
            onClick={reconnect}
            className="flex shrink-0 cursor-pointer items-center gap-1.5 rounded-lg border border-[var(--border)] px-3 py-2 font-medium text-[var(--text)] transition-colors hover:bg-[var(--surface)]"
            style={{ background: 'transparent' }}
          >
            <RefreshCw size={13} />
            Reconnect
          </button>
        )}
      </div>

      {/* Error message */}
      {connectionState === 'error' && errorMessage && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-red-600">
          {errorMessage}
        </div>
      )}
    </div>
  )
}
