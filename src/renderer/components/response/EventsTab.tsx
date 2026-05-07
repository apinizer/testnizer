import { useState } from 'react'
import { useResponseStore } from '../../stores/response.store'
import type { SseEvent } from '../../types'

/**
 * Type → badge color palette (mirrors `SseEventLog` for visual consistency).
 */
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

function isJsonString(str: string): boolean {
  if (!str) return false
  const trimmed = str.trim()
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return false
  try {
    JSON.parse(trimmed)
    return true
  } catch {
    return false
  }
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

/**
 * Static events viewer for HTTP responses served as `text/event-stream`.
 * Reuses the same look-and-feel as the live `SseEventLog`, but reads from
 * `response.sseEvents` (parsed once on the main process) instead of a live
 * connection store.
 */
export default function EventsTab() {
  const events = useResponseStore((s) => s.response?.sseEvents) as SseEvent[] | undefined
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null)

  if (!events || events.length === 0) {
    return (
      <div className="p-4 text-center" style={{ color: 'var(--hint)' }}>
        No events found in response body.
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex shrink-0 items-center gap-2 border-b border-[var(--border)] bg-[var(--surface)] px-3 py-1.5">
        <span className="text-[var(--muted)]">
          {events.length} event{events.length !== 1 ? 's' : ''} parsed from response stream
        </span>
      </div>

      <div className="flex-1 overflow-y-auto">
        {events.map((event, idx) => {
          const isExpanded = expandedIdx === idx
          const typeStyle = getEventTypeStyle(event.type)
          const isJson = isJsonString(event.data)

          return (
            <div
              key={idx}
              className="cursor-pointer border-b border-[var(--border)] px-3 py-1.5 transition-colors hover:bg-[var(--surface)]"
              onClick={() => setExpandedIdx(isExpanded ? null : idx)}
            >
              <div className="flex items-center gap-2">
                <span
                  className="shrink-0 rounded px-1.5 py-0.5 font-medium uppercase"
                  style={{ background: typeStyle.bg, color: typeStyle.color }}
                >
                  {event.type}
                </span>

                <span className="flex-1 truncate font-mono text-[var(--text)]">
                  {truncate((event.data || '').replace(/\n/g, ' '), 120)}
                </span>

                {isJson && (
                  <span
                    className="shrink-0 rounded px-1 py-0.5 font-medium"
                    style={{ background: 'var(--accent-light)', color: 'var(--accent-text)' }}
                  >
                    JSON
                  </span>
                )}

                {event.id && (
                  <span className="shrink-0 font-mono text-[var(--hint)]">
                    id:{event.id}
                  </span>
                )}

                {event.retry != null && (
                  <span className="shrink-0 font-mono text-[var(--hint)]">
                    retry:{event.retry}ms
                  </span>
                )}

                <span className="shrink-0 text-[var(--hint)]">#{idx + 1}</span>
              </div>

              {isExpanded && (
                <pre className="mt-1.5 max-h-96 overflow-auto rounded-lg bg-[var(--surface)] p-2 font-mono text-[var(--text)]">
                  {isJson ? formatJson(event.data) : event.data || '(empty)'}
                </pre>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
