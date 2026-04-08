import { useState, useEffect, useRef } from 'react'
import { Unplug, Trash2 } from 'lucide-react'
import { useGraphQLStore } from '../../stores/graphql.store'

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

function truncate(str: string, max: number): string {
  return str.length > max ? str.slice(0, max) + '...' : str
}

export default function GraphQLSubscriptionLog() {
  const events = useGraphQLStore((s) => s.subscriptionEvents)
  const clearEvents = useGraphQLStore((s) => s.clearSubscriptionEvents)
  const unsubscribe = useGraphQLStore((s) => s.unsubscribe)
  const subscriptionState = useGraphQLStore((s) => s.subscriptionState)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [autoScroll, setAutoScroll] = useState(true)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (autoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [events, autoScroll])

  return (
    <div className="flex h-full flex-col overflow-hidden bg-[var(--white)]">
      {/* Header */}
      <div className="flex shrink-0 items-center justify-between border-b border-[var(--border)] px-3.5 py-2">
        <div className="flex items-center gap-2">
          <span className="text-[0.875rem] font-medium" style={{ color: 'var(--accent-text)' }}>
            Subscription Events
          </span>
          <span
            className="rounded-full px-2 py-0.5 text-[0.875rem] font-medium"
            style={{ background: '#e8f9f1', color: '#1a7a4a' }}
          >
            Live
          </span>
        </div>
        <button
          type="button"
          onClick={unsubscribe}
          className="flex cursor-pointer items-center gap-1.5 rounded-lg px-3 py-1.5 text-[0.875rem] font-medium text-white transition-opacity"
          style={{ background: '#cc2200', border: 'none' }}
        >
          <Unplug size={12} />
          Unsubscribe
        </button>
      </div>

      {/* Event list */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        {events.length === 0 ? (
          <div className="flex h-full items-center justify-center text-sm text-[var(--hint)]">
            Waiting for subscription events...
          </div>
        ) : (
          events.map((event) => {
            const isExpanded = expandedId === event.id
            return (
              <div
                key={event.id}
                className="cursor-pointer border-b border-[var(--border)] px-3 py-1.5 transition-colors hover:bg-[var(--surface)]"
                onClick={() => setExpandedId(isExpanded ? null : event.id)}
              >
                <div className="flex items-center gap-2">
                  <span
                    className="shrink-0 rounded px-1.5 py-0.5 text-[0.643rem] font-medium uppercase"
                    style={{ background: 'var(--accent-light)', color: 'var(--accent-text)' }}
                  >
                    DATA
                  </span>
                  <span className="flex-1 truncate font-mono text-[0.875rem] text-[var(--text)]">
                    {truncate(event.data.replace(/\n/g, ' '), 80)}
                  </span>
                  <span className="shrink-0 text-[0.875rem] text-[var(--hint)]">
                    {formatTimestamp(event.timestamp)}
                  </span>
                </div>
                {isExpanded && (
                  <pre className="mt-1.5 max-h-48 overflow-auto rounded-lg bg-[var(--surface)] p-2 font-mono text-[0.875rem] text-[var(--text)]">
                    {formatJson(event.data)}
                  </pre>
                )}
              </div>
            )
          })
        )}
      </div>

      {/* Footer */}
      <div className="flex shrink-0 items-center justify-between border-t border-[var(--border)] bg-[var(--surface)] px-3 py-1.5">
        <span className="text-[0.875rem] text-[var(--muted)]">
          {events.length} event{events.length !== 1 ? 's' : ''}
        </span>
        <div className="flex items-center gap-3">
          <label className="flex cursor-pointer items-center gap-1.5">
            <input
              type="checkbox"
              checked={autoScroll}
              onChange={(e) => setAutoScroll(e.target.checked)}
              className="accent-[var(--accent)]"
            />
            <span className="text-[0.875rem] text-[var(--muted)]">Auto-scroll</span>
          </label>
          <button
            type="button"
            onClick={clearEvents}
            className="flex cursor-pointer items-center gap-1 text-[0.875rem] text-[var(--hint)] transition-colors hover:text-[var(--text)]"
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
