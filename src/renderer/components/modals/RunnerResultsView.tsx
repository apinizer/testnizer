import { useState } from 'react'
import { useRunnerStore } from '../../stores/runner.store'
import { getMethodColors } from '../../styles/tokens'
import { RotateCcw, Plus, Share2, MoreHorizontal } from 'lucide-react'

type FilterTab = 'all' | 'passed' | 'failed' | 'skipped' | 'errors' | 'console'

interface RunnerResultsViewProps {
  onNewRun: () => void
  onClose: () => void
}

export default function RunnerResultsView({ onNewRun, onClose }: RunnerResultsViewProps) {
  const results = useRunnerStore((s) => s.results)
  const report = useRunnerStore((s) => s.report)
  const isRunning = useRunnerStore((s) => s.isRunning)
  const currentIndex = useRunnerStore((s) => s.currentIndex)
  const totalCount = useRunnerStore((s) => s.totalCount)
  const runStartedAt = useRunnerStore((s) => s.runStartedAt)
  const stop = useRunnerStore((s) => s.stop)

  const [activeFilter, setActiveFilter] = useState<FilterTab>('all')

  const totalPassed = results.filter((r) => !r.error && r.failed === 0).length
  const totalFailed = results.filter((r) => r.error || r.failed > 0).length
  const totalDuration = report?.completedAt && report?.startedAt
    ? report.completedAt - report.startedAt
    : results.reduce((acc, r) => acc + r.duration, 0)
  const totalTests = results.reduce((acc, r) => acc + r.passed + r.failed, 0)
  const totalErrors = results.filter((r) => r.error).length
  const avgRespTime = results.length > 0
    ? Math.round(results.reduce((acc, r) => acc + r.duration, 0) / results.length)
    : 0

  const filteredResults = results.filter((r) => {
    switch (activeFilter) {
      case 'passed': return !r.error && r.failed === 0 && r.status !== null && (r.status < 400)
      case 'failed': return r.error || r.failed > 0 || (r.status !== null && r.status >= 400)
      case 'errors': return !!r.error
      case 'skipped': return false
      default: return true
    }
  })

  const formatTime = (ts: number | null) => {
    if (!ts) return ''
    const d = new Date(ts)
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  }

  const formatDuration = (ms: number) => {
    if (ms < 1000) return `${ms}ms`
    const s = ms / 1000
    if (s < 60) return `${s.toFixed(1)}s`
    const m = Math.floor(s / 60)
    const rem = Math.round(s % 60)
    return `${m}m ${rem}s`
  }

  const progress = totalCount > 0 ? (currentIndex / totalCount) * 100 : 0

  const FILTER_TABS: { key: FilterTab; label: string; count?: number }[] = [
    { key: 'all', label: 'All', count: results.length },
    { key: 'passed', label: 'Passed', count: totalPassed },
    { key: 'failed', label: 'Failed', count: totalFailed },
    { key: 'skipped', label: 'Skipped', count: 0 },
    { key: 'errors', label: 'Errors', count: totalErrors },
    { key: 'console', label: 'Console log' },
  ]

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Running progress bar */}
      {isRunning && (
        <div className="shrink-0 border-b border-[var(--border)] px-5 py-3">
          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-[var(--muted)]">
              Running {currentIndex} of {totalCount}...
            </span>
            <button
              type="button"
              onClick={stop}
              className="cursor-pointer rounded-[5px] border border-[#cc2200] bg-transparent px-3 py-0.5 font-medium text-[#cc2200] hover:bg-[#fff0f0]"
            >
              Stop
            </button>
          </div>
          <div className="h-1 overflow-hidden rounded-full bg-[var(--border)]">
            <div
              className="h-full rounded-full bg-[var(--accent)] transition-all duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      )}

      {/* Header: Collection name + run info */}
      {!isRunning && results.length > 0 && (
        <div className="shrink-0 border-b border-[var(--border)] px-5 py-3">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-[15px] font-semibold text-[var(--text)]">
              Run results
            </h2>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onNewRun}
                className="flex cursor-pointer items-center gap-1.5 rounded-[6px] border border-[var(--border)] bg-[var(--white)] px-2.5 py-1 text-[var(--muted)] transition-colors hover:bg-[var(--surface)]"
              >
                <RotateCcw size={11} />
                Run Again
              </button>
              <button
                type="button"
                onClick={onNewRun}
                className="flex cursor-pointer items-center gap-1.5 rounded-[6px] border border-[var(--border)] bg-[var(--white)] px-2.5 py-1 text-[var(--muted)] transition-colors hover:bg-[var(--surface)]"
              >
                <Plus size={11} />
                New Run
              </button>
            </div>
          </div>

          {/* Run timestamp */}
          <div className="mb-3 flex items-center gap-2">
            <span
              className="inline-block h-2 w-2 rounded-full"
              style={{ background: totalFailed > 0 ? '#cc2200' : '#1a7a4a' }}
            />
            <span className="text-[var(--muted)]">
              Ran today at {formatTime(runStartedAt)}
            </span>
            <button
              type="button"
              className="cursor-pointer border-none bg-transparent text-[var(--accent)] hover:underline"
            >
              View all runs
            </button>
          </div>

          {/* Summary stats table */}
          <div className="flex gap-6">
            <StatCell label="Source" value="Runner" />
            <StatCell label="Iterations" value={String(report?.totalEndpoints ?? results.length)} />
            <StatCell label="Duration" value={formatDuration(totalDuration)} />
            <StatCell label="All tests" value={String(totalTests)} />
            <StatCell label="Errors" value={String(totalErrors)} color={totalErrors > 0 ? '#cc2200' : undefined} />
            <StatCell label="Avg. Resp. Time" value={`${avgRespTime} ms`} />
          </div>
        </div>
      )}

      {/* Filter tabs */}
      {results.length > 0 && !isRunning && (
        <div className="flex shrink-0 items-center gap-0 border-b border-[var(--border)] px-5">
          {FILTER_TABS.map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActiveFilter(tab.key)}
              className="cursor-pointer border-none bg-transparent px-2.5 py-2 transition-colors"
              style={{
                color: activeFilter === tab.key ? 'var(--accent-text)' : 'var(--muted)',
                fontWeight: activeFilter === tab.key ? 600 : 400,
                borderBottom: activeFilter === tab.key ? '2px solid var(--accent)' : '2px solid transparent',
                marginBottom: -1,
              }}
            >
              {tab.label} {tab.count !== undefined ? tab.count : ''}
            </button>
          ))}
          <div className="flex-1" />
          <div className="flex items-center gap-1 text-[var(--hint)]">
            <button type="button" className="cursor-pointer border-none bg-transparent px-1.5 py-1 font-medium text-[var(--accent)]">
              List
            </button>
            <span className="text-[var(--border2)]">|</span>
            <button type="button" className="cursor-pointer border-none bg-transparent px-1.5 py-1 text-[var(--muted)]">
              Grid
            </button>
          </div>
        </div>
      )}

      {/* Results list */}
      <div className="flex-1 overflow-auto">
        {results.length === 0 && !isRunning && (
          <div className="flex h-full items-center justify-center text-[var(--hint)]">
            Running collection...
          </div>
        )}

        {filteredResults.map((result, idx) => (
          <ResultRow key={`${result.endpointId}-${idx}`} result={result} />
        ))}
      </div>
    </div>
  )
}

/* ── Stat cell in summary bar ──────────────────────────────── */

function StatCell({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div>
      <div className="mb-0.5 text-[var(--hint)]">{label}</div>
      <div className="font-medium" style={{ color: color || 'var(--text)' }}>
        {value}
      </div>
    </div>
  )
}

/* ── Individual result row (Postman style) ─────────────────── */

function ResultRow({ result }: { result: import('../../stores/runner.store').EndpointRunResult }) {
  const mc = getMethodColors(result.method)
  const isError = !!result.error || (result.status !== null && result.status >= 400)
  const statusColor = result.status === null
    ? '#cc2200'
    : result.status < 300
      ? '#1a7a4a'
      : result.status < 500
        ? '#b35a00'
        : '#cc2200'

  return (
    <div className="border-b border-[var(--border)] px-5 py-3 transition-colors hover:bg-[var(--surface)]">
      {/* Method + path > name */}
      <div className="mb-0.5 flex items-center gap-2">
        <span
          className="shrink-0 font-bold"
          style={{
            color: mc.color,
            fontFamily: "var(--font-mono)",
          }}
        >
          {result.method}
        </span>
        <span className="text-[var(--text)]">
          {result.endpointName}
        </span>

        {/* Right: status + duration + size */}
        <div className="ml-auto flex items-center gap-3">
          {result.status !== null && (
            <span className="font-medium" style={{ color: statusColor }}>
              {result.status}
            </span>
          )}
          {result.error && result.status === null && (
            <span className="font-medium text-[#cc2200]">
              Error
            </span>
          )}
          <span className="text-[var(--muted)]">
            {result.duration} ms
          </span>
          {result.responseSize != null && result.responseSize > 0 && (
            <span className="text-[var(--muted)]">
              {formatBytes(result.responseSize)}
            </span>
          )}
        </div>
      </div>

      {/* URL */}
      <div className="mb-1 truncate text-[var(--hint)]">
        {result.url}
      </div>

      {/* Error message */}
      {result.error && (
        <div className="mt-1 text-[#cc2200]">
          {result.error}
        </div>
      )}

      {/* Assertions / "No tests found" */}
      {result.assertions.length > 0 ? (
        <div className="mt-1.5 space-y-0.5">
          {result.assertions.map((a, i) => (
            <div key={i} className="flex items-center gap-1.5">
              <span style={{ color: a.passed ? '#1a7a4a' : '#cc2200' }}>
                {a.passed ? '✓' : '✗'}
              </span>
              <span style={{ color: a.passed ? 'var(--text)' : '#cc2200' }}>
                {a.name}
              </span>
              {a.actual !== undefined && (
                <span className="text-[var(--muted)]">| actual: {String(a.actual)}</span>
              )}
            </div>
          ))}
        </div>
      ) : (
        <div className="mt-1 text-[var(--hint)]">
          No tests found
        </div>
      )}
    </div>
  )
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
