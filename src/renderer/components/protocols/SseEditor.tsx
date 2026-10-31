import { useState } from 'react'
import { ChevronDown, ChevronRight, Settings2, FileCode2 } from 'lucide-react'
import { useSseStore, type SseBodyType } from '../../stores/sse.store'
import KeyValueTable from '../shared/KeyValueTable'
import { STANDARD_HTTP_HEADERS } from '../../lib/http-headers'
import MonacoWrapper from '../shared/MonacoWrapper'
import SseConnectionBar from './SseConnectionBar'
import SseEventLog from './SseEventLog'
import { useTranslation } from '../../lib/i18n'
import CredentialRowsHint from '../shared/CredentialRowsHint'

export default function SseEditor() {
  const { t } = useTranslation()
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

  const enabledHeaderCount = customHeaders.filter((h) => h.enabled && h.key.trim()).length
  const bodyDisabled = method === 'GET'

  return (
    <div className="flex h-full flex-col overflow-hidden bg-[var(--white)]">
      {/* Tab bar label */}
      <div className="flex shrink-0 items-center gap-2 border-b border-[var(--border)] bg-[var(--white)] px-3.5 py-2">
        {/* The connection state is shown once, by the bar's `sse-status` pill
            (issue #257, sibling of the WebSocket editor) — no header badge. */}
        <span className="font-medium text-[var(--accent-text)]">{t('sse.title')}</span>
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
                data-testid="sse-last-event-id"
                value={lastEventId}
                onChange={(e) => setLastEventId(e.target.value)}
                placeholder={t('sse.lastEventIdPlaceholder')}
                className="w-full rounded-lg border border-[var(--border)] bg-[var(--white)] px-3 py-2 font-mono text-[var(--text)] outline-none transition-colors placeholder:text-[var(--placeholder)] focus:border-[var(--accent)]"
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
            title={bodyDisabled ? t('sse.bodyGetOnly') : undefined}
          >
            {bodyExpanded && !bodyDisabled ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            <FileCode2 size={14} className="text-[var(--muted)]" />
            <span>{t('request.body')}</span>
            {bodyDisabled && (
              <span className="ml-1 text-[var(--muted)]">{t('sse.bodyDisabledForGet')}</span>
            )}
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
                <span className="text-[var(--muted)]">{t('sse.bodyType')}</span>
                {(['json', 'text'] as SseBodyType[]).map((bt) => (
                  <button
                    key={bt}
                    type="button"
                    onClick={() => setBodyType(bt)}
                    className="rounded-md border px-2 py-0.5 transition-colors"
                    style={{
                      background: bodyType === bt ? 'var(--accent-light)' : 'transparent',
                      borderColor: bodyType === bt ? 'var(--accent)' : 'var(--border)',
                      color: bodyType === bt ? 'var(--accent-text)' : 'var(--text)',
                    }}
                  >
                    {bt.toUpperCase()}
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
            <span>{t('sse.customHeaders')}</span>
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
                addLabel={t('kv.addHeader')}
                keyAutocompleteEntries={STANDARD_HTTP_HEADERS}
              />
              <CredentialRowsHint rows={customHeaders} testId="sse-headers-restart-hint" />
            </div>
          )}
        </div>

        {/* Event stream viewer */}
        <SseEventLog />
      </div>
    </div>
  )
}
