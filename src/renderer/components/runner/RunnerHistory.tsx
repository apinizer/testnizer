import { useEffect, useState, useCallback } from 'react'
import { useWorkspaceStore } from '../../stores/workspace.store'
import { ArrowLeft, BarChart2, ChevronLeft, ChevronRight, Inbox } from 'lucide-react'
import type { EndpointRunResult, RunnerReport } from '../../stores/runner.store'
import DeleteConfirmDialog from '../modals/DeleteConfirmDialog'
import EmptyState from '../shared/EmptyState'

interface RunHistoryRow {
  id: string
  project_id: string
  environment_name: string | null
  source: string
  source_label: string | null
  iterations: number
  duration_ms: number
  total_endpoints: number
  passed_endpoints: number
  failed_endpoints: number
  total_tests: number
  passed_tests: number
  failed_tests: number
  skipped_tests: number
  avg_resp_time: number
  results_json: string | null
  started_at: number
}

type HistoryTab = 'Functional' | 'Scheduled'

const PAGE_SIZE = 20

interface RunnerHistoryProps {
  onBack: () => void
  onNewRun?: () => void
  onViewReport?: (
    results: EndpointRunResult[],
    report: RunnerReport,
    startedAt: number,
    sourceLabel?: string,
  ) => void
}

export default function RunnerHistory({ onBack, onNewRun, onViewReport }: RunnerHistoryProps) {
  const activeProjectId = useWorkspaceStore((s) => s.activeProjectId)
  const [runs, setRuns] = useState<RunHistoryRow[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [activeTab, setActiveTab] = useState<HistoryTab>('Functional')
  const [page, setPage] = useState(0)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)

  const loadRuns = useCallback(() => {
    if (!activeProjectId) return
    setLoading(true)
    setLoadError(null)
    window.api?.runner
      ?.history({
        projectId: activeProjectId,
        tab: activeTab,
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
      })
      .then((result: unknown) => {
        const res = result as {
          success: boolean
          data?: { rows: RunHistoryRow[]; total: number }
          error?: string
        }
        if (res?.success && res.data) {
          setRuns(res.data.rows)
          setTotal(res.data.total)
        } else if (res?.error) {
          // Without this branch the user just saw an empty list when the
          // DB query failed and had no way to know something went wrong.
          setLoadError(res.error)
          setRuns([])
          setTotal(0)
        }
        setLoading(false)
      })
      .catch((err) => {
        setLoadError(err instanceof Error ? err.message : String(err))
        setLoading(false)
      })
  }, [activeProjectId, activeTab, page])

  useEffect(() => {
    loadRuns()
  }, [loadRuns])

  const toggleSelect = (id: string) => {
    setSelectedIds((s) => {
      const next = new Set(s)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const allSelected = runs.length > 0 && runs.every((r) => selectedIds.has(r.id))
  const someSelected = runs.some((r) => selectedIds.has(r.id))

  const toggleSelectAll = () => {
    if (allSelected) {
      // Deselect every row currently on page
      setSelectedIds((s) => {
        const next = new Set(s)
        for (const r of runs) next.delete(r.id)
        return next
      })
    } else {
      setSelectedIds((s) => {
        const next = new Set(s)
        for (const r of runs) next.add(r.id)
        return next
      })
    }
  }

  const handleDeleteClick = () => {
    if (selectedIds.size === 0) return
    setShowDeleteConfirm(true)
  }

  const handleDeleteConfirm = async () => {
    setShowDeleteConfirm(false)
    const ids = Array.from(selectedIds)
    try {
      const res = (await window.api?.runner?.deleteHistory(ids)) as { success: boolean }
      if (res?.success) {
        setSelectedIds(new Set())
        // Reset to first page if current page would be empty after deletion
        const remaining = total - ids.length
        const maxPage = Math.max(0, Math.ceil(remaining / PAGE_SIZE) - 1)
        if (page > maxPage) setPage(maxPage)
        else loadRuns()
      }
    } catch {
      // deletion failed silently
    }
  }

  const handleViewReport = (run: RunHistoryRow) => {
    if (!run.results_json || !onViewReport) return
    try {
      const results = JSON.parse(run.results_json) as EndpointRunResult[]
      const report: RunnerReport = {
        projectId: run.project_id,
        startedAt: run.started_at,
        completedAt: run.started_at + run.duration_ms,
        totalEndpoints: run.total_endpoints,
        passedEndpoints: run.passed_endpoints,
        failedEndpoints: run.failed_endpoints,
        totalAssertions: run.total_tests,
        passedAssertions: run.passed_tests,
        failedAssertions: run.failed_tests,
        results,
      }
      const sourceLabel = run.source_label || run.source || 'Runner'
      onViewReport(results, report, run.started_at, sourceLabel)
    } catch {
      // invalid JSON
    }
  }

  const tabDescription =
    activeTab === 'Scheduled'
      ? 'Runs triggered automatically via Scheduled Tasks.'
      : 'Runs triggered for this collection via Collection Runner.'

  return (
    <div className="flex flex-1 flex-col overflow-hidden" style={{ fontSize: 13 }}>
      {/* Header */}
      <div className="flex shrink-0 items-center gap-3 border-b border-[var(--border)] px-5 py-3">
        <button
          type="button"
          onClick={onBack}
          className="flex cursor-pointer items-center gap-1 border-none bg-transparent text-[var(--accent)] hover:underline"
        >
          <ArrowLeft size={14} />
          Back
        </button>
        <h2 style={{ fontSize: 15, fontWeight: 600, color: 'var(--text)', margin: 0, flex: 1 }}>
          All Runs
        </h2>
        {onNewRun && (
          <button
            type="button"
            onClick={onNewRun}
            className="flex cursor-pointer items-center gap-1.5 rounded-[6px] border-none px-4 py-1.5 font-medium text-white hover:opacity-90"
            style={{ fontSize: 13, background: '#e86826' }}
          >
            + New Run
          </button>
        )}
      </div>

      {/* Tabs */}
      <div className="flex shrink-0 items-center gap-0 border-b border-[var(--border)] px-5">
        {(['Functional', 'Scheduled'] as const).map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => {
              setActiveTab(tab)
              setSelectedIds(new Set())
              setPage(0)
            }}
            className="cursor-pointer border-none bg-transparent px-3 py-2"
            style={{
              color: activeTab === tab ? 'var(--text)' : 'var(--muted)',
              fontWeight: activeTab === tab ? 600 : 400,
              borderBottom: activeTab === tab ? '2px solid var(--accent)' : '2px solid transparent',
              marginBottom: -1,
            }}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* Description */}
      <div className="shrink-0 px-5 py-2" style={{ fontSize: 13, color: 'var(--muted)' }}>
        {tabDescription}
      </div>

      {/* Selection bar */}
      {selectedIds.size > 0 && (
        <div className="flex shrink-0 items-center justify-between border-b border-[var(--border)] bg-[var(--surface)] px-5 py-2">
          <span className="text-[var(--text)]">{selectedIds.size} item selected</span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setSelectedIds(new Set())}
              className="cursor-pointer border-none bg-transparent text-[var(--muted)] hover:text-[var(--text)]"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleDeleteClick}
              className="cursor-pointer rounded-[6px] border-none bg-[#cc2200] px-3 py-1 font-medium text-white hover:opacity-90"
            >
              Delete
            </button>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="flex-1 overflow-auto px-5">
        {loading ? (
          <div className="py-8 text-center text-[var(--hint)]">Loading...</div>
        ) : loadError ? (
          <div className="py-8 text-center" style={{ color: 'var(--red, #cc2200)' }}>
            Failed to load history: {loadError}
            <div className="mt-2">
              <button
                type="button"
                onClick={() => loadRuns()}
                className="cursor-pointer rounded border border-[var(--border)] bg-[var(--white)] px-3 py-1 text-[var(--text)] hover:bg-[var(--surface)]"
              >
                Retry
              </button>
            </div>
          </div>
        ) : runs.length === 0 ? (
          <EmptyState
            icon={Inbox}
            title={activeTab === 'Scheduled' ? 'No scheduled runs yet' : 'No runs yet'}
            description={
              activeTab === 'Scheduled'
                ? 'Create a scheduled task to see runs here.'
                : 'Start a run to see history here.'
            }
            size="md"
          />
        ) : (
          <table className="w-full" style={{ fontSize: 13 }}>
            <thead>
              <tr className="border-b border-[var(--border)] text-left">
                <th className="w-8 py-2">
                  <input
                    type="checkbox"
                    aria-label="Select all"
                    checked={allSelected}
                    ref={(el) => {
                      if (el) el.indeterminate = !allSelected && someSelected
                    }}
                    onChange={toggleSelectAll}
                    className="h-[14px] w-[14px] cursor-pointer accent-[var(--accent)]"
                  />
                </th>
                <th className="py-2 pr-4" style={{ fontWeight: 600, color: 'var(--muted)' }}>
                  Start time
                </th>
                <th className="py-2 pr-4" style={{ fontWeight: 600, color: 'var(--muted)' }}>
                  Source
                </th>
                <th className="py-2 pr-4" style={{ fontWeight: 600, color: 'var(--muted)' }}>
                  Environment
                </th>
                <th className="py-2 pr-4" style={{ fontWeight: 600, color: 'var(--muted)' }}>
                  Iterations
                </th>
                <th className="py-2 pr-4" style={{ fontWeight: 600, color: 'var(--muted)' }}>
                  Duration
                </th>
                <th className="py-2 pr-4" style={{ fontWeight: 600, color: 'var(--muted)' }}>
                  All tests
                </th>
                <th className="py-2 pr-4" style={{ fontWeight: 600, color: 'var(--muted)' }}>
                  Passed
                </th>
                <th className="py-2 pr-4" style={{ fontWeight: 600, color: 'var(--muted)' }}>
                  Failed
                </th>
                <th className="py-2 pr-4" style={{ fontWeight: 600, color: 'var(--muted)' }}>
                  Skipped
                </th>
                <th className="py-2 pr-4" style={{ fontWeight: 600, color: 'var(--muted)' }}>
                  Avg. Resp. Time
                </th>
                <th className="w-16 py-2" />
              </tr>
            </thead>
            <tbody>
              {runs.map((run) => (
                <HistoryRow
                  key={run.id}
                  run={run}
                  isSelected={selectedIds.has(run.id)}
                  onToggle={() => toggleSelect(run.id)}
                  onViewReport={() => handleViewReport(run)}
                  hasViewReport={!!onViewReport && !!run.results_json}
                />
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Pagination */}
      {!loading && total > PAGE_SIZE && (
        <div className="flex shrink-0 items-center justify-between border-t border-[var(--border)] px-5 py-2">
          <span style={{ color: 'var(--muted)', fontSize: 13 }}>
            Showing {page * PAGE_SIZE + 1}-{Math.min((page + 1) * PAGE_SIZE, total)} of {total}
          </span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={page === 0}
              className="flex cursor-pointer items-center gap-1 rounded-[6px] border px-2 py-1 disabled:cursor-not-allowed disabled:opacity-40"
              style={{
                borderColor: 'var(--border)',
                background: 'var(--white)',
                color: 'var(--text)',
                fontSize: 13,
              }}
            >
              <ChevronLeft size={14} />
              Prev
            </button>
            <span style={{ color: 'var(--muted)', fontSize: 13, padding: '0 8px' }}>
              Page {page + 1} / {Math.max(1, Math.ceil(total / PAGE_SIZE))}
            </span>
            <button
              type="button"
              onClick={() => setPage((p) => ((p + 1) * PAGE_SIZE < total ? p + 1 : p))}
              disabled={(page + 1) * PAGE_SIZE >= total}
              className="flex cursor-pointer items-center gap-1 rounded-[6px] border px-2 py-1 disabled:cursor-not-allowed disabled:opacity-40"
              style={{
                borderColor: 'var(--border)',
                background: 'var(--white)',
                color: 'var(--text)',
                fontSize: 13,
              }}
            >
              Next
              <ChevronRight size={14} />
            </button>
          </div>
        </div>
      )}

      <DeleteConfirmDialog
        open={showDeleteConfirm}
        itemName={`${selectedIds.size} run${selectedIds.size > 1 ? 's' : ''}`}
        itemType="run history"
        onConfirm={handleDeleteConfirm}
        onCancel={() => setShowDeleteConfirm(false)}
      />
    </div>
  )
}

/* ── History row ───────────────────────────────────────────── */

function HistoryRow({
  run,
  isSelected,
  onToggle,
  onViewReport,
  hasViewReport,
}: {
  run: {
    id: string
    started_at: number
    source: string
    source_label: string | null
    environment_name: string | null
    iterations: number
    duration_ms: number
    total_endpoints: number
    passed_endpoints: number
    failed_endpoints: number
    total_tests: number
    passed_tests: number
    failed_tests: number
    skipped_tests: number
    avg_resp_time: number
  }
  isSelected: boolean
  onToggle: () => void
  onViewReport: () => void
  hasViewReport: boolean
}) {
  const [hovered, setHovered] = useState(false)
  const hasFailed = run.failed_endpoints > 0 || run.failed_tests > 0

  const formatDate = (ts: number) => {
    const d = new Date(ts)
    return (
      d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) +
      ' ' +
      d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    )
  }

  const formatDuration = (ms: number) => {
    if (ms < 1000) return `${ms}ms`
    const s = ms / 1000
    if (s < 60) return `${s.toFixed(0)}s ${ms % 1000}ms`
    return `${Math.floor(s / 60)}m ${Math.round(s % 60)}s`
  }

  // Row-click opens the report (same action as the end-of-row icon).
  // Checkbox cell stops propagation so selection works independently.
  const rowClickable = hasViewReport
  const handleRowClick = () => {
    if (rowClickable) onViewReport()
  }

  return (
    <tr
      className="border-b border-[var(--border)] transition-colors"
      style={{
        background: isSelected ? 'var(--accent-light)' : hovered ? 'var(--surface)' : undefined,
        cursor: rowClickable ? 'pointer' : 'default',
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={handleRowClick}
    >
      <td className="py-2.5" onClick={(e) => e.stopPropagation()}>
        <input
          type="checkbox"
          checked={isSelected}
          onChange={onToggle}
          className="h-[14px] w-[14px] cursor-pointer accent-[var(--accent)]"
        />
      </td>
      <td className="py-2.5 pr-4 text-[var(--text)]">
        <div className="flex items-center gap-2">
          <span
            className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
            style={{ background: hasFailed ? '#cc2200' : '#1a7a4a' }}
          />
          {formatDate(run.started_at)}
        </div>
      </td>
      <td className="py-2.5 pr-4 text-[var(--text)]">{run.source_label || run.source}</td>
      <td className="py-2.5 pr-4 text-[var(--text)]">{run.environment_name || '-'}</td>
      <td className="py-2.5 pr-4 text-[var(--text)]">{run.iterations}</td>
      <td className="py-2.5 pr-4 text-[var(--text)]">{formatDuration(run.duration_ms)}</td>
      <td className="py-2.5 pr-4 text-[var(--text)]">{run.total_endpoints}</td>
      <td className="py-2.5 pr-4 text-[var(--text)]">{run.passed_endpoints}</td>
      <td className="py-2.5 pr-4 text-[var(--text)]">{run.failed_endpoints}</td>
      <td className="py-2.5 pr-4 text-[var(--text)]">{run.skipped_tests}</td>
      <td className="py-2.5 pr-4 text-[var(--text)]">{run.avg_resp_time} ms</td>
      <td className="py-2.5">
        {(hovered || isSelected) && hasViewReport && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onViewReport()
            }}
            title="View Report"
            className="flex cursor-pointer items-center justify-center rounded-[4px] border-none bg-transparent p-1 text-[var(--muted)] hover:text-[var(--accent)]"
          >
            <BarChart2 size={15} />
          </button>
        )}
      </td>
    </tr>
  )
}
