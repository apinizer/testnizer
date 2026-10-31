import { Plug, Unplug, X } from 'lucide-react'
import { useWebSocketStore } from '../../stores/websocket.store'
import { useTranslation } from '../../lib/i18n'
import McpStatusPill from './mcp/McpStatusPill'
import VariableAutocompleteInput from '../shared/VariableAutocompleteInput'
import {
  CB_ERROR_BOX,
  CB_ROW,
  CB_TARGET,
  CB_URL_FIELD,
  CB_URL_FIELDSET,
  cbPrimaryButton,
} from './connection-bar-ui'

/**
 * WebSocket connection bar — the MCP / SSE bars' anatomy (issue #224): the
 * shared token status pill, the same Connect / Cancel / Disconnect button and
 * the same red token error box, so all connection protocols look and read the
 * same in light / dark and EN / TR. globals.css tokens only, no hex. Sizes and
 * the wrap rule are the shared `connection-bar-ui.ts` set.
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
      <div data-testid="ws-connection-row" className={CB_ROW}>
        <McpStatusPill state={connectionState} testId="ws-status" />

        <div className={CB_TARGET}>
          <fieldset disabled={busy} className={CB_URL_FIELDSET}>
            <VariableAutocompleteInput
              value={url}
              onChange={setUrl}
              data-testid="ws-url"
              placeholder="wss://api.example.com/socket"
              spellCheck={false}
              autoComplete="off"
              className={CB_URL_FIELD}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !busy) connect()
              }}
            />
          </fieldset>

          {/* Connect / Cancel / Disconnect — same tokens as the MCP / SSE bars' button. */}
          <button
            type="button"
            onClick={() => void (busy ? disconnect() : connect())}
            disabled={!busy && !url.trim()}
            data-testid={isConnected ? 'ws-disconnect' : isConnecting ? 'ws-cancel' : 'ws-connect'}
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

      {showError && (
        <div data-testid="ws-error" role="alert" className={CB_ERROR_BOX}>
          {errorMessage}
        </div>
      )}
    </div>
  )
}
