import { useState, useMemo, useRef, useEffect, useCallback } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import {
  Wifi,
  Search as SearchIcon,
  Terminal,
  AlertCircle,
  ChevronDown,
  ChevronRight,
  X,
  Maximize2,
  ArrowDown,
  ArrowUp,
} from 'lucide-react'
import {
  useConsoleStore,
  selectFilteredEntries,
  type ConsoleLogFilter,
  type ConsoleLogEntry,
} from '../../stores/console.store'
import { useUIStore } from '../../stores/ui.store'
import EmptyState from '../shared/EmptyState'

/**
 * Postman-style Console panel.
 *
 * Renders the global ConsoleStore entries as a scrollable, virtualized
 * list. Each row is collapsible: clicking it expands inline detail
 * sections (network meta, request/response headers, request/response
 * body, errors, script logs).
 *
 * Filtering: protocol chips (All/HTTP/WS/gRPC/GraphQL/SOAP/SSE/Errors),
 * free-text search.
 *
 * When `tabFilterId` is provided, only entries with that tabId are
 * shown — used to reuse this view inside a single request's response
 * pane.
 */
export interface ConsoleTabProps {
  /** When set, only entries whose tabId matches are displayed. */
  tabFilterId?: string
}

export default function ConsoleTab({ tabFilterId }: ConsoleTabProps = {}) {
  const entries = useConsoleStore((s) => s.entries)
  const filter = useConsoleStore((s) => s.filter)
  const setFilter = useConsoleStore((s) => s.setFilter)
  const searchTerm = useConsoleStore((s) => s.searchTerm)
  const setSearchTerm = useConsoleStore((s) => s.setSearchTerm)
  const expandedIds = useConsoleStore((s) => s.expandedIds)
  const toggleExpanded = useConsoleStore((s) => s.toggleExpanded)
  const clear = useConsoleStore((s) => s.clear)
  const isOnline = useConsoleStore((s) => s.isOnline)
  const autoScroll = useConsoleStore((s) => s.autoScroll)
  const setAutoScroll = useConsoleStore((s) => s.setAutoScroll)

  const [showFind, setShowFind] = useState(false)
  const [filterOpen, setFilterOpen] = useState(false)

  // Apply protocol/level + search filtering, plus per-tab filter (when
  // this view is rendered inside a single-request response pane).
  const filtered = useMemo(
    () =>
      selectFilteredEntries(entries, {
        filter,
        searchTerm,
        activeTabIdFilter: tabFilterId ?? null,
      }),
    [entries, filter, searchTerm, tabFilterId],
  )

  const errorCount = useMemo(
    () =>
      filtered.filter((e) => e.level === 'error' || (e.status != null && e.status >= 400)).length,
    [filtered],
  )

  const FILTER_OPTIONS: Array<{ key: ConsoleLogFilter; label: string }> = [
    { key: 'all', label: 'All Logs' },
    { key: 'http', label: 'HTTP' },
    { key: 'soap', label: 'SOAP' },
    { key: 'graphql', label: 'GraphQL' },
    { key: 'grpc', label: 'gRPC' },
    { key: 'websocket', label: 'WebSocket' },
    { key: 'sse', label: 'SSE' },
    { key: 'socketio', label: 'Socket.IO' },
    { key: 'mcp', label: 'MCP' },
    { key: 'ai', label: 'AI Chat' },
    { key: 'warn', label: 'Warnings' },
    { key: 'error', label: 'Errors' },
  ]

  // ── Virtualization ──────────────────────────────────────────
  const scrollerRef = useRef<HTMLDivElement | null>(null)
  const virtualizer = useVirtualizer({
    count: filtered.length,
    getScrollElement: () => scrollerRef.current,
    estimateSize: (index) => (expandedIds.has(filtered[index]?.id) ? 320 : 28),
    overscan: 8,
    measureElement: (el) => el.getBoundingClientRect().height,
  })

  // Re-measure when expansion state changes
  useEffect(() => {
    virtualizer.measure()
  }, [expandedIds, virtualizer])

  // Auto-scroll to bottom when new entries arrive
  useEffect(() => {
    if (!autoScroll) return
    if (filtered.length === 0) return
    virtualizer.scrollToIndex(filtered.length - 1, { align: 'end' })
  }, [filtered.length, autoScroll, virtualizer])

  const onClear = useCallback(() => clear(), [clear])

  return (
    <div className="flex h-full flex-col bg-[var(--white)]">
      {/* ── Top bar ── */}
      <div
        className="flex shrink-0 items-center gap-3 pl-3"
        style={{
          // 40px right padding leaves room for the ConsolePanel close
          // (chevron-down) button, which is rendered as an absolute-
          // positioned overlay at top:8, right:10. Without this, the
          // close button sat directly on top of the "Clear" action.
          paddingRight: 40,
          height: 36,
          borderBottom: '1px solid var(--border)',
          background: 'var(--white)',
        }}
      >
        <ConsoleLayoutToggle inResponsePane={!!tabFilterId} />

        <span
          className="flex items-center gap-1.5"
          style={{ color: isOnline ? 'var(--green)' : 'var(--muted)' }}
        >
          <Wifi size={13} />
          Online
        </span>

        <button
          type="button"
          onClick={() => setShowFind((v) => !v)}
          className="flex cursor-pointer items-center gap-1.5"
          style={{
            background: 'transparent',
            border: 'none',
            color: showFind ? 'var(--accent)' : 'var(--muted)',
          }}
        >
          <SearchIcon size={13} />
          Find
        </button>

        <span
          className="flex items-center gap-1.5"
          style={{
            color: 'var(--accent)',
            borderBottom: '2px solid var(--accent)',
            height: 35,
            marginBottom: -1,
            paddingLeft: 4,
            paddingRight: 4,
            fontWeight: 600,
          }}
        >
          <Terminal size={13} />
          Console
          <span style={{ color: 'var(--muted)', fontWeight: 400 }}>{filtered.length}</span>
        </span>

        <div className="flex-1" />

        <button
          type="button"
          onClick={() => setAutoScroll(!autoScroll)}
          className="flex cursor-pointer items-center gap-1 rounded px-2 py-1"
          title="Auto-scroll"
          style={{
            background: autoScroll ? 'var(--accentLight)' : 'transparent',
            border: '1px solid var(--border)',
            color: autoScroll ? 'var(--accentText)' : 'var(--muted)',
          }}
        >
          {autoScroll ? <ArrowDown size={11} /> : <ArrowUp size={11} />}
          Auto
        </button>

        {errorCount > 0 && (
          <span className="flex items-center gap-1" style={{ color: 'var(--red)' }}>
            <AlertCircle size={13} />
            {errorCount}
          </span>
        )}

        {/* Filter dropdown */}
        <div className="relative">
          <button
            type="button"
            onClick={() => setFilterOpen((v) => !v)}
            className="flex cursor-pointer items-center gap-1 rounded px-2 py-1"
            style={{
              background: 'transparent',
              border: '1px solid var(--border)',
              color: 'var(--text)',
            }}
          >
            {FILTER_OPTIONS.find((o) => o.key === filter)?.label || 'All Logs'}
            <ChevronDown size={11} />
          </button>
          {filterOpen && (
            <>
              <div
                role="presentation"
                aria-hidden="true"
                className="fixed inset-0 z-40"
                onClick={() => setFilterOpen(false)}
              />
              <div
                className="absolute right-0 top-full z-50 mt-1 min-w-[140px] rounded-md py-1 shadow-lg"
                style={{
                  background: 'var(--white)',
                  border: '1px solid var(--border)',
                }}
              >
                {FILTER_OPTIONS.map((o) => (
                  <button
                    key={o.key}
                    type="button"
                    onClick={() => {
                      setFilter(o.key)
                      setFilterOpen(false)
                    }}
                    className="flex w-full cursor-pointer items-center gap-2 px-3 py-1.5 text-left hover:bg-[var(--item-hover)]"
                    style={{
                      background: 'transparent',
                      border: 'none',
                      color: o.key === filter ? 'var(--accent)' : 'var(--text)',
                      fontWeight: o.key === filter ? 600 : 400,
                    }}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        <button
          type="button"
          onClick={onClear}
          className="cursor-pointer rounded px-2 py-1"
          style={{
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            color: 'var(--text)',
          }}
        >
          Clear
        </button>
      </div>

      {/* Find input */}
      {showFind && (
        <div
          className="flex shrink-0 items-center gap-2 px-3 py-1.5"
          style={{ background: 'var(--surface)', borderBottom: '1px solid var(--border)' }}
        >
          <SearchIcon size={11} style={{ color: 'var(--muted)' }} />
          <input
            autoFocus
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Find in console..."
            className="flex-1 outline-none"
            style={{
              background: 'var(--white)',
              border: '1px solid var(--border)',
              borderRadius: 4,
              padding: '3px 8px',
              color: 'var(--text)',
            }}
          />
          <button
            type="button"
            onClick={() => {
              setSearchTerm('')
              setShowFind(false)
            }}
            className="cursor-pointer"
            style={{ background: 'transparent', border: 'none', color: 'var(--muted)' }}
          >
            <X size={12} />
          </button>
        </div>
      )}

      {/* Virtualized list */}
      <div ref={scrollerRef} className="flex-1 overflow-auto" data-testid="console-list">
        {filtered.length === 0 ? (
          entries.length === 0 ? (
            <EmptyState
              icon={Terminal}
              title="No console entries yet"
              description="Send a request to see it here."
              size="sm"
            />
          ) : (
            <EmptyState icon={SearchIcon} title="No entries match your filter." size="sm" />
          )
        ) : (
          <div
            style={{
              height: virtualizer.getTotalSize(),
              width: '100%',
              position: 'relative',
            }}
          >
            {virtualizer.getVirtualItems().map((vi) => {
              const entry = filtered[vi.index]
              if (!entry) return null
              return (
                <div
                  key={entry.id}
                  data-index={vi.index}
                  ref={(el) => {
                    if (el) virtualizer.measureElement(el)
                  }}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    transform: `translateY(${vi.start}px)`,
                  }}
                >
                  <ConsoleEntryRow
                    entry={entry}
                    expanded={expandedIds.has(entry.id)}
                    onToggle={() => toggleExpanded(entry.id)}
                  />
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

// ────────────────────────────────────────────────────────────────
// Entry row
// ────────────────────────────────────────────────────────────────

function statusColor(status?: number, level?: string): string {
  if (level === 'error') return 'var(--red)'
  if (level === 'warning') return 'var(--orange)'
  if (level === 'success') return 'var(--green)'
  if (status == null) return 'var(--muted)'
  if (status >= 200 && status < 300) return 'var(--green)'
  if (status >= 300 && status < 400) return 'var(--blue)'
  if (status >= 400 && status < 500) return 'var(--orange)'
  return 'var(--red)'
}

function protocolBadgeColor(protocol: string): string {
  switch (protocol) {
    case 'http':
      return 'var(--blue)'
    case 'soap':
      return 'var(--accent)'
    case 'graphql':
      return '#e535ab'
    case 'grpc':
      return '#0a7a5a'
    case 'websocket':
      return 'var(--orange)'
    case 'sse':
      return 'var(--green)'
    default:
      return 'var(--muted)'
  }
}

function formatTime(ts: number): string {
  const d = new Date(ts)
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  const ss = String(d.getSeconds()).padStart(2, '0')
  const ms = String(d.getMilliseconds()).padStart(3, '0')
  return `${hh}:${mm}:${ss}.${ms}`
}

function ConsoleEntryRow({
  entry,
  expanded,
  onToggle,
}: {
  entry: ConsoleLogEntry
  expanded: boolean
  onToggle: () => void
}) {
  return (
    <div style={{ borderBottom: '1px solid var(--border-split)' }}>
      <div
        onClick={onToggle}
        className="flex cursor-pointer items-center gap-2 px-3 py-1 font-mono"
        style={{ color: 'var(--text)', fontSize: 12, lineHeight: '20px', minHeight: 28 }}
        onMouseEnter={(e) => {
          ;(e.currentTarget as HTMLElement).style.background = 'var(--item-hover)'
        }}
        onMouseLeave={(e) => {
          ;(e.currentTarget as HTMLElement).style.background = 'transparent'
        }}
      >
        <span style={{ color: 'var(--muted)' }}>
          {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </span>
        <span style={{ color: 'var(--hint)', minWidth: 90 }}>{formatTime(entry.timestamp)}</span>
        <span
          style={{
            background: protocolBadgeColor(entry.protocol),
            color: '#fff',
            padding: '0 6px',
            borderRadius: 3,
            fontSize: 10,
            fontWeight: 700,
            minWidth: 50,
            textAlign: 'center',
          }}
        >
          {entry.protocol.toUpperCase()}
        </span>
        {entry.method && (
          <span style={{ color: 'var(--text)', fontWeight: 600, minWidth: 50 }}>
            {entry.method}
          </span>
        )}
        <span className="flex-1 truncate" style={{ color: 'var(--text)' }}>
          {entry.message ?? entry.url ?? ''}
        </span>
        {entry.status != null && (
          <span
            className="shrink-0"
            style={{
              color: statusColor(entry.status, entry.level),
              fontWeight: 600,
              minWidth: 36,
              textAlign: 'right',
            }}
          >
            {entry.status}
          </span>
        )}
        <span
          className="shrink-0"
          style={{ color: 'var(--muted)', minWidth: 70, textAlign: 'right' }}
        >
          {entry.durationMs != null ? `${entry.durationMs} ms` : ''}
        </span>
      </div>

      {expanded && (
        <div
          data-testid="actual-request-panel"
          className="pb-2 pl-6 pr-3 font-mono"
          style={{ color: 'var(--text)', fontSize: 12 }}
        >
          {entry.details?.error && (
            <Section title="Error" defaultOpen>
              <div style={{ color: 'var(--red)' }}>{entry.details.error.message}</div>
              {entry.details.error.stack && (
                <pre className="m-0 mt-1 whitespace-pre-wrap" style={{ color: 'var(--muted)' }}>
                  {entry.details.error.stack}
                </pre>
              )}
            </Section>
          )}

          <Section title="Network">
            {entry.method && <KV k="Method" v={entry.method} />}
            {entry.url && <KV k="URL" v={entry.url} />}
            <KV k="Protocol" v={entry.protocol} />
            <KV k="Category" v={entry.category} />
            {entry.status != null && (
              <KV
                k="Status"
                v={String(entry.status)}
                valueColor={statusColor(entry.status, entry.level)}
              />
            )}
            {entry.statusText && <KV k="Status Text" v={entry.statusText} />}
            {entry.durationMs != null && <KV k="Duration" v={`${entry.durationMs} ms`} />}
            {entry.sizeBytes != null && <KV k="Size" v={`${entry.sizeBytes} B`} />}
            {entry.details?.direction && <KV k="Direction" v={entry.details.direction} />}
            {entry.details?.eventName && <KV k="Event" v={entry.details.eventName} />}
            {entry.details?.meta &&
              Object.entries(entry.details.meta).map(([k, v]) => (
                <KV key={k} k={k} v={String(v)} />
              ))}
          </Section>

          {entry.details?.requestHeaders && (
            <Section title="Request Headers" defaultOpen>
              {renderHeaders(entry.details.requestHeaders)}
            </Section>
          )}
          {entry.details?.requestBody && (
            <Section title="Request Body">
              <pre
                className="m-0 max-h-[240px] overflow-auto whitespace-pre-wrap"
                style={{ color: 'var(--json-string, #b35a00)' }}
              >
                {entry.details.requestBody}
              </pre>
            </Section>
          )}
          {entry.details?.responseHeaders && (
            <Section title="Response Headers">
              {renderHeaders(entry.details.responseHeaders)}
            </Section>
          )}
          {entry.details?.responseBody && (
            <Section title="Response Body">
              <pre
                className="m-0 max-h-[240px] overflow-auto whitespace-pre-wrap"
                style={{ color: 'var(--text)' }}
              >
                {entry.details.responseBody}
              </pre>
            </Section>
          )}
          {entry.scriptLogs && entry.scriptLogs.length > 0 && (
            <Section title="Script Logs" defaultOpen>
              {entry.scriptLogs.map((l, i) => (
                <div
                  key={i}
                  style={{
                    color:
                      l.level === 'error'
                        ? 'var(--red)'
                        : l.level === 'warn'
                          ? 'var(--orange)'
                          : 'var(--text)',
                  }}
                >
                  {l.message}
                </div>
              ))}
            </Section>
          )}
        </div>
      )}
    </div>
  )
}

function Section({
  title,
  children,
  defaultOpen = false,
}: {
  title: string
  children: React.ReactNode
  defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="mb-0.5">
      <div
        onClick={() => setOpen(!open)}
        className="flex cursor-pointer select-none items-center gap-1"
        style={{ color: 'var(--muted)' }}
      >
        {open ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
        <span>{title}</span>
      </div>
      {open && <div className="pl-4">{children}</div>}
    </div>
  )
}

function KV({ k, v, valueColor }: { k: string; v: string; valueColor?: string }) {
  return (
    <div className="flex gap-2">
      <span style={{ color: 'var(--muted)' }}>{k}:</span>
      <span style={{ color: valueColor || 'var(--json-string, #b35a00)' }}>"{v}"</span>
    </div>
  )
}

function renderHeaders(headers?: Record<string, string>) {
  if (!headers || Object.keys(headers).length === 0) {
    return <div style={{ color: 'var(--hint)' }}>—</div>
  }
  return (
    <>
      {Object.keys(headers)
        .sort()
        .map((k) => (
          <KV key={k} k={k} v={headers[k]} />
        ))}
    </>
  )
}

/**
 * Layout toggle for the Console header. When rendered inside the response
 * pane (tabFilterId set), the button promotes the in-pane console to the
 * global bottom panel. When rendered inside that bottom panel, it toggles
 * between the user-resized height and a near-fullscreen maximised view.
 */
function ConsoleLayoutToggle({ inResponsePane }: { inResponsePane: boolean }) {
  const setShowConsolePanel = useUIStore((s) => s.setShowConsolePanel)
  const maximized = useUIStore((s) => s.consolePanelMaximized)
  const toggleMaximized = useUIStore((s) => s.toggleConsolePanelMaximized)

  const handleClick = inResponsePane ? () => setShowConsolePanel(true) : () => toggleMaximized()

  const title = inResponsePane ? 'Open in bottom panel' : maximized ? 'Restore' : 'Maximize'

  return (
    <button
      type="button"
      onClick={handleClick}
      className="flex cursor-pointer items-center gap-1"
      style={{ background: 'transparent', border: 'none', color: 'var(--muted)' }}
      title={title}
    >
      <Maximize2 size={13} />
    </button>
  )
}
