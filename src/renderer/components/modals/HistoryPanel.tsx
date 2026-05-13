import { useEffect, useMemo, useState } from 'react'
import { X, Search, Trash2, Clock } from 'lucide-react'
import { useUIStore } from '../../stores/ui.store'
import { useHistoryStore } from '../../stores/history.store'
import { useWorkspaceStore } from '../../stores/workspace.store'
import { useRequestStore } from '../../stores/request.store'
import { useResponseStore } from '../../stores/response.store'
import { useTabsStore } from '../../stores/tabs.store'
import MethodBadge from '../shared/MethodBadge'
import Modal from '../shared/Modal'
import type {
  HistoryEntry,
  KeyValuePair,
  RequestBody,
  AuthConfig,
  HttpMethod,
  ApiResponse,
} from '../../types'

/**
 * Postman-style History panel — slides in from the right, shows every past
 * request grouped by Today / Yesterday / Earlier. Clicking a row loads the
 * snapshot back into a tab; a right-side detail column previews the selected
 * entry's response headers + body.
 */
export default function HistoryPanel() {
  const show = useUIStore((s) => s.showHistoryPanel)
  const setShow = useUIStore((s) => s.setShowHistoryPanel)

  const entries = useHistoryStore((s) => s.entries)
  const fetch = useHistoryStore((s) => s.fetch)
  const clear = useHistoryStore((s) => s.clear)
  const deleteEntry = useHistoryStore((s) => s.deleteEntry)
  const searchTerm = useHistoryStore((s) => s.searchTerm)
  const setSearchTerm = useHistoryStore((s) => s.setSearchTerm)

  const activeProjectId = useWorkspaceStore((s) => s.activeProjectId)
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId)
  const openTab = useTabsStore((s) => s.openTab)
  const switchToTab = useRequestStore((s) => s.switchToTab)
  const loadFromEndpoint = useRequestStore((s) => s.loadFromEndpoint)
  const setResponse = useResponseStore((s) => s.setResponse)
  const clearResponse = useResponseStore((s) => s.clearResponse)

  const [selectedId, setSelectedId] = useState<string | null>(null)

  // Fetch on open
  useEffect(() => {
    if (show) {
      fetch({
        workspaceId: activeWorkspaceId || undefined,
        projectId: activeProjectId || undefined,
        limit: 200,
      })
    }
  }, [show, activeWorkspaceId, activeProjectId, fetch])

  const filtered = useMemo(() => {
    if (!searchTerm.trim()) return entries
    const q = searchTerm.toLowerCase()
    return entries.filter(
      (e) => e.url.toLowerCase().includes(q) || (e.method || '').toLowerCase().includes(q),
    )
  }, [entries, searchTerm])

  // Group by date bucket
  const groups = useMemo(() => groupByDate(filtered), [filtered])

  const selected = useMemo(
    () => filtered.find((e) => e.id === selectedId) || null,
    [filtered, selectedId],
  )

  if (!show) return null

  function handleOpenInTab(entry: HistoryEntry) {
    const snap = entry.request_snapshot || {}
    const tabId = `tab-hist-${entry.id}`
    openTab({
      id: tabId,
      name: `${entry.method || 'GET'} ${shortUrl(entry.url)}`,
      protocol: entry.protocol,
      method: entry.method,
      url: entry.url,
    })
    switchToTab(tabId)
    clearResponse()
    loadFromEndpoint({
      method: (entry.method || 'GET') as HttpMethod,
      url: entry.url,
      params: (snap.params as KeyValuePair[] | undefined) || [],
      headers: (snap.headers as KeyValuePair[] | undefined) || [],
      body: snap.body as RequestBody | undefined,
      auth: snap.auth as AuthConfig | undefined,
    })
    // Restore response if stored
    if (entry.response_snapshot) {
      const r = entry.response_snapshot as Partial<ApiResponse>
      setResponse({
        requestId: entry.id,
        protocol: entry.protocol,
        status: r.status,
        statusText: r.statusText,
        headers: r.headers,
        body: r.body,
        bodySize: r.bodySize,
        timing: r.timing || { total: entry.duration_ms || 0 },
        error: r.error,
      })
    }
    setShow(false)
  }

  return (
    <Modal
      open={show}
      onOpenChange={setShow}
      title="History"
      zIndex={600}
      contentClassName="fixed inset-y-0 right-0"
    >
      <div
        className="flex h-full flex-col"
        style={{
          width: 860,
          maxWidth: '96vw',
          background: 'var(--white)',
          boxShadow: '-20px 0 60px rgba(0,0,0,0.4)',
          borderLeft: '1px solid var(--border)',
        }}
      >
        {/* Header */}
        <div
          className="flex shrink-0 items-center gap-3 px-4 py-3"
          style={{ borderBottom: '1px solid var(--border)' }}
        >
          <Clock size={16} style={{ color: 'var(--accent)' }} />
          <span className="font-semibold" style={{ color: 'var(--heading)' }}>
            History
          </span>
          <span style={{ color: 'var(--muted)' }}>{entries.length} entries</span>
          <div className="flex-1" />
          <button
            type="button"
            onClick={() => clear(activeWorkspaceId || undefined)}
            className="cursor-pointer rounded px-2 py-1"
            style={{
              background: 'transparent',
              border: '1px solid var(--border)',
              color: 'var(--muted)',
            }}
          >
            Clear History
          </button>
          <button
            type="button"
            onClick={() => setShow(false)}
            className="cursor-pointer"
            style={{ background: 'transparent', border: 'none', color: 'var(--muted)' }}
          >
            <X size={16} />
          </button>
        </div>

        {/* Search */}
        <div
          className="flex shrink-0 items-center gap-2 px-4 py-2"
          style={{ borderBottom: '1px solid var(--border)', background: 'var(--surface)' }}
        >
          <Search size={13} style={{ color: 'var(--muted)' }} />
          <input
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search history..."
            className="flex-1 outline-none"
            style={{
              background: 'var(--white)',
              border: '1px solid var(--border)',
              borderRadius: 4,
              padding: '4px 10px',
              color: 'var(--text)',
            }}
          />
        </div>

        {/* Body — two columns */}
        <div className="flex flex-1 overflow-hidden">
          {/* List */}
          <div
            className="w-[360px] shrink-0 overflow-y-auto"
            style={{ borderRight: '1px solid var(--border)' }}
          >
            {groups.length === 0 && (
              <div className="p-8 text-center" style={{ color: 'var(--hint)' }}>
                No history yet. Send a request to build up history.
              </div>
            )}

            {groups.map(({ label, items }) => (
              <div key={label}>
                <div
                  className="sticky top-0 px-4 py-1.5 font-semibold uppercase tracking-wide"
                  style={{
                    background: 'var(--surface)',
                    color: 'var(--muted)',
                    borderBottom: '1px solid var(--border)',
                  }}
                >
                  {label}
                </div>

                {items.map((entry) => {
                  const isSelected = entry.id === selectedId
                  return (
                    <div
                      key={entry.id}
                      onClick={() => setSelectedId(entry.id)}
                      onDoubleClick={() => handleOpenInTab(entry)}
                      className="group flex cursor-pointer items-center gap-2 px-4 py-2"
                      style={{
                        background: isSelected ? 'var(--accent-light)' : 'transparent',
                        borderBottom: '1px solid var(--border-split)',
                        color: 'var(--text)',
                      }}
                      onMouseEnter={(e) => {
                        if (!isSelected)
                          (e.currentTarget as HTMLElement).style.background = 'var(--item-hover)'
                      }}
                      onMouseLeave={(e) => {
                        if (!isSelected)
                          (e.currentTarget as HTMLElement).style.background = 'transparent'
                      }}
                    >
                      <MethodBadge method={entry.method || 'GET'} small />
                      <span className="flex-1 truncate">{shortUrl(entry.url)}</span>
                      {entry.status_code != null && (
                        <span
                          className="shrink-0 rounded px-1 font-medium"
                          style={{
                            color: statusColor(entry.status_code),
                          }}
                        >
                          {entry.status_code}
                        </span>
                      )}
                      <span className="shrink-0" style={{ color: 'var(--muted)' }}>
                        {formatTime(entry.executed_at)}
                      </span>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          deleteEntry(entry.id)
                        }}
                        className="hidden cursor-pointer group-hover:block"
                        style={{
                          background: 'transparent',
                          border: 'none',
                          color: 'var(--hint)',
                          padding: 2,
                        }}
                      >
                        <Trash2 size={11} />
                      </button>
                    </div>
                  )
                })}
              </div>
            ))}
          </div>

          {/* Detail */}
          <div className="flex-1 overflow-y-auto">
            {selected ? (
              <HistoryDetail entry={selected} onOpen={() => handleOpenInTab(selected)} />
            ) : (
              <div
                className="flex h-full items-center justify-center"
                style={{ color: 'var(--hint)' }}
              >
                Select a history entry to preview it. Double-click to open.
              </div>
            )}
          </div>
        </div>
      </div>
    </Modal>
  )
}

// ────────────────────────────────────────────────────────────────
// Detail view
// ────────────────────────────────────────────────────────────────

function HistoryDetail({ entry, onOpen }: { entry: HistoryEntry; onOpen: () => void }) {
  const resp = entry.response_snapshot
  return (
    <div className="p-4">
      <div className="mb-3 flex items-center gap-2">
        <MethodBadge method={entry.method || 'GET'} />
        <span className="flex-1 truncate font-mono" style={{ color: 'var(--text)' }}>
          {entry.url}
        </span>
        <button
          type="button"
          onClick={onOpen}
          className="cursor-pointer rounded px-2.5 py-1"
          style={{ background: 'var(--accent)', border: 'none', color: '#fff', fontWeight: 600 }}
        >
          Open in tab
        </button>
      </div>

      <div className="mb-3 flex items-center gap-4" style={{ color: 'var(--muted)' }}>
        {entry.status_code != null && (
          <span>
            Status:{' '}
            <span className="font-semibold" style={{ color: statusColor(entry.status_code) }}>
              {entry.status_code}
            </span>
          </span>
        )}
        {entry.duration_ms != null && (
          <span>
            Time:{' '}
            <span className="font-semibold" style={{ color: 'var(--green)' }}>
              {entry.duration_ms} ms
            </span>
          </span>
        )}
        <span>{new Date(entry.executed_at).toLocaleString()}</span>
      </div>

      {resp?.headers && Object.keys(resp.headers).length > 0 && (
        <div className="mb-4">
          <div
            className="mb-1 font-semibold uppercase tracking-wide"
            style={{ color: 'var(--muted)' }}
          >
            Response headers
          </div>
          <div
            className="rounded font-mono"
            style={{ background: 'var(--surface)', border: '1px solid var(--border)', padding: 10 }}
          >
            {Object.entries(resp.headers).map(([k, v]) => (
              <div key={k} className="flex gap-2">
                <span style={{ color: 'var(--json-key)' }}>{k}:</span>
                <span style={{ color: 'var(--json-string)' }}>{v}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {resp?.body && (
        <div>
          <div
            className="mb-1 font-semibold uppercase tracking-wide"
            style={{ color: 'var(--muted)' }}
          >
            Response body
          </div>
          <pre
            className="m-0 max-h-[380px] overflow-auto whitespace-pre-wrap font-mono"
            style={{
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              borderRadius: 4,
              padding: 10,
              color: 'var(--text)',
            }}
          >
            {formatBody(resp.body)}
          </pre>
        </div>
      )}
    </div>
  )
}

// ────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────

function groupByDate(entries: HistoryEntry[]): Array<{ label: string; items: HistoryEntry[] }> {
  const now = new Date()
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const startOfYesterday = startOfToday - 24 * 60 * 60 * 1000

  const today: HistoryEntry[] = []
  const yesterday: HistoryEntry[] = []
  const earlierBuckets = new Map<string, HistoryEntry[]>()

  for (const e of entries) {
    if (e.executed_at >= startOfToday) {
      today.push(e)
    } else if (e.executed_at >= startOfYesterday) {
      yesterday.push(e)
    } else {
      const d = new Date(e.executed_at)
      const key = d.toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      })
      if (!earlierBuckets.has(key)) earlierBuckets.set(key, [])
      earlierBuckets.get(key)!.push(e)
    }
  }

  const out: Array<{ label: string; items: HistoryEntry[] }> = []
  if (today.length) out.push({ label: 'Today', items: today })
  if (yesterday.length) out.push({ label: 'Yesterday', items: yesterday })
  for (const [label, items] of earlierBuckets) {
    out.push({ label, items })
  }
  return out
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
}

function shortUrl(url: string): string {
  try {
    const u = new URL(url)
    return u.host + u.pathname
  } catch {
    return url
  }
}

function statusColor(code: number): string {
  if (code >= 200 && code < 300) return 'var(--green)'
  if (code >= 300 && code < 400) return 'var(--blue)'
  if (code >= 400 && code < 500) return 'var(--orange)'
  return 'var(--red)'
}

function formatBody(body: string): string {
  try {
    return JSON.stringify(JSON.parse(body), null, 2)
  } catch {
    return body
  }
}
