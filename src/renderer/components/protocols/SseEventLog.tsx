import { useState, useEffect, useRef } from 'react'
import { Trash2, Filter } from 'lucide-react'
import { useSseStore } from '../../stores/sse.store'

const EVENT_TYPE_COLORS: Record<string, { bg: string; color: string }> = {
  message: { bg: '#e8f4ff', color: '#0066cc' },
  update: { bg: '#e8f9f1', color: '#1a7a4a' },
  notification: { bg: '#fff4e0', color: '#b35a00' },
  heartbeat: { bg: '#f0f0f0', color: '#888888' },
  error: { bg: '#fff0f0', color: '#cc2200' },
}

function getEventTypeStyle(type: string): { bg: string; color: string } {
  return EVENT_TYPE_COLORS[type] || { bg: 'var(--accent-light)', color: 'var(--accent-text)' }
}

function formatTimestamp(ts: number): string {
  const d = new Date(ts)
  return (
    d.toLocaleTimeString('en-US', {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }) +
    '.' +
    String(d.getMilliseconds()).padStart(3, '0')
  )
}

function formatJson(str: string): string {
  try {
    return JSON.stringify(JSON.parse(str), null, 2)
  } catch {
    return str
  }
}

function isJsonString(str: string): boolean {
  try {
    JSON.parse(str)
    return true
  } catch {
    return false
  }
}

function truncate(str: string, max: number): string {
  return str.length > max ? str.slice(0, max) + '...' : str
}

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)
  if (hours > 0) return `${hours}h ${minutes % 60}m`
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`
  return `${seconds}s`
}

export default function SseEventLog() {
  const events = useSseStore((s) => s.events)
  const clearEvents = useSseStore((s) => s.clearEvents)
  const autoScroll = useSseStore((s) => s.autoScroll)
  const setAutoScroll = useSseStore((s) => s.setAutoScroll)
  const eventTypeFilter = useSseStore((s) => s.eventTypeFilter)
  const setEventTypeFilter = useSseStore((s) => s.setEventTypeFilter)
  const getFilteredEvents = useSseStore((s) => s.getFilteredEvents)
  const getEventTypes = useSseStore((s) => s.getEventTypes)
  const connectionState = useSseStore((s) => s.connectionState)
  const connectedAt = useSseStore((s) => s.connectedAt)

  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [now, setNow] = useState(Date.now())
  const scrollRef = useRef<HTMLDivElement>(null)

  const filteredEvents = getFilteredEvents()
  const eventTypes = getEventTypes()

  useEffect(() => {
    if (autoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [events, autoScroll])

  // Update duration display
  useEffect(() => {
    if (connectionState !== 'connected') return
    const interval = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(interval)
  }, [connectionState])

  return (
    <div className="flex flex-1 flex-col overflow-hidden rounded-lg border border-[var(--border)]">
      {/* Filter bar */}
      {eventTypes.length > 1 && (
        <div className="flex shrink-0 items-center gap-2 border-b border-[var(--border)] bg-[var(--surface)] px-3 py-1.5">
          <Filter size={12} className="shrink-0 text-[var(--muted)]" />
          <select
            value={eventTypeFilter}
            onChange={(e) => setEventTypeFilter(e.target.value)}
            className="rounded border border-[var(--border)] bg-[var(--white)] px-2 py-0.5 text-[var(--text)] outline-none"
          >
            <option value="">All events</option>
            {eventTypes.map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </select>
          <span className="text-[var(--hint)]">
            {filteredEvents.length} of {events.length}
          </span>
        </div>
      )}

      {/* Events */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        {filteredEvents.length === 0 ? (
          <div className="flex h-full items-center justify-center text-[var(--hint)]">
            {connectionState === 'connected'
              ? 'Waiting for events...'
              : 'Connect to an SSE endpoint to begin.'}
          </div>
        ) : (
          filteredEvents.map((event, idx) => {
            const eventKey = `${event.type}-${event.timestamp}-${idx}`
            const isExpanded = expandedId === eventKey
            const typeStyle = getEventTypeStyle(event.type)
            const isJson = isJsonString(event.data)

            return (
              <div
                key={eventKey}
                className="cursor-pointer border-b border-[var(--border)] px-3 py-1.5 transition-colors hover:bg-[var(--surface)]"
                onClick={() => setExpandedId(isExpanded ? null : eventKey)}
              >
                <div className="flex items-center gap-2">
                  {/* Type badge */}
                  <span
                    className="shrink-0 rounded px-1.5 py-0.5 font-medium uppercase"
                    style={{ background: typeStyle.bg, color: typeStyle.color }}
                  >
                    {event.type}
                  </span>

                  {/* Data preview */}
                  <span className="flex-1 truncate font-mono text-[var(--text)]">
                    {truncate(event.data.replace(/\n/g, ' '), 80)}
                  </span>

                  {/* JSON badge */}
                  {isJson && (
                    <span
                      className="shrink-0 rounded px-1 py-0.5 font-medium"
                      style={{ background: 'var(--accent-light)', color: 'var(--accent-text)' }}
                    >
                      JSON
                    </span>
                  )}

                  {/* Event ID */}
                  {event.id && (
                    <span className="shrink-0 font-mono text-[var(--hint)]">id:{event.id}</span>
                  )}

                  {/* Timestamp */}
                  <span className="shrink-0 text-[var(--hint)]">
                    {formatTimestamp(event.timestamp)}
                  </span>
                </div>

                {/* Expanded content */}
                {isExpanded && (
                  <pre className="mt-1.5 max-h-48 overflow-auto rounded-lg bg-[var(--surface)] p-2 font-mono text-[var(--text)]">
                    {isJson ? formatJson(event.data) : event.data}
                  </pre>
                )}
              </div>
            )
          })
        )}
      </div>

      {/* Footer */}
      <div className="flex shrink-0 items-center justify-between border-t border-[var(--border)] bg-[var(--surface)] px-3 py-1.5">
        <div className="flex items-center gap-3">
          <span className="text-[var(--muted)]">
            {events.length} event{events.length !== 1 ? 's' : ''}
          </span>
          {connectionState === 'connected' && connectedAt && (
            <span className="text-[var(--hint)]">{formatDuration(now - connectedAt)}</span>
          )}
        </div>
        <div className="flex items-center gap-3">
          <label className="flex cursor-pointer items-center gap-1.5">
            <input
              type="checkbox"
              checked={autoScroll}
              onChange={(e) => setAutoScroll(e.target.checked)}
              className="accent-[var(--accent)]"
            />
            <span className="text-[var(--muted)]">Auto-scroll</span>
          </label>
          <button
            type="button"
            onClick={clearEvents}
            className="flex cursor-pointer items-center gap-1 text-[var(--hint)] transition-colors hover:text-[var(--text)]"
            style={{ background: 'transparent', border: 'none' }}
          >
            <Trash2 size={11} />
            Clear
          </button>
        </div>
      </div>
    </div>
  )
}
