import { Plug, Unplug, RefreshCw, X } from 'lucide-react'
import { useSseStore, type SseHttpMethod } from '../../stores/sse.store'
import { useTranslation } from '../../lib/i18n'
import McpStatusPill from './mcp/McpStatusPill'

const METHODS: SseHttpMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']

/**
 * The message under the bar, toned by state — globals.css tokens only, so both
 * themes follow (the error tone is the MCP bar's error box):
 *  - error        → the failure (red box)
 *  - disconnected → why the stream ended, e.g. the server's HTTP 204 (neutral)
 * While connected, a transient error is not shown: the client is already
 * reconnecting on its own and the next `open` clears it. The pill says
 * "Reconnecting…" meanwhile (issue #226) — the server may already have ended
 * the stream, but "closed" is only said once the connection is really over.
 */
const MESSAGE_TONE: Partial<Record<string, string>> = {
  error: 'border-[var(--mb-delete-br)] bg-[var(--mb-delete-bg)] text-[var(--red)]',
  disconnected: 'border-[var(--border)] bg-[var(--surface)] text-[var(--text)]',
}

export default function SseConnectionBar() {
  const { t } = useTranslation()
  const url = useSseStore((s) => s.url)
  const setUrl = useSseStore((s) => s.setUrl)
  const method = useSseStore((s) => s.method)
  const setMethod = useSseStore((s) => s.setMethod)
  const connectionState = useSseStore((s) => s.connectionState)
  const errorMessage = useSseStore((s) => s.errorMessage)
  const reconnecting = useSseStore((s) => s.reconnecting)
  const connect = useSseStore((s) => s.connect)
  const disconnect = useSseStore((s) => s.disconnect)
  const reconnect = useSseStore((s) => s.reconnect)

  const isConnected = connectionState === 'connected'
  const isConnecting = connectionState === 'connecting'
  const busy = isConnected || isConnecting
  const messageTone = MESSAGE_TONE[connectionState]
  const showReconnecting = isConnected && reconnecting

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <McpStatusPill
          state={showReconnecting ? 'connecting' : connectionState}
          labelKey={showReconnecting ? 'sse.reconnecting' : undefined}
          testId="sse-status"
        />

        <select
          value={method}
          onChange={(e) => setMethod(e.target.value as SseHttpMethod)}
          disabled={busy}
          data-testid="sse-method"
          aria-label={t('sse.method')}
          className="shrink-0 rounded-lg border border-[var(--border)] bg-[var(--white)] px-2 py-2 font-mono font-medium text-[var(--text)] outline-none transition-colors focus:border-[var(--accent)] disabled:opacity-60"
        >
          {METHODS.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>

        <input
          type="text"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          disabled={busy}
          data-testid="sse-url"
          placeholder="https://api.example.com/events"
          className="flex-1 rounded-lg border border-[var(--border)] bg-[var(--white)] px-3 py-2 font-mono text-[var(--text)] outline-none transition-colors placeholder:text-[var(--placeholder)] focus:border-[var(--accent)] disabled:opacity-60"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !isConnected) connect()
          }}
        />

        {/* Connect / Cancel / Disconnect — same tokens as the MCP bar's button. */}
        <button
          type="button"
          onClick={() => void (busy ? disconnect() : connect())}
          disabled={!busy && !url.trim()}
          data-testid={isConnected ? 'sse-disconnect' : isConnecting ? 'sse-cancel' : 'sse-connect'}
          className={`flex shrink-0 cursor-pointer items-center gap-2 rounded-lg border-none px-4 py-2 font-medium text-white transition-opacity disabled:cursor-not-allowed disabled:opacity-50 ${
            busy ? 'bg-[var(--mb-delete-fg)]' : 'bg-[var(--accent)]'
          }`}
        >
          {isConnecting ? <X size={14} /> : isConnected ? <Unplug size={14} /> : <Plug size={14} />}
          {isConnecting ? t('common.cancel') : isConnected ? t('mcp.disconnect') : t('mcp.connect')}
        </button>

        {isConnected && (
          <button
            type="button"
            onClick={reconnect}
            data-testid="sse-reconnect"
            className="flex shrink-0 cursor-pointer items-center gap-1.5 rounded-lg border border-[var(--border)] bg-transparent px-3 py-2 font-medium text-[var(--text)] transition-colors hover:bg-[var(--surface)]"
          >
            <RefreshCw size={13} />
            {t('sse.reconnect')}
          </button>
        )}
      </div>

      {messageTone && errorMessage && (
        <div
          data-testid="sse-message"
          data-state={connectionState}
          role={connectionState === 'error' ? 'alert' : 'status'}
          className={`rounded-lg border px-3 py-2 ${messageTone}`}
        >
          {errorMessage}
        </div>
      )}
    </div>
  )
}
