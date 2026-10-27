import { Plug, Shuffle, Unplug, X } from 'lucide-react'
import { useMqttStore } from '../../../stores/mqtt.store'
import { useTranslation } from '../../../lib/i18n'
import { MQTT_VERSIONS, randomMqttClientId, type MqttVersion } from '../../../../shared/mqtt'
import McpStatusPill from '../mcp/McpStatusPill'
import {
  CB_ERROR_BOX,
  CB_ICON_BUTTON,
  CB_INPUT,
  CB_ROW,
  CB_SELECT,
  CB_TARGET,
  CB_URL,
  cbPrimaryButton,
} from '../connection-bar-ui'

/**
 * MQTT connection bar (issue #284) — the WS / SSE / Socket.IO / MCP bars'
 * sizes and wrap rule (`connection-bar-ui.ts`): status pill and the protocol
 * version first, then broker URL + Connect as one group; the client id on its
 * own row under it (like Socket.IO's namespace / token). Empty client id = a
 * random one at Connect (Postman's default); Shuffle fills one in.
 */
export default function MqttConnectionBar() {
  const { t } = useTranslation()
  const url = useMqttStore((s) => s.url)
  const clientId = useMqttStore((s) => s.clientId)
  const version = useMqttStore((s) => s.version)
  const state = useMqttStore((s) => s.connectionState)
  const reconnecting = useMqttStore((s) => s.reconnecting)
  const errorMessage = useMqttStore((s) => s.errorMessage)
  const setUrl = useMqttStore((s) => s.setUrl)
  const setClientId = useMqttStore((s) => s.setClientId)
  const setVersion = useMqttStore((s) => s.setVersion)
  const connect = useMqttStore((s) => s.connect)
  const disconnect = useMqttStore((s) => s.disconnect)
  const isConnected = state === 'connected'
  const isConnecting = state === 'connecting'
  const busy = isConnected || isConnecting

  return (
    <div className="flex shrink-0 flex-col gap-2 border-b border-[var(--border)] px-3.5 py-2.5">
      <div data-testid="mqtt-connection-row" className={CB_ROW}>
        <McpStatusPill
          state={state}
          testId="mqtt-status"
          labelKey={reconnecting ? 'sse.reconnecting' : undefined}
        />
        <select
          value={version}
          onChange={(e) => setVersion(Number(e.target.value) as MqttVersion)}
          disabled={busy}
          aria-label={t('mqtt.version')}
          data-testid="mqtt-version"
          className={CB_SELECT}
        >
          {MQTT_VERSIONS.map((v) => (
            <option key={v} value={v}>
              {v === 5 ? 'MQTT 5.0' : 'MQTT 3.1.1'}
            </option>
          ))}
        </select>
        <div className={CB_TARGET}>
          <input
            type="text"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !busy && url.trim()) void connect()
            }}
            disabled={busy}
            data-testid="mqtt-url"
            aria-label={t('mqtt.url')}
            placeholder="mqtt://broker.example.com:1883"
            className={CB_URL}
          />
          <button
            type="button"
            onClick={() => void (busy ? disconnect() : connect())}
            disabled={!busy && !url.trim()}
            data-testid="mqtt-connect"
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
      <div data-testid="mqtt-options-row" className={CB_ROW}>
        <input
          type="text"
          value={clientId}
          onChange={(e) => setClientId(e.target.value)}
          disabled={busy}
          data-testid="mqtt-client-id"
          aria-label={t('mqtt.clientId')}
          placeholder={t('mqtt.clientIdPlaceholder')}
          className={`w-[18rem] max-w-full ${CB_INPUT}`}
        />
        <button
          type="button"
          onClick={() => setClientId(randomMqttClientId())}
          disabled={busy}
          aria-label={t('mqtt.clientIdRandom')}
          title={t('mqtt.clientIdRandom')}
          data-testid="mqtt-client-id-random"
          className={CB_ICON_BUTTON}
        >
          <Shuffle size={14} />
        </button>
      </div>
      {(state === 'error' || isConnected) && errorMessage && (
        <div data-testid="mqtt-error" role="alert" className={CB_ERROR_BOX}>
          {errorMessage}
        </div>
      )}
    </div>
  )
}
