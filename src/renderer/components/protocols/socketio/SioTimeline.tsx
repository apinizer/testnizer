import { useState } from 'react'
import { useSocketIOStore, type SocketIOEvent } from '../../../stores/socketio.store'
import { useTranslation } from '../../../lib/i18n'
import { isTaggedBinary } from '../../../../shared/realtime'
import { argText, rowArgs, rowMatches, rowText } from '../../../lib/socketio-timeline'
import { messageSize } from '../../../lib/realtime-format'
import RealtimeLogToolbar from '../realtime/RealtimeLogToolbar'
import RealtimeLogRow from '../realtime/RealtimeLogRow'
import MessageView from '../realtime/MessageView'
import SioListenNotice from './SioListenNotice'
import { useRealtimeLog, type LogFilter, type LogKind } from '../realtime/use-realtime-log'

const FILTERS: readonly LogFilter[] = ['all', 'sent', 'received', 'system']
const SYSTEM_KEYS: Record<string, string> = {
  connected: 'socketio.system.connected',
  disconnected: 'socketio.system.disconnected',
  error: 'socketio.system.error',
  reconnecting: 'socketio.system.reconnecting',
  reconnect_attempt: 'socketio.system.reconnectAttempt',
  reconnected: 'socketio.system.reconnected',
}

const kindOf = (e: SocketIOEvent): LogKind =>
  e.direction === 'out' ? 'sent' : e.direction === 'system' ? 'system' : 'received'

/** The argument formats of a row (`json`, `text`, `binary`), for the Info popover. */
function typesOf(args: unknown[]): string {
  const kinds = args.map((a) =>
    isTaggedBinary(a) ? 'binary' : typeof a === 'string' ? 'text' : 'json',
  )
  return [...new Set(kinds)].join(', ')
}

function sizeOf(e: SocketIOEvent): number {
  return rowArgs(e).reduce<number>((n, a) => {
    if (isTaggedBinary(a)) return n + a.size
    return n + messageSize(argText(a), false)
  }, 0)
}

/**
 * Socket.IO timeline (issue #283): every event, ack and connection row
 * (connect / disconnect with its reason / error / reconnect), newest first,
 * with the shared log toolbar (search, All / Sent / Received / System, two-row
 * latency) and per-row Copy / Save / Info. Expanding a row shows each
 * argument in the shared message view (Text / JSON / XML / HTML, Hexdump for
 * binary).
 */
export default function SioTimeline() {
  const { t } = useTranslation()
  const events = useSocketIOStore((s) => s.events)
  const connected = useSocketIOStore((s) => s.connectionState === 'connected')
  const clearEvents = useSocketIOStore((s) => s.clearEvents)
  const saveEntry = useSocketIOStore((s) => s.saveTimelineEntry)
  const log = useRealtimeLog(events, kindOf, rowMatches)
  const [expanded, setExpanded] = useState<string | null>(null)

  const titleOf = (e: SocketIOEvent): string => {
    if (e.direction === 'system') return t(SYSTEM_KEYS[e.event] ?? 'socketio.system.event')
    if (e.direction === 'ack') return t('socketio.ackRow').replace('{event}', e.event)
    return e.event
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <RealtimeLogToolbar
        title={`${t('socketio.eventTimeline')}${events.length > 0 ? ` (${events.length})` : ''}`}
        query={log.query}
        onQuery={log.setQuery}
        filter={log.filter}
        onFilter={log.setFilter}
        filters={FILTERS}
        diffMs={log.diffMs}
        onClearSelection={log.clearSelection}
        onClear={clearEvents}
        canClear={events.length > 0}
        testIdPrefix="socketio"
      />
      <SioListenNotice />
      <div className="min-h-0 flex-1 overflow-y-auto" data-testid="socketio-timeline">
        {log.visible.length === 0 ? (
          <div className="mt-5 px-3 text-center text-[12px] text-[var(--hint)]">
            {events.length > 0
              ? t('rt.log.noMatch')
              : connected
                ? t('sse.waitingForEvents')
                : t('socketio.connectToSee')}
          </div>
        ) : (
          // Newest first — the timeline's order before issue #283.
          [...log.visible].reverse().map((e) => {
            const args = e.direction === 'system' ? [] : rowArgs(e)
            return (
              <RealtimeLogRow
                key={e.id}
                kind={kindOf(e)}
                title={titleOf(e)}
                tone={
                  e.error || (e.direction === 'system' && e.event === 'error') ? 'error' : undefined
                }
                preview={rowText(e).replace(/\s+/g, ' ').slice(0, 200)}
                badge={
                  args.length > 1
                    ? t('socketio.argsOther').replace('{n}', String(args.length))
                    : undefined
                }
                timestamp={e.timestamp}
                sizeBytes={e.direction === 'system' ? undefined : sizeOf(e)}
                typeLabel={args.length > 0 ? typesOf(args) : undefined}
                copyText={rowText(e)}
                onSave={
                  e.direction === 'in' || e.direction === 'out' ? () => saveEntry(e.id) : undefined
                }
                selected={log.selected.includes(e.id)}
                onToggleSelect={() => log.toggleSelect(e.id)}
                expanded={expanded === e.id && args.length > 0}
                onToggleExpand={() => setExpanded(expanded === e.id ? null : e.id)}
                testId="socketio-event"
                testIdPrefix="socketio"
                direction={e.direction}
              >
                {args.map((a, i) => (
                  <MessageView
                    key={i}
                    content={argText(a)}
                    binary={isTaggedBinary(a)}
                    initialMode={
                      isTaggedBinary(a) ? 'hexdump' : typeof a === 'string' ? 'text' : 'json'
                    }
                    testIdPrefix="socketio"
                  />
                ))}
              </RealtimeLogRow>
            )
          })
        )}
      </div>
    </div>
  )
}
