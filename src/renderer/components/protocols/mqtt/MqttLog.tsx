import { useEffect, useRef, useState } from 'react'
import { RadioTower } from 'lucide-react'
import { useMqttStore, type MqttLogRow } from '../../../stores/mqtt.store'
import { useTranslation } from '../../../lib/i18n'
import { formatCount } from '../../../lib/plural'
import { defaultViewMode, messageFormatLabel, messageSize } from '../../../lib/realtime-format'
import EmptyState from '../../shared/EmptyState'
import RealtimeLogToolbar from '../realtime/RealtimeLogToolbar'
import RealtimeLogRow from '../realtime/RealtimeLogRow'
import MessageView from '../realtime/MessageView'
import { useRealtimeLog, type LogFilter, type LogKind } from '../realtime/use-realtime-log'

const FILTERS: readonly LogFilter[] = ['all', 'sent', 'received', 'system']
const SYSTEM_KEYS: Record<string, string> = {
  connected: 'mqtt.system.connected',
  disconnected: 'mqtt.system.disconnected',
  error: 'mqtt.system.error',
  subscribed: 'mqtt.system.subscribed',
  'subscribe-refused': 'mqtt.system.subscribeRefused',
  unsubscribed: 'mqtt.system.unsubscribed',
  'server-disconnect': 'mqtt.system.serverDisconnect',
  offline: 'mqtt.system.offline',
  reconnecting: 'mqtt.system.reconnecting',
  reconnected: 'mqtt.system.reconnected',
  'publish-failed': 'mqtt.system.publishFailed',
}
const ERROR_EVENTS = new Set(['error', 'subscribe-refused', 'publish-failed', 'server-disconnect'])

const kindOf = (r: MqttLogRow): LogKind => r.direction
/** Search matches the topic and the payload (Postman's topic filter + search). */
const matches = (r: MqttLogRow, q: string): boolean =>
  `${r.topic ?? ''} ${r.event ?? ''} ${r.content}`.toLowerCase().includes(q.trim().toLowerCase())

function badgeOf(r: MqttLogRow): string | undefined {
  if (r.direction === 'system') return undefined
  return `QoS ${r.qos ?? 0}${r.retain ? ' · R' : ''}`
}

/**
 * MQTT message log (issue #284): the shared realtime toolbar (search over
 * topic + payload, All / Sent / Received / Connection, time difference of two
 * selected rows) and rows (Copy / Save / Info). A message row's title is its
 * topic, its badge QoS and the retain flag; expanding it shows the payload
 * (Text / JSON / XML / HTML, Hexdump for binary) and its MQTT 5 properties.
 * Oldest first with auto-scroll, like the WebSocket log.
 */
export default function MqttLog() {
  const { t } = useTranslation()
  const rows = useMqttStore((s) => s.log)
  const clearLog = useMqttStore((s) => s.clearLog)
  const saveLogged = useMqttStore((s) => s.saveLoggedMessage)
  const savedCount = useMqttStore((s) => s.savedMessages.length)
  const log = useRealtimeLog(rows, kindOf, matches)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const traffic = rows.filter((r) => r.direction !== 'system')
  const sent = traffic.filter((r) => r.direction === 'sent').length

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [rows])

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <RealtimeLogToolbar
        title={t('ws.log')}
        query={log.query}
        onQuery={log.setQuery}
        filter={log.filter}
        onFilter={log.setFilter}
        filters={FILTERS}
        diffMs={log.diffMs}
        onClearSelection={log.clearSelection}
        onClear={clearLog}
        canClear={rows.length > 0}
        testIdPrefix="mqtt"
      />
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto" data-testid="mqtt-log">
        {rows.length === 0 ? (
          <EmptyState
            icon={RadioTower}
            title={t('mqtt.emptyTitle')}
            description={t('mqtt.emptyDesc')}
            size="md"
          />
        ) : log.visible.length === 0 ? (
          <div className="mt-5 px-3 text-center text-[12px] text-[var(--hint)]">
            {t('rt.log.noMatch')}
          </div>
        ) : (
          log.visible.map((r) => {
            const system = r.direction === 'system'
            const binary = r.contentType === 'binary'
            return (
              <RealtimeLogRow
                key={r.id}
                kind={r.direction}
                title={system ? t(SYSTEM_KEYS[r.event ?? ''] ?? 'mqtt.system.event') : r.topic}
                tone={system && ERROR_EVENTS.has(r.event ?? '') ? 'error' : undefined}
                preview={(system && r.topic ? `${r.topic}  ${r.content}` : r.content)
                  .replace(/\s+/g, ' ')
                  .slice(0, 200)}
                badge={badgeOf(r)}
                timestamp={r.timestamp}
                sizeBytes={system ? undefined : messageSize(r.content, binary)}
                typeLabel={system ? undefined : messageFormatLabel(r.contentType, t)}
                copyText={r.content}
                onSave={
                  system
                    ? undefined
                    : () =>
                        saveLogged(
                          r.id,
                          t('rt.saved.defaultName').replace('{n}', String(savedCount + 1)),
                        )
                }
                selected={log.selected.includes(r.id)}
                onToggleSelect={() => log.toggleSelect(r.id)}
                expanded={!system && expandedId === r.id}
                onToggleExpand={() => setExpandedId(expandedId === r.id ? null : r.id)}
                testId={system ? 'mqtt-system' : 'mqtt-message'}
                testIdPrefix="mqtt"
                direction={r.direction}
              >
                <MessageView
                  content={r.content}
                  binary={binary}
                  initialMode={defaultViewMode(r.contentType)}
                  testIdPrefix="mqtt"
                />
                {r.properties && (
                  <pre
                    data-testid="mqtt-message-properties"
                    className="m-0 mt-1.5 max-h-40 overflow-auto rounded-lg bg-[var(--surface)] p-2 font-mono text-[11px] text-[var(--text)]"
                  >
                    {JSON.stringify(r.properties, null, 2)}
                  </pre>
                )}
              </RealtimeLogRow>
            )
          })
        )}
      </div>
      <div className="flex shrink-0 items-center border-t border-[var(--border)] bg-[var(--surface)] px-3 py-1.5">
        <span className="text-[var(--muted)]" data-testid="mqtt-message-counts">
          {formatCount(traffic.length, t('ws.countsOne'), t('ws.countsOther'))
            .replace('{sent}', String(sent))
            .replace('{received}', String(traffic.length - sent))}
        </span>
      </div>
    </div>
  )
}
