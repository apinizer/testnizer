import { useState } from 'react'
import { useMqttStore } from '../../stores/mqtt.store'
import { useTranslation } from '../../lib/i18n'
import { DEFAULT_MQTT_SETTINGS } from '../../../shared/mqtt'
import MqttConnectionBar from './mqtt/MqttConnectionBar'
import MqttComposer from './mqtt/MqttComposer'
import MqttTopicsTab from './mqtt/MqttTopicsTab'
import MqttLog from './mqtt/MqttLog'
import { MqttAuthTab, MqttPropertiesTab, MqttSettingsTab } from './mqtt/MqttConnectTabs'
import MqttWillTab from './mqtt/MqttWillTab'
import RealtimeTabStrip, { type RealtimeTab } from './realtime/RealtimeTabStrip'

type MqttTab = 'message' | 'topics' | 'auth' | 'properties' | 'will' | 'settings'

/**
 * MQTT editor (issue #284), Postman's layout and the Socket.IO editor's
 * anatomy: connection bar (status, version, broker URL, client id); request
 * tabs Message · Topics · Authorization · Properties · Last Will · Settings;
 * the message log below. Visualization (Postman's per-topic charts) is not
 * built yet.
 */
export default function MqttEditor() {
  const { t, locale } = useTranslation()
  const [tab, setTab] = useState<MqttTab>('message')
  const s = useMqttStore()
  const settingsChanged =
    JSON.stringify({ ...DEFAULT_MQTT_SETTINGS, ...s.settings }) !==
    JSON.stringify(DEFAULT_MQTT_SETTINGS)
  const p = s.properties
  const propsSet =
    p.sessionExpiryInterval !== null ||
    p.receiveMaximum !== null ||
    p.maximumPacketSize !== null ||
    p.requestResponseInformation ||
    p.userProperties.some((r) => r.enabled && r.key.trim())
  const tabs: RealtimeTab<MqttTab>[] = [
    { id: 'message', label: t('ws.message') },
    {
      id: 'topics',
      label: t('mqtt.tab.topics'),
      count: s.topics.filter((x) => x.subscribe && x.name.trim()).length,
    },
    { id: 'auth', label: t('request.auth'), dot: s.username !== '' || s.password !== '' },
    { id: 'properties', label: t('mqtt.tab.properties'), dot: propsSet },
    { id: 'will', label: t('mqtt.tab.will'), dot: s.lastWill.topic.trim() !== '' },
    { id: 'settings', label: t('request.settings'), dot: settingsChanged },
  ]

  return (
    <div className="flex h-full flex-col overflow-hidden bg-[var(--white)]" lang={locale}>
      <MqttConnectionBar />
      <div className="shrink-0 border-b border-[var(--border)]">
        <RealtimeTabStrip tabs={tabs} active={tab} onSelect={setTab} testIdPrefix="mqtt" />
        <div
          role="tabpanel"
          data-testid={`mqtt-panel-${tab}`}
          className="max-h-[45vh] overflow-auto border-t border-[var(--border)] px-3.5 py-2.5"
        >
          {tab === 'message' && <MqttComposer />}
          {tab === 'topics' && <MqttTopicsTab />}
          {tab === 'auth' && <MqttAuthTab />}
          {tab === 'properties' && <MqttPropertiesTab />}
          {tab === 'will' && <MqttWillTab />}
          {tab === 'settings' && <MqttSettingsTab />}
        </div>
      </div>
      <MqttLog />
    </div>
  )
}
