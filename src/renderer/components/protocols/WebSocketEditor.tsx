import { useState } from 'react'
import { useWebSocketStore } from '../../stores/websocket.store'
import { useTranslation } from '../../lib/i18n'
import { DEFAULT_WS_SETTINGS } from '../../../shared/realtime'
import WsConnectionBar from './WsConnectionBar'
import WsComposer from './WsComposer'
import WsMessageLog from './WsMessageLog'
import RealtimeTabStrip, { type RealtimeTab } from './realtime/RealtimeTabStrip'
import RealtimeRowsTab from './realtime/RealtimeRowsTab'
import RealtimeSettingsForm from './realtime/RealtimeSettingsForm'

type WsTab = 'message' | 'params' | 'headers' | 'settings'

const enabledRows = (rows: { key: string; enabled: boolean }[]): number =>
  rows.filter((r) => r.enabled && r.key.trim()).length

/**
 * WebSocket editor (issue #282), Postman's layout and the Socket.IO editor's
 * anatomy: connection bar; request tabs Message · Params · Headers ·
 * Settings; the message log below.
 */
export default function WebSocketEditor() {
  const { t } = useTranslation()
  const [tab, setTab] = useState<WsTab>('message')
  const s = useWebSocketStore()
  const connected = s.connectionState === 'connected'
  const settingsChanged =
    JSON.stringify({ ...DEFAULT_WS_SETTINGS, ...s.settings }) !==
    JSON.stringify(DEFAULT_WS_SETTINGS)
  const tabs: RealtimeTab<WsTab>[] = [
    { id: 'message', label: t('ws.message') },
    { id: 'params', label: t('request.params'), count: enabledRows(s.params) },
    { id: 'headers', label: t('request.headers'), count: enabledRows(s.customHeaders) },
    { id: 'settings', label: t('request.settings'), dot: settingsChanged },
  ]

  return (
    <div className="flex h-full flex-col overflow-hidden bg-[var(--white)]">
      {/* Tab bar label */}
      <div className="flex shrink-0 items-center gap-2 border-b border-[var(--border)] bg-[var(--white)] px-3.5 py-2">
        <span className="font-medium text-[var(--accent-text)]">WebSocket</span>
        {/* Same badge as the SSE editor's header (issue #248): translated, theme tokens. */}
        {connected && (
          <span className="rounded-full bg-[var(--green-bg)] px-2 py-0.5 font-medium text-[var(--green)]">
            {t('mcp.status.connected')}
          </span>
        )}
      </div>
      <div className="shrink-0 border-b border-[var(--border)] px-3.5 py-2.5">
        <WsConnectionBar />
      </div>
      <div className="shrink-0 border-b border-[var(--border)]">
        <RealtimeTabStrip tabs={tabs} active={tab} onSelect={setTab} testIdPrefix="ws" />
        <div
          role="tabpanel"
          data-testid={`ws-panel-${tab}`}
          className="max-h-[45vh] overflow-auto border-t border-[var(--border)] px-3.5 py-2.5"
        >
          {tab === 'message' && <WsComposer />}
          {tab === 'params' && (
            <RealtimeRowsTab
              kind="params"
              rows={s.params}
              onUpdate={s.updateParam}
              onRemove={s.removeParam}
              onAdd={s.addParam}
              testIdPrefix="ws"
            />
          )}
          {tab === 'headers' && (
            <RealtimeRowsTab
              kind="headers"
              rows={s.customHeaders}
              onUpdate={s.updateHeader}
              onRemove={s.removeHeader}
              onAdd={s.addHeader}
              testIdPrefix="ws"
            />
          )}
          {tab === 'settings' && (
            <RealtimeSettingsForm
              settings={s.settings}
              maxPayload={s.settings.maxPayload}
              onChange={s.setSettings}
              onMaxPayloadChange={(maxPayload) => s.setSettings({ maxPayload })}
              connected={connected}
              testIdPrefix="ws"
            />
          )}
        </div>
      </div>
      <WsMessageLog />
    </div>
  )
}
