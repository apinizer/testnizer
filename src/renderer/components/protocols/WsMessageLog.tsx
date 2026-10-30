import { useState, useEffect, useRef } from 'react'
import { MessageSquare } from 'lucide-react'
import { useWebSocketStore } from '../../stores/websocket.store'
import EmptyState from '../shared/EmptyState'
import type { WsMessage } from '../../types'
import { useTranslation } from '../../lib/i18n'
import { defaultViewMode, messageFormatLabel, messageSize } from '../../lib/realtime-format'
import RealtimeLogToolbar from './realtime/RealtimeLogToolbar'
import RealtimeLogRow from './realtime/RealtimeLogRow'
import MessageView from './realtime/MessageView'
import { useRealtimeLog, type LogFilter, type LogKind } from './realtime/use-realtime-log'

const FILTERS: readonly LogFilter[] = ['all', 'sent', 'received', 'system']
const SYSTEM_KEYS: Record<string, string> = {
  connected: 'ws.system.connected',
  disconnected: 'ws.system.disconnected',
  error: 'ws.system.error',
  reconnecting: 'ws.system.reconnecting',
  reconnected: 'ws.system.reconnected',
}

const kindOf = (m: WsMessage): LogKind => m.direction
const matches = (m: WsMessage, q: string): boolean =>
  `${m.event ?? ''} ${m.content}`.toLowerCase().includes(q.trim().toLowerCase())

/**
 * WebSocket message log (issue #282): the shared log toolbar (search, All /
 * Sent / Received / Connection, time difference of two selected rows) and
 * rows (Copy / Save / Info), connection rows, expanded view as Text / JSON /
 * XML / HTML or — for a binary frame — Hexdump / Text. Oldest first with
 * auto-scroll (its order before #282).
 */
export default function WsMessageLog() {
  const { t, locale } = useTranslation()
  const messages = useWebSocketStore((s) => s.messages)
  const clearMessages = useWebSocketStore((s) => s.clearMessages)
  const autoScroll = useWebSocketStore((s) => s.autoScroll)
  const setAutoScroll = useWebSocketStore((s) => s.setAutoScroll)
  const saveLogged = useWebSocketStore((s) => s.saveLoggedMessage)
  const savedCount = useWebSocketStore((s) => s.savedMessages.length)
  const log = useRealtimeLog(messages, kindOf, matches)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const traffic = messages.filter((m) => m.direction !== 'system')
  const sentCount = traffic.filter((m) => m.direction === 'sent').length

  useEffect(() => {
    if (autoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages, autoScroll])

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden" lang={locale}>
      <RealtimeLogToolbar
        title={t('ws.log')}
        query={log.query}
        onQuery={log.setQuery}
        filter={log.filter}
        onFilter={log.setFilter}
        filters={FILTERS}
        diffMs={log.diffMs}
        onClearSelection={log.clearSelection}
        onClear={clearMessages}
        canClear={messages.length > 0}
        testIdPrefix="ws"
      />
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
        {messages.length === 0 ? (
          <EmptyState
            icon={MessageSquare}
            title={t('ws.emptyTitle')}
            description={t('ws.emptyDesc')}
            size="md"
          />
        ) : log.visible.length === 0 ? (
          <div className="mt-5 px-3 text-center text-[12px] text-[var(--hint)]">
            {t('rt.log.noMatch')}
          </div>
        ) : (
          log.visible.map((msg) => {
            const system = msg.direction === 'system'
            const binary = msg.contentType === 'binary'
            return (
              <RealtimeLogRow
                key={msg.id}
                kind={msg.direction}
                title={
                  system ? t(SYSTEM_KEYS[msg.event ?? ''] ?? 'ws.system.connected') : undefined
                }
                tone={system && msg.event === 'error' ? 'error' : undefined}
                preview={msg.content.replace(/\n/g, ' ').slice(0, 200)}
                badge={system ? undefined : messageFormatLabel(msg.contentType, t)}
                timestamp={msg.timestamp}
                sizeBytes={system ? undefined : messageSize(msg.content, binary)}
                typeLabel={system ? undefined : messageFormatLabel(msg.contentType, t)}
                copyText={msg.content}
                onSave={
                  system
                    ? undefined
                    : () =>
                        saveLogged(
                          msg.id,
                          t('rt.saved.defaultName').replace('{n}', String(savedCount + 1)),
                        )
                }
                selected={log.selected.includes(msg.id)}
                onToggleSelect={() => log.toggleSelect(msg.id)}
                expanded={!system && expandedId === msg.id}
                onToggleExpand={() => setExpandedId(expandedId === msg.id ? null : msg.id)}
                testId={system ? 'ws-system' : 'ws-message'}
                testIdPrefix="ws"
                direction={msg.direction}
              >
                <MessageView
                  content={msg.content}
                  binary={binary}
                  initialMode={defaultViewMode(msg.contentType)}
                  testIdPrefix="ws"
                />
              </RealtimeLogRow>
            )
          })
        )}
      </div>
      <div className="flex shrink-0 items-center justify-between border-t border-[var(--border)] bg-[var(--surface)] px-3 py-1.5">
        <span className="text-[var(--muted)]" data-testid="ws-message-counts">
          {t(traffic.length === 1 ? 'ws.countsOne' : 'ws.countsOther')
            .replace('{count}', String(traffic.length))
            .replace('{sent}', String(sentCount))
            .replace('{received}', String(traffic.length - sentCount))}
        </span>
        <label className="flex cursor-pointer items-center gap-1.5">
          <input
            type="checkbox"
            checked={autoScroll}
            onChange={(e) => setAutoScroll(e.target.checked)}
            data-testid="ws-autoscroll"
            className="accent-[var(--accent)]"
          />
          <span className="text-[var(--muted)]">{t('console.autoScroll')}</span>
        </label>
      </div>
    </div>
  )
}
