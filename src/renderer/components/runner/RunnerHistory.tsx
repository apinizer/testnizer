import { useEffect, useState, useMemo } from 'react'
import { useWorkspaceStore } from '../../stores/workspace.store'
import { ArrowLeft, BarChart2 } from 'lucide-react'
import type { EndpointRunResult, RunnerReport } from '../../stores/runner.store'
import DeleteConfirmDialog from '../modals/DeleteConfirmDialog'

interface RunHistoryRow {
  id: string
  project_id: string
  environment_name: string | null
  source: string
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

interface RunnerHistoryProps {
  onBack: () => void
  onNewRun?: () => void
  onViewReport?: (results: EndpointRunResult[], report: RunnerReport, startedAt: number) => void
}

export default function RunnerHistory({ onBack, onNewRun, onViewReport }: RunnerHistoryProps) {
  const activeProjectId = useWorkspaceStore((s) => s.activeProjectId)
  const [runs, setRuns] = useState<RunHistoryRow[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [activeTab, setActiveTab] = useState<HistoryTab>('Functional')
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)

  const loadRuns = () => {
    if (!activeProjectId) return
    setLoading(true)
    window.api?.runner?.history(activeProjectId).then((result: unknown) => {
      const res = result as { success: boolean; data?: RunHistoryRow[] }
      if (res?.success && res.data) {
        setRuns(res.data)
      }
      setLoading(false)
    }).catch(() => setLoading(false))
  }

  useEffect(() => {
    loadRuns()
  }, [activeProjectId])

  const filteredRuns = useMemo(() => {
    if (activeTab === 'Scheduled') {
      return runs.filter((r) => r.source === 'Scheduler')
    }
    return runs.filter((r) => r.source !== 'Scheduler')
  }, [runs, activeTab])

  const toggleSelect = (id: string) => {
    setSelectedIds((s) => {
      const next = new Set(s)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const handleDeleteClick = () => {
    if (selectedIds.size === 0) return
    setShowDeleteConfirm(true)
  }

  const handleDeleteConfirm = async () => {
    setShowDeleteConfirm(false)
    const ids = Array.from(selectedIds)
    try {
      const res = await window.api?.runner?.deleteHistory(ids) as { success: boolean }
      if (res?.success) {
        setRuns((prev) => prev.filter((r) => !selectedIds.has(r.id)))
        setSelectedIds(new Set())
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
      onViewReport(results, report, run.started_at)
    } catch {
      // invalid JSON
    }
  }

  const tabDescription = activeTab === 'Scheduled'
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
        <h2 style={{ fontSize: 15, fontWeight: 600, color: 'var(--text)', margin: 0, flex: 1 }}>All Runs</h2>
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
            onClick={() => { setActiveTab(tab); setSelectedIds(new Set()) }}
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
        ) : filteredRuns.length === 0 ? (
          <div className="py-8 text-center text-[var(--hint)]">
            {activeTab === 'Scheduled'
              ? 'No scheduled runs yet. Create a scheduled task to see runs here.'
              : 'No runs yet. Start a run to see history here.'}
          </div>
        ) : (
          <table className="w-full" style={{ fontSize: 13 }}>
            <thead>
              <tr className="border-b border-[var(--border)] text-left">
                <th className="w-8 py-2" />
                <th className="py-2 pr-4" style={{ fontWeight: 600, color: 'var(--muted)' }}>Start time</th>
                <th className="py-2 pr-4" style={{ fontWeight: 600, color: 'var(--muted)' }}>Source</th>
                <th className="py-2 pr-4" style={{ fontWeight: 600, color: 'var(--muted)' }}>Environment</th>
                <th className="py-2 pr-4" style={{ fontWeight: 600, color: 'var(--muted)' }}>Iterations</th>
                <th className="py-2 pr-4" style={{ fontWeight: 600, color: 'var(--muted)' }}>Duration</th>
                <th className="py-2 pr-4" style={{ fontWeight: 600, color: 'var(--muted)' }}>All tests</th>
                <th className="py-2 pr-4" style={{ fontWeight: 600, color: 'var(--muted)' }}>Passed</th>
                <th className="py-2 pr-4" style={{ fontWeight: 600, color: 'var(--muted)' }}>Failed</th>
                <th className="py-2 pr-4" style={{ fontWeight: 600, color: 'var(--muted)' }}>Skipped</th>
                <th className="py-2 pr-4" style={{ fontWeight: 600, color: 'var(--muted)' }}>Avg. Resp. Time</th>
                <th className="w-16 py-2" />
              </tr>
            </thead>
            <tbody>
              {filteredRuns.map((run) => (
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
  run: { id: string; started_at: number; source: string; environment_name: string | null; iterations: number; duration_ms: number; total_endpoints: number; passed_endpoints: number; failed_endpoints: number; total_tests: number; passed_tests: number; failed_tests: number; skipped_tests: number; avg_resp_time: number }
  isSelected: boolean
  onToggle: () => void
  onViewReport: () => void
  hasViewReport: boolean
}) {
  const [hovered, setHovered] = useState(false)
  const hasFailed = run.failed_endpoints > 0 || run.failed_tests > 0

  const formatDate = (ts: number) => {
    const d = new Date(ts)
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) +
      ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  }

  const formatDuration = (ms: number) => {
    if (ms < 1000) return `${ms}ms`
    const s = ms / 1000
    if (s < 60) return `${s.toFixed(0)}s ${ms % 1000}ms`
    return `${Math.floor(s / 60)}m ${Math.round(s % 60)}s`
  }

  return (
    <tr
      className="border-b border-[var(--border)] transition-colors"
      style={{ background: isSelected ? 'var(--accent-light)' : hovered ? 'var(--surface)' : undefined }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <td className="py-2.5">
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
      <td className="py-2.5 pr-4 text-[var(--text)]">{run.source}</td>
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
            onClick={onViewReport}
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
