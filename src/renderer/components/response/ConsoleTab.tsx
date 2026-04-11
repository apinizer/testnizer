import { useState, useMemo } from 'react'
import {
  Wifi,
  Search as SearchIcon,
  Terminal,
  AlertCircle,
  ChevronDown,
  ChevronRight,
  X,
  MoreHorizontal,
  Maximize2,
} from 'lucide-react'
import { useConsoleStore, type ConsoleLogFilter, type ConsoleEntry } from '../../stores/console.store'

/**
 * Postman-style Console panel (res59.png).
 *
 * Shows a scrollable list of request entries:
 *   ▸ POST http://www.dneonline.com/calculator.asmx     400  433 ms
 *   ▾ POST http://www.dneonline.com/                    405  216 ms
 *        ▸ Network
 *        ▾ Request Headers
 *             Content-Type: "text/xml; charset=utf-8"
 *             ...
 *        ▸ Request Body
 *        ▾ Response Headers
 */
export default function ConsoleTab() {
  const entries = useConsoleStore((s) => s.entries)
  const filter = useConsoleStore((s) => s.filter)
  const setFilter = useConsoleStore((s) => s.setFilter)
  const searchTerm = useConsoleStore((s) => s.searchTerm)
  const setSearchTerm = useConsoleStore((s) => s.setSearchTerm)
  const expandedIds = useConsoleStore((s) => s.expandedIds)
  const toggleExpanded = useConsoleStore((s) => s.toggleExpanded)
  const clear = useConsoleStore((s) => s.clear)
  const isOnline = useConsoleStore((s) => s.isOnline)

  const [showFind, setShowFind] = useState(false)
  const [filterOpen, setFilterOpen] = useState(false)

  // Filter entries
  const filtered = useMemo(() => {
    let list = entries
    if (filter === 'error') {
      list = list.filter((e) => (e.status && e.status >= 400) || e.error)
    } else if (filter === 'warn') {
      list = list.filter((e) => e.status && e.status >= 300 && e.status < 400)
    } else if (filter === 'log' || filter === 'network') {
      // both refer to network log
    }
    if (searchTerm.trim()) {
      const q = searchTerm.toLowerCase()
      list = list.filter((e) =>
        `${e.method} ${e.url}`.toLowerCase().includes(q) ||
        (e.responseBody || '').toLowerCase().includes(q)
      )
    }
    return list
  }, [entries, filter, searchTerm])

  // Error count
  const errorCount = useMemo(
    () => entries.filter((e) => (e.status && e.status >= 400) || e.error).length,
    [entries]
  )

  const FILTER_OPTIONS: Array<{ key: ConsoleLogFilter; label: string }> = [
    { key: 'all', label: 'All Logs' },
    { key: 'network', label: 'Network' },
    { key: 'log', label: 'Logs' },
    { key: 'warn', label: 'Warnings' },
    { key: 'error', label: 'Errors' },
  ]

  return (
    <div className="flex h-full flex-col bg-[var(--white)]">
      {/* ── Top bar — exactly like Postman ── */}
      <div
        className="flex shrink-0 items-center gap-3 px-3"
        style={{
          height: 36,
          borderBottom: '1px solid var(--border)',
          background: 'var(--white)',
        }}
      >
        {/* Left side */}
        <button
          type="button"
          className="flex cursor-pointer items-center gap-1 text-[12px]"
          style={{ background: 'transparent', border: 'none', color: 'var(--muted)' }}
          title="Layout"
        >
          <Maximize2 size={13} />
        </button>

        <span
          className="flex items-center gap-1.5 text-[12px]"
          style={{ color: isOnline ? 'var(--green)' : 'var(--muted)' }}
        >
          <Wifi size={13} />
          Online
        </span>

        <button
          type="button"
          onClick={() => setShowFind((v) => !v)}
          className="flex cursor-pointer items-center gap-1.5 text-[12px]"
          style={{
            background: 'transparent',
            border: 'none',
            color: showFind ? 'var(--accent)' : 'var(--muted)',
          }}
        >
          <SearchIcon size={13} />
          Find and replace
        </button>

        <button
          type="button"
          className="relative flex cursor-pointer items-center gap-1.5 text-[12px]"
          style={{
            background: 'transparent',
            border: 'none',
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
        </button>

        <div className="flex-1" />

        {/* Error count */}
        {errorCount > 0 && (
          <span className="flex items-center gap-1 text-[12px]" style={{ color: 'var(--red)' }}>
            <AlertCircle size={13} />
            {errorCount} Error{errorCount === 1 ? '' : 's'}
          </span>
        )}

        {/* All Logs dropdown */}
        <div className="relative">
          <button
            type="button"
            onClick={() => setFilterOpen((v) => !v)}
            className="flex cursor-pointer items-center gap-1 rounded px-2 py-1 text-[12px]"
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
              <div className="fixed inset-0 z-40" onClick={() => setFilterOpen(false)} />
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
                    onClick={() => { setFilter(o.key); setFilterOpen(false) }}
                    className="flex w-full cursor-pointer items-center gap-2 px-3 py-1.5 text-left text-[12px] hover:bg-[var(--item-hover)]"
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

        {/* Clear */}
        <button
          type="button"
          onClick={clear}
          className="cursor-pointer rounded px-2 py-1 text-[12px]"
          style={{
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            color: 'var(--text)',
          }}
        >
          Clear
        </button>

        <button
          type="button"
          title="More"
          className="cursor-pointer"
          style={{ background: 'transparent', border: 'none', color: 'var(--muted)' }}
        >
          <MoreHorizontal size={14} />
        </button>
      </div>

      {/* Find-and-replace input (toggleable) */}
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
            className="flex-1 text-[12px] outline-none"
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
            onClick={() => { setSearchTerm(''); setShowFind(false) }}
            className="cursor-pointer"
            style={{ background: 'transparent', border: 'none', color: 'var(--muted)' }}
          >
            <X size={12} />
          </button>
        </div>
      )}

      {/* Entry list */}
      <div className="flex-1 overflow-auto">
        {filtered.length === 0 ? (
          <div className="p-8 text-center text-[13px]" style={{ color: 'var(--hint)' }}>
            {entries.length === 0
              ? 'No console entries yet. Send a request to see it here.'
              : 'No entries match your filter.'}
          </div>
        ) : (
          filtered.map((entry) => (
            <ConsoleEntryRow
              key={entry.id}
              entry={entry}
              expanded={expandedIds.has(entry.id)}
              onToggle={() => toggleExpanded(entry.id)}
            />
          ))
        )}
      </div>
    </div>
  )
}

// ────────────────────────────────────────────────────────────────
// Entry row
// ────────────────────────────────────────────────────────────────

function statusColor(status?: number): string {
  if (status == null) return 'var(--muted)'
  if (status >= 200 && status < 300) return 'var(--green)'
  if (status >= 300 && status < 400) return 'var(--blue)'
  if (status >= 400 && status < 500) return 'var(--orange)'
  return 'var(--red)'
}

function ConsoleEntryRow({
  entry,
  expanded,
  onToggle,
}: {
  entry: ConsoleEntry
  expanded: boolean
  onToggle: () => void
}) {
  return (
    <div style={{ borderBottom: '1px solid var(--border-split)' }}>
      {/* Top line — method, url, status, timing */}
      <div
        onClick={onToggle}
        className="flex cursor-pointer items-center gap-2 px-3 py-1.5 font-mono text-[12px]"
        style={{ color: 'var(--text)' }}
        onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'var(--item-hover)' }}
        onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent' }}
      >
        <span style={{ color: 'var(--muted)' }}>
          {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </span>
        <span style={{ color: 'var(--text)', fontWeight: 600 }}>{entry.method}</span>
        <span className="flex-1 truncate" style={{ color: 'var(--text)' }}>{entry.url}</span>
        {entry.status != null && (
          <span className="shrink-0" style={{ color: statusColor(entry.status), fontWeight: 600, minWidth: 32 }}>
            {entry.status}
          </span>
        )}
        <span className="shrink-0" style={{ color: 'var(--green)', minWidth: 70, textAlign: 'right' }}>
          {entry.durationMs != null ? `${entry.durationMs} ms` : '—'}
        </span>
      </div>

      {/* Expanded body — sections */}
      {expanded && (
        <div className="pb-2 pl-6 pr-3 font-mono text-[12px]" style={{ color: 'var(--text)' }}>
          {entry.error && (
            <Section title="Error" defaultOpen>
              <div style={{ color: 'var(--red)' }}>{entry.error}</div>
            </Section>
          )}
          <Section title="Network">
            <KV k="Method" v={entry.method} />
            <KV k="URL" v={entry.url} />
            {entry.status != null && (
              <KV k="Status" v={String(entry.status)} valueColor={statusColor(entry.status)} />
            )}
            {entry.durationMs != null && <KV k="Duration" v={`${entry.durationMs} ms`} />}
          </Section>
          <Section title="Request Headers" defaultOpen>
            {renderHeaders(entry.requestHeaders)}
          </Section>
          {entry.requestBody && (
            <Section title="Request Body">
              <pre className="m-0 whitespace-pre-wrap" style={{ color: 'var(--json-string)' }}>
                {entry.requestBody}
              </pre>
            </Section>
          )}
          <Section title="Response Headers">
            {renderHeaders(entry.responseHeaders)}
          </Section>
          {entry.responseBody && (
            <Section title="Response Body">
              <pre
                className="m-0 max-h-[240px] overflow-auto whitespace-pre-wrap"
                style={{ color: 'var(--text)' }}
              >
                {entry.responseBody}
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
                      l.level === 'error' ? 'var(--red)' :
                      l.level === 'warn' ? 'var(--orange)' : 'var(--text)',
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

// ────────────────────────────────────────────────────────────────
// Section (collapsible)
// ────────────────────────────────────────────────────────────────

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
      <span style={{ color: valueColor || 'var(--json-string)' }}>"{v}"</span>
    </div>
  )
}

function renderHeaders(headers?: Record<string, string>) {
  if (!headers || Object.keys(headers).length === 0) {
    return <div style={{ color: 'var(--hint)' }}>—</div>
  }
  return (
    <>
      {Object.keys(headers).sort().map((k) => (
        <KV key={k} k={k} v={headers[k]} />
      ))}
    </>
  )
}
