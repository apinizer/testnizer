import { useState } from 'react'
import { ChevronDown, ChevronRight, Settings2 } from 'lucide-react'
import { useSseStore } from '../../stores/sse.store'
import KeyValueTable from '../shared/KeyValueTable'
import SseConnectionBar from './SseConnectionBar'
import SseEventLog from './SseEventLog'

export default function SseEditor() {
  const [headersExpanded, setHeadersExpanded] = useState(false)
  const [lastEventIdExpanded, setLastEventIdExpanded] = useState(false)
  const customHeaders = useSseStore((s) => s.customHeaders)
  const addHeader = useSseStore((s) => s.addHeader)
  const updateHeader = useSseStore((s) => s.updateHeader)
  const removeHeader = useSseStore((s) => s.removeHeader)
  const lastEventId = useSseStore((s) => s.lastEventId)
  const setLastEventId = useSseStore((s) => s.setLastEventId)
  const connectionState = useSseStore((s) => s.connectionState)

  const enabledHeaderCount = customHeaders.filter((h) => h.enabled && h.key.trim()).length

  return (
    <div className="flex h-full flex-col overflow-hidden bg-[var(--white)]">
      {/* Tab bar label */}
      <div className="flex shrink-0 items-center gap-2 border-b border-[var(--border)] bg-[var(--white)] px-3.5 py-2">
        <span className="text-[0.875rem] font-medium" style={{ color: 'var(--accent-text)' }}>
          SSE (Server-Sent Events)
        </span>
        {connectionState === 'connected' && (
          <span
            className="rounded-full px-2 py-0.5 text-[0.875rem] font-medium"
            style={{ background: '#e8f9f1', color: '#1a7a4a' }}
          >
            Connected
          </span>
        )}
      </div>

      {/* Content */}
      <div className="flex flex-1 flex-col gap-3 overflow-y-auto p-3.5">
        {/* Connection bar */}
        <SseConnectionBar />

        {/* Last-Event-ID (collapsible) */}
        <div className="rounded-lg border border-[var(--border)]">
          <button
            type="button"
            onClick={() => setLastEventIdExpanded((v) => !v)}
            className="flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-left text-sm font-medium text-[var(--text)] transition-colors hover:bg-[var(--surface)]"
            style={{ background: 'transparent', border: 'none' }}
          >
            {lastEventIdExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            <span>Last-Event-ID</span>
            {lastEventId.trim() && (
              <span className="ml-1 truncate font-mono text-[0.875rem] text-[var(--muted)]">
                {lastEventId}
              </span>
            )}
          </button>
          {lastEventIdExpanded && (
            <div className="border-t border-[var(--border)] p-3">
              <input
                type="text"
                value={lastEventId}
                onChange={(e) => setLastEventId(e.target.value)}
                placeholder="Optional: resume from this event ID"
                className="w-full rounded-lg border border-[var(--border)] bg-[var(--white)] px-3 py-2 font-mono text-sm text-[var(--text)] outline-none transition-colors placeholder:text-[var(--hint)] focus:border-[var(--accent)]"
              />
            </div>
          )}
        </div>

        {/* Custom headers (collapsible) */}
        <div className="rounded-lg border border-[var(--border)]">
          <button
            type="button"
            onClick={() => setHeadersExpanded((v) => !v)}
            className="flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-left text-sm font-medium text-[var(--text)] transition-colors hover:bg-[var(--surface)]"
            style={{ background: 'transparent', border: 'none' }}
          >
            {headersExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            <Settings2 size={14} className="text-[var(--muted)]" />
            <span>Custom Headers</span>
            {enabledHeaderCount > 0 && (
              <span
                className="ml-1 rounded-full px-[5px] text-[0.875rem]"
                style={{ background: 'var(--green-bg)', color: 'var(--green)' }}
              >
                {enabledHeaderCount}
              </span>
            )}
          </button>
          {headersExpanded && (
            <div className="border-t border-[var(--border)] p-3">
              <KeyValueTable
                rows={customHeaders}
                onUpdate={updateHeader}
                onRemove={removeHeader}
                onAdd={addHeader}
                addLabel="+ Add Header"
              />
            </div>
          )}
        </div>

        {/* Event stream viewer */}
        <SseEventLog />
      </div>
    </div>
  )
}
