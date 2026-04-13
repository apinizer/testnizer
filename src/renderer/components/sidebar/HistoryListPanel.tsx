import { useEffect, useMemo } from 'react'
import { Search, Trash2, Clock } from 'lucide-react'
import { useHistoryStore } from '../../stores/history.store'
import { useWorkspaceStore } from '../../stores/workspace.store'
import { useRequestStore } from '../../stores/request.store'
import { useResponseStore } from '../../stores/response.store'
import { useTabsStore } from '../../stores/tabs.store'
import { useSoapStore } from '../../stores/soap.store'
import MethodBadge from '../shared/MethodBadge'
import type { HistoryEntry, KeyValuePair, RequestBody, AuthConfig, HttpMethod, ApiResponse } from '../../types'

/**
 * Postman-style history list for the left panel.
 * Shows requests grouped by date. Clicking opens in a tab.
 */
export default function HistoryListPanel() {
  const entries = useHistoryStore((s) => s.entries)
  const fetch = useHistoryStore((s) => s.fetch)
  const clear = useHistoryStore((s) => s.clear)
  const deleteEntry = useHistoryStore((s) => s.deleteEntry)
  const searchTerm = useHistoryStore((s) => s.searchTerm)
  const setSearchTerm = useHistoryStore((s) => s.setSearchTerm)

  const activeProjectId = useWorkspaceStore((s) => s.activeProjectId)
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId)
  const openPreviewTab = useTabsStore((s) => s.openPreviewTab)
  const switchToTab = useRequestStore((s) => s.switchToTab)
  const loadFromEndpoint = useRequestStore((s) => s.loadFromEndpoint)
  const setResponse = useResponseStore((s) => s.setResponse)
  const clearResponse = useResponseStore((s) => s.clearResponse)
  const soapSwitchToTab = useSoapStore((s) => s.switchToTab)
  const soapLoadFromEndpoint = useSoapStore((s) => s.loadFromEndpoint)

  // Fetch on mount
  useEffect(() => {
    fetch({ workspaceId: activeWorkspaceId || undefined, projectId: activeProjectId || undefined, limit: 200 })
  }, [activeWorkspaceId, activeProjectId, fetch])

  const filtered = useMemo(() => {
    if (!searchTerm.trim()) return entries
    const q = searchTerm.toLowerCase()
    return entries.filter((e) => e.url.toLowerCase().includes(q) || (e.method || '').toLowerCase().includes(q))
  }, [entries, searchTerm])

  const groups = useMemo(() => groupByDate(filtered), [filtered])

  function handleOpenInTab(entry: HistoryEntry) {
    const snap = entry.request_snapshot || {}
    const tabId = `tab-hist-${entry.id}`
    const protocol = entry.protocol || 'http'

    openPreviewTab({
      id: tabId,
      name: `${entry.method || 'GET'} ${shortUrl(entry.url)}`,
      protocol,
      method: entry.method,
      url: entry.url,
    })

    // Get actual tab ID (may be reused preview tab)
    const realTabId = useTabsStore.getState().activeTabId || tabId

    if (protocol === 'soap') {
      soapSwitchToTab(realTabId)
      soapLoadFromEndpoint({
        url: entry.url,
        body: snap.body as { type: string; content?: string } | undefined,
        headers: snap.headers as Array<{ key: string; value: string; enabled: boolean }> | undefined,
        soap: snap.soap as Record<string, unknown> | undefined,
      })
    } else {
      switchToTab(realTabId)
      clearResponse()
      loadFromEndpoint({
        method: (entry.method || 'GET') as HttpMethod,
        url: entry.url,
        params: (snap.params as KeyValuePair[] | undefined) || [],
        headers: (snap.headers as KeyValuePair[] | undefined) || [],
        body: snap.body as RequestBody | undefined,
        auth: snap.auth as AuthConfig | undefined,
      })
    }

    // Restore response if stored
    if (entry.response_snapshot) {
      const r = entry.response_snapshot as Partial<ApiResponse>
      setResponse({
        requestId: entry.id,
        protocol,
        status: r.status,
        statusText: r.statusText,
        headers: r.headers,
        body: r.body,
        bodySize: r.bodySize,
        timing: r.timing || { total: entry.duration_ms || 0 },
        error: r.error,
      })
    }
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div
        className="flex shrink-0 items-center gap-2 px-3 py-2"
        style={{ borderBottom: '1px solid var(--border)' }}
      >
        <Clock size={13} style={{ color: 'var(--accent)' }} />
        <span className="text-[12px] font-semibold" style={{ color: 'var(--text)' }}>
          History
        </span>
        <span className="text-[10px]" style={{ color: 'var(--muted)' }}>
          {entries.length}
        </span>
        <div className="flex-1" />
        <button
          type="button"
          onClick={() => clear(activeWorkspaceId || undefined)}
          className="cursor-pointer rounded px-1.5 py-0.5 text-[10px]"
          style={{
            background: 'transparent',
            border: '1px solid var(--border)',
            color: 'var(--muted)',
          }}
          title="Clear all history"
        >
          Clear
        </button>
      </div>

      {/* Search */}
      <div
        className="shrink-0 px-2.5 py-2"
        style={{ borderBottom: '1px solid var(--border)' }}
      >
        <div
          className="flex items-center gap-1.5 rounded-md px-2 py-1"
          style={{
            background: 'var(--surface)',
            border: '1px solid var(--border2)',
          }}
        >
          <Search size={12} style={{ color: 'var(--muted)', flexShrink: 0 }} />
          <input
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Filter history..."
            className="flex-1 text-[12px] outline-none"
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--text)',
            }}
          />
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto">
        {groups.length === 0 && (
          <div className="px-3 py-8 text-center text-[12px]" style={{ color: 'var(--hint)' }}>
            No history yet.
          </div>
        )}

        {groups.map(({ label, items }) => (
          <div key={label}>
            {/* Date group header */}
            <div
              className="sticky top-0 z-10 px-3 py-1 text-[10px] font-semibold uppercase tracking-wide"
              style={{
                background: 'var(--surface)',
                color: 'var(--muted)',
                borderBottom: '1px solid var(--border)',
              }}
            >
              {label}
            </div>

            {items.map((entry) => (
              <div
                key={entry.id}
                onClick={() => handleOpenInTab(entry)}
                className="group flex cursor-pointer items-center gap-1.5 px-3 py-[6px]"
                style={{
                  borderBottom: '1px solid var(--border-split, var(--border))',
                  color: 'var(--text)',
                }}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLElement).style.background = 'var(--item-hover, var(--surface))'
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLElement).style.background = 'transparent'
                }}
              >
                <MethodBadge method={entry.method || 'GET'} small />
                <span className="flex-1 truncate text-[12px]">
                  {shortUrl(entry.url)}
                </span>
                {entry.status_code != null && (
                  <span
                    className="shrink-0 text-[10px] font-medium"
                    style={{ color: statusColor(entry.status_code) }}
                  >
                    {entry.status_code}
                  </span>
                )}
                <span className="shrink-0 text-[9px]" style={{ color: 'var(--hint)' }}>
                  {formatTime(entry.executed_at)}
                </span>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    deleteEntry(entry.id)
                  }}
                  className="hidden shrink-0 cursor-pointer group-hover:block"
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: 'var(--hint)',
                    padding: 1,
                  }}
                >
                  <Trash2 size={10} />
                </button>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Helpers ──────────────────────────────────────────────────

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
      const key = d.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })
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
