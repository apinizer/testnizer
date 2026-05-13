import { useEffect, useMemo, useState, useCallback } from 'react'
import { Search, Trash2, Clock, FolderClosed, Play, ChevronRight, ChevronDown } from 'lucide-react'
import { useHistoryStore } from '../../stores/history.store'
import { useWorkspaceStore } from '../../stores/workspace.store'
import { useRequestStore } from '../../stores/request.store'
import { useResponseStore } from '../../stores/response.store'
import { useTabsStore } from '../../stores/tabs.store'
import { useSoapStore } from '../../stores/soap.store'
import MethodBadge from '../shared/MethodBadge'
import DeleteConfirmDialog from '../modals/DeleteConfirmDialog'
import type {
  HistoryEntry,
  KeyValuePair,
  RequestBody,
  AuthConfig,
  HttpMethod,
  ApiResponse,
  Tab,
} from '../../types'
import type { EndpointRunResult, RunnerReport } from '../../stores/runner.store'

/* ── Runner history row ───────────────────────────────────── */

interface RunHistoryRow {
  id: string
  project_id: string
  duration_ms: number
  total_endpoints: number
  passed_endpoints: number
  failed_endpoints: number
  total_tests: number
  failed_tests: number
  avg_resp_time: number
  results_json: string | null
  started_at: number
  /**
   * Optional in the SQLite row — present only after the `folder_name`
   * column migration, so we accept undefined too.
   */
  folder_name?: string | null
}

/**
 * Postman-style history list for the left panel.
 * Shows requests grouped by date + runner runs grouped by folder.
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
  const openTab = useTabsStore((s) => s.openTab)
  const switchToTab = useRequestStore((s) => s.switchToTab)
  const loadFromEndpoint = useRequestStore((s) => s.loadFromEndpoint)
  const setResponse = useResponseStore((s) => s.setResponse)
  const clearResponse = useResponseStore((s) => s.clearResponse)
  const soapSwitchToTab = useSoapStore((s) => s.switchToTab)
  const soapLoadFromEndpoint = useSoapStore((s) => s.loadFromEndpoint)

  const [runHistory, setRunHistory] = useState<RunHistoryRow[]>([])
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set(['__all__']))
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null)

  // Fetch on mount
  useEffect(() => {
    fetch({
      workspaceId: activeWorkspaceId || undefined,
      projectId: activeProjectId || undefined,
      limit: 200,
    })
  }, [activeWorkspaceId, activeProjectId, fetch])

  // Fetch runner history
  useEffect(() => {
    if (!activeProjectId) return
    window.api?.runner
      ?.history(activeProjectId)
      .then((result) => {
        if (result?.success && result.data) setRunHistory(result.data)
      })
      .catch(() => {})
  }, [activeProjectId])

  const filtered = useMemo(() => {
    if (!searchTerm.trim()) return entries
    const q = searchTerm.toLowerCase()
    return entries.filter(
      (e) => e.url.toLowerCase().includes(q) || (e.method || '').toLowerCase().includes(q),
    )
  }, [entries, searchTerm])

  const groups = useMemo(() => groupByDate(filtered), [filtered])

  // Group runner history by folder_name
  const runGroups = useMemo(() => {
    const map = new Map<string, RunHistoryRow[]>()
    for (const run of runHistory) {
      const key = run.folder_name || 'All Endpoints'
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(run)
    }
    return Array.from(map.entries()).map(([folder, runs]) => ({ folder, runs }))
  }, [runHistory])

  const toggleFolder = useCallback((key: string) => {
    setExpandedFolders((s) => {
      const next = new Set(s)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }, [])

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

    const realTabId = useTabsStore.getState().activeTabId || tabId

    if (protocol === 'soap') {
      soapSwitchToTab(realTabId)
      soapLoadFromEndpoint({
        url: entry.url,
        body: snap.body as { type: string; content?: string } | undefined,
        headers: snap.headers as
          | Array<{ key: string; value: string; enabled: boolean }>
          | undefined,
        soap: (snap as Record<string, unknown>).soap as Record<string, unknown> | undefined,
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

  const handleOpenRunReport = useCallback(
    (run: RunHistoryRow) => {
      if (!run.results_json) return
      try {
        const results = JSON.parse(run.results_json) as EndpointRunResult[]
        const tabs = useTabsStore.getState().tabs
        const existing = tabs.find((t: Tab) => t.protocol === 'runner')
        const tabId = existing ? existing.id : 'runner-main'
        const newSessionKey = String(Date.now())

        sessionStorage.setItem(
          `runner-report-${tabId}`,
          JSON.stringify({
            results,
            report: {
              projectId: run.project_id,
              startedAt: run.started_at,
              completedAt: run.started_at + run.duration_ms,
              totalEndpoints: run.total_endpoints,
              passedEndpoints: run.passed_endpoints,
              failedEndpoints: run.failed_endpoints,
              totalAssertions: run.total_tests,
              passedAssertions: run.total_tests - run.failed_tests,
              failedAssertions: run.failed_tests,
              results,
            },
            startedAt: run.started_at,
          }),
        )

        if (existing) {
          useTabsStore.getState().setActiveTab(existing.id)
          useTabsStore.getState().updateTab(existing.id, { sessionKey: newSessionKey })
        } else {
          openTab({ id: tabId, name: 'Runner', protocol: 'runner', sessionKey: newSessionKey })
        }
      } catch {
        /* invalid JSON */
      }
    },
    [openTab],
  )

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div
        className="flex shrink-0 items-center gap-2 px-3 py-2"
        style={{ borderBottom: '1px solid var(--border)' }}
      >
        <Clock size={13} style={{ color: 'var(--accent)' }} />
        <span style={{ color: 'var(--text)', fontSize: 13, fontWeight: 600 }}>History</span>
        <span style={{ fontSize: 13, color: 'var(--muted)' }}>{entries.length}</span>
        <div className="flex-1" />
        <button
          type="button"
          onClick={() => clear(activeWorkspaceId || undefined)}
          className="cursor-pointer rounded px-1.5 py-0.5"
          style={{
            background: 'transparent',
            border: '1px solid var(--border)',
            color: 'var(--muted)',
            fontSize: 13,
          }}
          title="Clear all history"
        >
          Clear
        </button>
      </div>

      {/* Search */}
      <div className="shrink-0 px-2.5 py-2" style={{ borderBottom: '1px solid var(--border)' }}>
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
            className="w-full border-none bg-transparent outline-none"
            style={{ color: 'var(--text)', fontSize: 13, fontFamily: 'inherit' }}
          />
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto">
        {/* ── Runner Runs grouped by folder ── */}
        {runGroups.length > 0 && (
          <div>
            {runGroups.map(({ folder, runs }) => {
              const isExpanded = expandedFolders.has(folder)
              return (
                <div key={folder}>
                  {/* Folder header */}
                  <button
                    type="button"
                    onClick={() => toggleFolder(folder)}
                    className="flex w-full cursor-pointer items-center gap-1.5 border-none bg-transparent px-3 py-[6px] text-left"
                    style={{
                      borderBottom: '1px solid var(--border)',
                      background: 'var(--surface)',
                    }}
                  >
                    <span style={{ color: 'var(--hint)', display: 'flex', alignItems: 'center' }}>
                      {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                    </span>
                    <FolderClosed
                      size={13}
                      style={{ color: 'var(--tree-folder)', flexShrink: 0 }}
                    />
                    <span style={{ flex: 1, fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>
                      {folder}
                    </span>
                    <span style={{ fontSize: 13, color: 'var(--hint)', flexShrink: 0 }}>
                      {runs.length}
                    </span>
                  </button>

                  {/* Run entries under this folder */}
                  {isExpanded &&
                    runs.map((run) => (
                      <div
                        key={run.id}
                        onClick={() => handleOpenRunReport(run)}
                        className="flex cursor-pointer items-center gap-2 px-3 py-[6px] pl-8"
                        style={{ borderBottom: '1px solid var(--border)' }}
                        onMouseEnter={(e) => {
                          ;(e.currentTarget as HTMLElement).style.background = 'var(--item-hover)'
                        }}
                        onMouseLeave={(e) => {
                          ;(e.currentTarget as HTMLElement).style.background = 'transparent'
                        }}
                      >
                        <Play size={11} style={{ color: 'var(--accent)', flexShrink: 0 }} />
                        <span style={{ fontSize: 13, color: 'var(--text)', flex: 1 }}>
                          {formatDate(run.started_at)}
                        </span>
                        <span
                          style={{
                            fontSize: 13,
                            color: run.failed_endpoints > 0 ? 'var(--red)' : 'var(--green)',
                            flexShrink: 0,
                          }}
                        >
                          {run.passed_endpoints}/{run.total_endpoints}
                        </span>
                        <span style={{ fontSize: 13, color: 'var(--hint)', flexShrink: 0 }}>
                          {formatDuration(run.duration_ms)}
                        </span>
                      </div>
                    ))}
                </div>
              )
            })}
          </div>
        )}

        {/* ── Regular request history ── */}
        {groups.length === 0 && runGroups.length === 0 && (
          <div className="px-3 py-8 text-center" style={{ color: 'var(--hint)', fontSize: 13 }}>
            No history yet.
          </div>
        )}

        {groups.map(({ label, items }) => (
          <div key={label}>
            {/* Date group header */}
            <div
              className="sticky top-0 z-10 px-3 py-1 font-semibold uppercase tracking-wide"
              style={{
                background: 'var(--surface)',
                color: 'var(--muted)',
                borderBottom: '1px solid var(--border)',
                fontSize: 13,
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
                  borderBottom: '1px solid var(--border)',
                  color: 'var(--text)',
                }}
                onMouseEnter={(e) => {
                  ;(e.currentTarget as HTMLElement).style.background = 'var(--item-hover)'
                }}
                onMouseLeave={(e) => {
                  ;(e.currentTarget as HTMLElement).style.background = 'transparent'
                }}
              >
                <MethodBadge method={entry.method || 'GET'} small />
                <span className="flex-1 truncate" style={{ fontSize: 13 }}>
                  {shortUrl(entry.url)}
                </span>
                {entry.status_code != null && (
                  <span
                    className="shrink-0 font-medium"
                    style={{ color: statusColor(entry.status_code), fontSize: 13 }}
                  >
                    {entry.status_code}
                  </span>
                )}
                <span className="shrink-0" style={{ color: 'var(--hint)', fontSize: 13 }}>
                  {formatTime(entry.executed_at)}
                </span>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    setDeleteTargetId(entry.id)
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

      <DeleteConfirmDialog
        open={!!deleteTargetId}
        itemName="this history entry"
        itemType="history entry"
        onConfirm={() => {
          if (deleteTargetId) deleteEntry(deleteTargetId)
          setDeleteTargetId(null)
        }}
        onCancel={() => setDeleteTargetId(null)}
      />
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

function formatDate(ts: number): string {
  const d = new Date(ts)
  const now = new Date()
  const isToday = d.toDateString() === now.toDateString()
  if (isToday) return 'Today ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  return (
    d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) +
    ' ' +
    d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  )
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
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
