import { useState } from 'react'
import { ChevronDown, ChevronRight, Settings2, FileCode2 } from 'lucide-react'
import { useSseStore, type SseBodyType } from '../../stores/sse.store'
import KeyValueTable from '../shared/KeyValueTable'
import { STANDARD_HTTP_HEADERS } from '../../lib/http-headers'
import MonacoWrapper from '../shared/MonacoWrapper'
import SseConnectionBar from './SseConnectionBar'
import SseEventLog from './SseEventLog'

export default function SseEditor() {
  const [headersExpanded, setHeadersExpanded] = useState(false)
  const [lastEventIdExpanded, setLastEventIdExpanded] = useState(false)
  const [bodyExpanded, setBodyExpanded] = useState(false)
  const customHeaders = useSseStore((s) => s.customHeaders)
  const addHeader = useSseStore((s) => s.addHeader)
  const updateHeader = useSseStore((s) => s.updateHeader)
  const removeHeader = useSseStore((s) => s.removeHeader)
  const lastEventId = useSseStore((s) => s.lastEventId)
  const setLastEventId = useSseStore((s) => s.setLastEventId)
  const method = useSseStore((s) => s.method)
  const body = useSseStore((s) => s.body)
  const setBody = useSseStore((s) => s.setBody)
  const bodyType = useSseStore((s) => s.bodyType)
  const setBodyType = useSseStore((s) => s.setBodyType)
  const connectionState = useSseStore((s) => s.connectionState)

  const enabledHeaderCount = customHeaders.filter((h) => h.enabled && h.key.trim()).length
  const bodyDisabled = method === 'GET'

  return (
    <div className="flex h-full flex-col overflow-hidden bg-[var(--white)]">
      {/* Tab bar label */}
      <div className="flex shrink-0 items-center gap-2 border-b border-[var(--border)] bg-[var(--white)] px-3.5 py-2">
        <span className="font-medium" style={{ color: 'var(--accent-text)' }}>
          SSE (Server-Sent Events)
        </span>
        {connectionState === 'connected' && (
          <span
            className="rounded-full px-2 py-0.5 font-medium"
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
            className="flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-left font-medium text-[var(--text)] transition-colors hover:bg-[var(--surface)]"
            style={{ background: 'transparent', border: 'none' }}
          >
            {lastEventIdExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            <span>Last-Event-ID</span>
            {lastEventId.trim() && (
              <span className="ml-1 truncate font-mono text-[var(--muted)]">{lastEventId}</span>
            )}
          </button>
          {lastEventIdExpanded && (
            <div className="border-t border-[var(--border)] p-3">
              <input
                type="text"
                value={lastEventId}
                onChange={(e) => setLastEventId(e.target.value)}
                placeholder="Optional: resume from this event ID"
                className="w-full rounded-lg border border-[var(--border)] bg-[var(--white)] px-3 py-2 font-mono text-[var(--text)] outline-none transition-colors placeholder:text-[var(--hint)] focus:border-[var(--accent)]"
              />
            </div>
          )}
        </div>

        {/* Body (collapsible) — disabled for GET */}
        <div
          className="rounded-lg border border-[var(--border)]"
          style={bodyDisabled ? { opacity: 0.6 } : undefined}
        >
          <button
            type="button"
            onClick={() => !bodyDisabled && setBodyExpanded((v) => !v)}
            disabled={bodyDisabled}
            className="flex w-full items-center gap-2 px-3 py-2 text-left font-medium text-[var(--text)] transition-colors hover:bg-[var(--surface)] disabled:cursor-not-allowed"
            style={{ background: 'transparent', border: 'none' }}
            title={bodyDisabled ? 'Body is only available for non-GET methods' : undefined}
          >
            {bodyExpanded && !bodyDisabled ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            <FileCode2 size={14} className="text-[var(--muted)]" />
            <span>Body</span>
            {bodyDisabled && <span className="ml-1 text-[var(--muted)]">(disabled for GET)</span>}
            {!bodyDisabled && body.trim() && (
              <span
                className="ml-1 rounded-full px-[5px]"
                style={{ background: 'var(--green-bg)', color: 'var(--green)' }}
              >
                {bodyType.toUpperCase()}
              </span>
            )}
          </button>
          {bodyExpanded && !bodyDisabled && (
            <div className="border-t border-[var(--border)] p-3">
              <div className="mb-2 flex items-center gap-2">
                <span className="text-[var(--muted)]">Type:</span>
                {(['json', 'text'] as SseBodyType[]).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setBodyType(t)}
                    className="rounded-md border px-2 py-0.5 transition-colors"
                    style={{
                      background: bodyType === t ? 'var(--accent-light)' : 'transparent',
                      borderColor: bodyType === t ? 'var(--accent)' : 'var(--border)',
                      color: bodyType === t ? 'var(--accent-text)' : 'var(--text)',
                    }}
                  >
                    {t.toUpperCase()}
                  </button>
                ))}
              </div>
              <div
                className="overflow-hidden rounded-md border border-[var(--border)]"
                style={{ height: 200 }}
              >
                <MonacoWrapper
                  value={body}
                  onChange={setBody}
                  language={bodyType === 'json' ? 'json' : 'plaintext'}
                  height="100%"
                />
              </div>
            </div>
          )}
        </div>

        {/* Custom headers (collapsible) */}
        <div className="rounded-lg border border-[var(--border)]">
          <button
            type="button"
            onClick={() => setHeadersExpanded((v) => !v)}
            className="flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-left font-medium text-[var(--text)] transition-colors hover:bg-[var(--surface)]"
            style={{ background: 'transparent', border: 'none' }}
          >
            {headersExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            <Settings2 size={14} className="text-[var(--muted)]" />
            <span>Custom Headers</span>
            {enabledHeaderCount > 0 && (
              <span
                className="ml-1 rounded-full px-[5px]"
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
                keyAutocompleteEntries={STANDARD_HTTP_HEADERS}
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
