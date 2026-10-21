import { Plug, Unplug, X } from 'lucide-react'
import { useWebSocketStore } from '../../stores/websocket.store'
import { useTranslation } from '../../lib/i18n'
import McpStatusPill from './mcp/McpStatusPill'

/**
 * WebSocket connection bar — the MCP / SSE bars' anatomy (issue #224): the
 * shared token status pill, the same Connect / Cancel / Disconnect button and
 * the same red token error box, so all connection protocols look and read the
 * same in light / dark and EN / TR. globals.css tokens only, no hex.
 */
export default function WsConnectionBar() {
  const { t } = useTranslation()
  const url = useWebSocketStore((s) => s.url)
  const setUrl = useWebSocketStore((s) => s.setUrl)
  const connectionState = useWebSocketStore((s) => s.connectionState)
  const errorMessage = useWebSocketStore((s) => s.errorMessage)
  const connect = useWebSocketStore((s) => s.connect)
  const disconnect = useWebSocketStore((s) => s.disconnect)

  const isConnected = connectionState === 'connected'
  const isConnecting = connectionState === 'connecting'
  const busy = isConnected || isConnecting
  const showError = (connectionState === 'error' || isConnected) && !!errorMessage

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <McpStatusPill state={connectionState} testId="ws-status" />

        <input
          type="text"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          disabled={busy}
          data-testid="ws-url"
          placeholder="wss://echo.websocket.org"
          className="flex-1 rounded-lg border border-[var(--border)] bg-[var(--white)] px-3 py-2 font-mono text-[var(--text)] outline-none transition-colors placeholder:text-[var(--placeholder)] focus:border-[var(--accent)] disabled:opacity-60"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !busy) connect()
          }}
        />

        {/* Connect / Cancel / Disconnect — same tokens as the MCP / SSE bars' button. */}
        <button
          type="button"
          onClick={() => void (busy ? disconnect() : connect())}
          disabled={!busy && !url.trim()}
          data-testid={isConnected ? 'ws-disconnect' : isConnecting ? 'ws-cancel' : 'ws-connect'}
          className={`flex shrink-0 cursor-pointer items-center gap-2 rounded-lg border-none px-4 py-2 font-medium text-white transition-opacity disabled:cursor-not-allowed disabled:opacity-50 ${
            busy ? 'bg-[var(--mb-delete-fg)]' : 'bg-[var(--accent)]'
          }`}
        >
          {isConnecting ? <X size={14} /> : isConnected ? <Unplug size={14} /> : <Plug size={14} />}
          {isConnecting ? t('common.cancel') : isConnected ? t('mcp.disconnect') : t('mcp.connect')}
        </button>
      </div>

      {showError && (
        <div
          data-testid="ws-error"
          role="alert"
          className="rounded-lg border border-[var(--mb-delete-br)] bg-[var(--mb-delete-bg)] px-3 py-2 text-[var(--red)]"
        >
          {errorMessage}
        </div>
      )}
    </div>
  )
}
