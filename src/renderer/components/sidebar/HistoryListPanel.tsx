import { useEffect, useMemo, useState } from 'react'
import { Search, Trash2, Clock, History as HistoryIcon } from 'lucide-react'
import { useHistoryStore } from '../../stores/history.store'
import { useWorkspaceStore } from '../../stores/workspace.store'
import { useRequestStore } from '../../stores/request.store'
import { useResponseStore } from '../../stores/response.store'
import { useTabsStore } from '../../stores/tabs.store'
import { useSoapStore } from '../../stores/soap.store'
import { useUIStore } from '../../stores/ui.store'
import MethodBadge from '../shared/MethodBadge'
import EmptyState from '../shared/EmptyState'
import DeleteConfirmDialog from '../modals/DeleteConfirmDialog'
import type {
  HistoryEntry,
  KeyValuePair,
  RequestBody,
  AuthConfig,
  HttpMethod,
  ApiResponse,
} from '../../types'

/**
 * Postman-style request history list for the left panel — individual requests
 * grouped by date. Runner/suite run history lives on the Tests page
 * (RunnerHistory); it used to be mirrored here too, which duplicated that view
 * and pushed the day's requests down, so it was removed.
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
  const setActiveSidebarPage = useUIStore((s) => s.setActiveSidebarPage)

  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null)

  // Fetch on mount
  useEffect(() => {
    fetch({
      workspaceId: activeWorkspaceId || undefined,
      projectId: activeProjectId || undefined,
      limit: 200,
    })
  }, [activeWorkspaceId, activeProjectId, fetch])

  const filtered = useMemo(() => {
    if (!searchTerm.trim()) return entries
    const q = searchTerm.toLowerCase()
    return entries.filter(
      (e) => e.url.toLowerCase().includes(q) || (e.method || '').toLowerCase().includes(q),
    )
  }, [entries, searchTerm])

  const groups = useMemo(() => groupByDate(filtered), [filtered])

  function handleOpenInTab(entry: HistoryEntry) {
    const snap = (entry.request_snapshot || {}) as Record<string, unknown>
    const tabId = `tab-hist-${entry.id}`
    const protocol = entry.protocol || 'http'

    // History rows live under the History sidebar page, but the tabs they
    // open belong to the APIs workbench. Without flipping the sidebar page
    // first, the Workbench filters the new tab out via tabBelongsToPage and
    // the user sees the History welcome surface instead of the request.
    setActiveSidebarPage('apis')

    openPreviewTab({
      id: tabId,
      name: `${entry.method || 'GET'} ${shortUrl(entry.url)}`,
      protocol,
      method: entry.method,
      url: entry.url,
    })

    // openPreviewTab is synchronous — read the resolved active tab id back
    // out of the store so per-tab state caches key off the right id (a
    // matching existing preview reuses its original id, not `tabId`).
    const realTabId = useTabsStore.getState().activeTabId || tabId

    if (protocol === 'soap') {
      soapSwitchToTab(realTabId)
      clearResponse()
      // SOAP snapshots store wsdl/operation/etc. fields at the top level
      // (see soap.handler.ts addHistory) — not under a nested `soap` key —
      // and the request body lives in `envelope`. Map them onto the shape
      // soapStore.loadFromEndpoint expects so the editor restores wsdl
      // selection + envelope XML.
      const envelope = typeof snap.envelope === 'string' ? snap.envelope : ''
      soapLoadFromEndpoint({
        url: entry.url,
        body: envelope ? { type: 'xml', content: envelope } : undefined,
        headers: snap.headers as
          | Array<{ key: string; value: string; enabled: boolean }>
          | undefined,
        soap: {
          wsdlUrl: snap.wsdlUrl as string | undefined,
          endpointUrl: (snap.endpointUrl as string | undefined) || entry.url,
          operationName: snap.operationName as string | undefined,
          serviceName: snap.serviceName as string | undefined,
          portName: snap.portName as string | undefined,
          soapVersion: snap.soapVersion as 'soap11' | 'soap12' | undefined,
          exampleRequest: envelope,
        },
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
      // Pre-fix history rows (written before the v1.4.4 credential-strip
      // sweep) may have `actualRequest.url` carrying `user:pass@host`
      // userinfo. Scrub it on restore so the Actual Request panel never
      // displays credentials that the rest of the UI already strips.
      // Modern rows are already clean — this is a no-op for them.
      const cleanActualRequest = r.actualRequest
        ? { ...r.actualRequest, url: stripCredentialsInUrl(r.actualRequest.url) ?? '' }
        : r.actualRequest
      setResponse({
        requestId: entry.id,
        protocol,
        status: r.status,
        statusText: r.statusText,
        headers: r.headers,
        body: r.body,
        // Restore the binary flag so an image / PDF body opened from history
        // previews as the file instead of dumping its base64 as text. Rows
        // captured before the flag was persisted still carry a valid base64
        // body, so fall back to inferring it from the content type
        // (issue #25 follow-up).
        bodyEncoding: r.bodyEncoding ?? inferBinaryEncoding(r.headers, r.body),
        bodySize: r.bodySize,
        timing: r.timing || { total: entry.duration_ms || 0 },
        error: r.error,
        // Carry forward the saved test results + console logs so the user
        // who opens an old run (especially a Test Suite request, where
        // pm.test()'s output is the whole point) sees the assertion
        // verdicts and script logs they originally produced. Without
        // these the Tests / Console sub-panes always rendered as empty
        // even when the runner had real data on disk (v1.4.4 §12.4).
        testResults: r.testResults,
        consoleLogs: r.consoleLogs,
        actualRequest: cleanActualRequest,
      })
    }
  }

  // History rows written before `bodyEncoding` was persisted still hold a valid
  // base64 body for binary responses — recover the flag from the content type so
  // those entries preview instead of showing base64 as text. Mirrors the
  // engine's isBinaryContentType families (image/audio/video/font + pdf/octet).
  function inferBinaryEncoding(
    headers: Record<string, string> | undefined,
    body: string | undefined,
  ): 'base64' | undefined {
    if (!body) return undefined
    const ct = (headers?.['content-type'] || headers?.['Content-Type'] || '')
      .split(';')[0]
      .trim()
      .toLowerCase()
    const isBinary =
      ct.startsWith('image/') ||
      ct.startsWith('audio/') ||
      ct.startsWith('video/') ||
      ct.startsWith('font/') ||
      ct === 'application/pdf' ||
      ct === 'application/octet-stream'
    return isBinary ? 'base64' : undefined
  }

  function stripCredentialsInUrl(raw: string | undefined): string | undefined {
    if (!raw) return raw
    try {
      const u = new URL(raw)
      if (u.username || u.password) {
        u.username = ''
        u.password = ''
        return u.toString()
      }
      return raw
    } catch {
      return raw
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
        {groups.length === 0 && (
          <EmptyState
            icon={HistoryIcon}
            title="No history yet."
            description="Send a request to see it appear here."
            variant="compact"
            size="sm"
          />
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
                data-testid="history-entry"
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
