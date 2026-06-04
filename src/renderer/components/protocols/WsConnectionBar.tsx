import { Plug, Unplug, X } from 'lucide-react'
import { useWebSocketStore } from '../../stores/websocket.store'

const STATE_INDICATORS: Record<string, { color: string; bg: string; label: string }> = {
  disconnected: { color: '#888888', bg: '#f0f0f0', label: 'Disconnected' },
  connecting: { color: '#b38600', bg: '#fff8e0', label: 'Connecting...' },
  connected: { color: '#1a7a4a', bg: '#e8f9f1', label: 'Connected' },
  error: { color: '#cc2200', bg: '#fff0f0', label: 'Error' },
}

export default function WsConnectionBar() {
  const url = useWebSocketStore((s) => s.url)
  const setUrl = useWebSocketStore((s) => s.setUrl)
  const connectionState = useWebSocketStore((s) => s.connectionState)
  const errorMessage = useWebSocketStore((s) => s.errorMessage)
  const connect = useWebSocketStore((s) => s.connect)
  const disconnect = useWebSocketStore((s) => s.disconnect)

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

        {/* URL input */}
        <input
          type="text"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          disabled={isConnected || isConnecting}
          placeholder="wss://echo.websocket.org"
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
            className="flex shrink-0 cursor-pointer items-center gap-2 rounded-lg px-4 py-2 font-medium text-white transition-opacity disabled:cursor-not-allowed disabled:opacity-50"
            style={{ background: 'var(--accent)', border: 'none' }}
          >
            <Plug size={14} />
            Connect
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
