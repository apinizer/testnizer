import { Plug, Unplug, RefreshCw, X } from 'lucide-react'
import { useSseStore, type SseHttpMethod } from '../../stores/sse.store'
import { useTranslation } from '../../lib/i18n'
import McpStatusPill from './mcp/McpStatusPill'
import {
  CB_ERROR_BOX,
  CB_ROW,
  CB_SECONDARY_BUTTON,
  CB_SELECT,
  CB_TARGET,
  CB_URL,
  cbPrimaryButton,
} from './connection-bar-ui'

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
  error: CB_ERROR_BOX,
  disconnected:
    'break-words rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-[var(--text)]',
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
      {/* Sizes + wrap rule: `connection-bar-ui.ts` (the WS / Socket.IO / MCP bars' set). */}
      <div data-testid="sse-connection-row" className={CB_ROW}>
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
          className={`${CB_SELECT} font-mono font-medium`}
        >
          {METHODS.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>

        <div className={CB_TARGET}>
          <input
            type="text"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            disabled={busy}
            data-testid="sse-url"
            placeholder="https://api.example.com/events"
            className={CB_URL}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !isConnected) connect()
            }}
          />

          {/* Connect / Cancel / Disconnect — same tokens as the MCP bar's button. */}
          <button
            type="button"
            onClick={() => void (busy ? disconnect() : connect())}
            disabled={!busy && !url.trim()}
            data-testid={
              isConnected ? 'sse-disconnect' : isConnecting ? 'sse-cancel' : 'sse-connect'
            }
            className={cbPrimaryButton(busy)}
          >
            {isConnecting ? (
              <X size={14} />
            ) : isConnected ? (
              <Unplug size={14} />
            ) : (
              <Plug size={14} />
            )}
            {isConnecting
              ? t('common.cancel')
              : isConnected
                ? t('mcp.disconnect')
                : t('mcp.connect')}
          </button>

          {isConnected && (
            <button
              type="button"
              onClick={reconnect}
              data-testid="sse-reconnect"
              className={CB_SECONDARY_BUTTON}
            >
              <RefreshCw size={13} />
              {t('sse.reconnect')}
            </button>
          )}
        </div>
      </div>

      {messageTone && errorMessage && (
        <div
          data-testid="sse-message"
          data-state={connectionState}
          role={connectionState === 'error' ? 'alert' : 'status'}
          className={messageTone}
        >
          {errorMessage}
        </div>
      )}
    </div>
  )
}
