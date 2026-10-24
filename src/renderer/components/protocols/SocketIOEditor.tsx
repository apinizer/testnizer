import { useState } from 'react'
import { useSocketIOStore } from '../../stores/socketio.store'
import { useTranslation } from '../../lib/i18n'
import { DEFAULT_SIO_SETTINGS } from '../../../shared/realtime'
import SocketIOConnectionBar from './socketio/SocketIOConnectionBar'
import SioComposer from './socketio/SioComposer'
import SioEventsTab from './socketio/SioEventsTab'
import SioSettingsTab from './socketio/SioSettingsTab'
import SioTimeline from './socketio/SioTimeline'
import RealtimeTabStrip, { type RealtimeTab } from './realtime/RealtimeTabStrip'
import RealtimeRowsTab from './realtime/RealtimeRowsTab'

type SioTab = 'message' | 'params' | 'headers' | 'events' | 'settings'

const enabledRows = (rows: { key: string; enabled: boolean }[]): number =>
  rows.filter((r) => r.enabled && r.key.trim()).length

/**
 * Socket.IO editor (issue #283), Postman's layout: connection bar; request
 * tabs Message · Params · Headers · Events · Settings; the timeline below.
 */
export default function SocketIOEditor() {
  const { t, locale } = useTranslation()
  const [tab, setTab] = useState<SioTab>('message')
  const s = useSocketIOStore()
  const settingsChanged =
    JSON.stringify({ ...DEFAULT_SIO_SETTINGS, ...s.settings }) !==
    JSON.stringify(DEFAULT_SIO_SETTINGS)
  const tabs: RealtimeTab<SioTab>[] = [
    { id: 'message', label: t('ws.message') },
    { id: 'params', label: t('request.params'), count: enabledRows(s.params) },
    { id: 'headers', label: t('request.headers'), count: enabledRows(s.customHeaders) },
    {
      id: 'events',
      label: t('socketio.events'),
      count: s.listeners.filter((l) => l.listen).length,
      dot: s.listenAll,
    },
    { id: 'settings', label: t('request.settings'), dot: settingsChanged },
  ]

  return (
    <div className="flex h-full flex-col overflow-hidden bg-[var(--white)]" lang={locale}>
      <SocketIOConnectionBar />
      <div className="shrink-0 border-b border-[var(--border)]">
        <RealtimeTabStrip tabs={tabs} active={tab} onSelect={setTab} testIdPrefix="socketio" />
        <div
          role="tabpanel"
          data-testid={`socketio-panel-${tab}`}
          className="max-h-[45vh] overflow-auto border-t border-[var(--border)] px-3.5 py-2.5"
        >
          {tab === 'message' && <SioComposer />}
          {tab === 'params' && (
            <RealtimeRowsTab
              kind="params"
              rows={s.params}
              onUpdate={s.updateParam}
              onRemove={s.removeParam}
              onAdd={s.addParam}
              testIdPrefix="socketio"
            />
          )}
          {tab === 'headers' && (
            <RealtimeRowsTab
              kind="headers"
              rows={s.customHeaders}
              onUpdate={s.updateHeader}
              onRemove={s.removeHeader}
              onAdd={s.addHeader}
              testIdPrefix="socketio"
            />
          )}
          {tab === 'events' && <SioEventsTab />}
          {tab === 'settings' && <SioSettingsTab />}
        </div>
      </div>
      <SioTimeline />
    </div>
  )
}
