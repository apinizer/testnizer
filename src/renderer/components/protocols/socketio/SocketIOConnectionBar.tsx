import { Plug, Unplug, X } from 'lucide-react'
import { useSocketIOStore } from '../../../stores/socketio.store'
import { useTranslation } from '../../../lib/i18n'
import McpStatusPill from '../mcp/McpStatusPill'
import {
  CB_ERROR_BOX,
  CB_INPUT,
  CB_ROW,
  CB_TARGET,
  CB_URL,
  cbPrimaryButton,
} from '../connection-bar-ui'

/**
 * Socket.IO connection bar — the WS / SSE / MCP bars' sizes and wrap rule
 * (`connection-bar-ui.ts`): status pill, then URL + Connect as one group;
 * namespace and token on their own row under it so they never squeeze the URL
 * or push Connect off the line.
 */
export default function SocketIOConnectionBar() {
  const { t } = useTranslation()
  const url = useSocketIOStore((s) => s.url)
  const namespace = useSocketIOStore((s) => s.namespace)
  const bearerToken = useSocketIOStore((s) => s.bearerToken)
  const connectionState = useSocketIOStore((s) => s.connectionState)
  const errorMessage = useSocketIOStore((s) => s.errorMessage)
  const setUrl = useSocketIOStore((s) => s.setUrl)
  const setNamespace = useSocketIOStore((s) => s.setNamespace)
  const setBearerToken = useSocketIOStore((s) => s.setBearerToken)
  const connect = useSocketIOStore((s) => s.connect)
  const disconnect = useSocketIOStore((s) => s.disconnect)
  const isConnected = connectionState === 'connected'
  const isConnecting = connectionState === 'connecting'
  const busy = isConnected || isConnecting

  return (
    <div className="flex shrink-0 flex-col gap-2 border-b border-[var(--border)] px-3.5 py-2.5">
      <div data-testid="socketio-connection-row" className={CB_ROW}>
        <McpStatusPill state={connectionState} testId="socketio-status" />
        <div className={CB_TARGET}>
          <input
            type="text"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            disabled={isConnected}
            data-testid="socketio-url"
            placeholder="http://localhost:3000"
            className={CB_URL}
          />
          <button
            type="button"
            onClick={() => void (busy ? disconnect() : connect())}
            disabled={!busy && !url.trim()}
            data-testid="socketio-connect"
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
        </div>
      </div>
      <div data-testid="socketio-options-row" className={CB_ROW}>
        <input
          type="text"
          value={namespace}
          onChange={(e) => setNamespace(e.target.value)}
          disabled={isConnected}
          data-testid="socketio-namespace"
          aria-label={t('socketio.namespace')}
          placeholder={t('socketio.namespacePlaceholder')}
          className={`w-[10rem] ${CB_INPUT}`}
        />
        <input
          type="password"
          value={bearerToken}
          onChange={(e) => setBearerToken(e.target.value)}
          disabled={isConnected}
          data-testid="socketio-bearer-token"
          aria-label={t('socketio.tokenPlaceholder')}
          aria-describedby="socketio-token-hint"
          placeholder={t('socketio.tokenPlaceholder')}
          className={`w-[16rem] max-w-full ${CB_INPUT}`}
        />
      </div>
      {(connectionState === 'error' || isConnected) && errorMessage && (
        <div data-testid="socketio-error" role="alert" className={CB_ERROR_BOX}>
          {errorMessage}
        </div>
      )}
      {/* Issue #243: the literal token is never written to localStorage. */}
      <p
        id="socketio-token-hint"
        data-testid="socketio-token-hint"
        className="m-0 text-[11px] text-[var(--muted)]"
      >
        {t('socketio.tokenHint')}
      </p>
    </div>
  )
}
