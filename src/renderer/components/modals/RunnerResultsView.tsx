import { useState } from 'react'
import { useRunnerStore } from '../../stores/runner.store'
import { getMethodColors } from '../../styles/tokens'
import { RotateCcw, Plus, ChevronDown, ChevronRight } from 'lucide-react'

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
  const totalDuration =
    report?.completedAt && report?.startedAt
      ? report.completedAt - report.startedAt
      : results.reduce((acc, r) => acc + r.duration, 0)
  const totalTests = results.reduce((acc, r) => acc + r.passed + r.failed, 0)
  const totalErrors = results.filter((r) => r.error).length
  const avgRespTime =
    results.length > 0
      ? Math.round(results.reduce((acc, r) => acc + r.duration, 0) / results.length)
      : 0

  const filteredResults = results.filter((r) => {
    switch (activeFilter) {
      case 'passed':
        return !r.error && r.failed === 0 && r.status !== null && r.status < 400
      case 'failed':
        return r.error || r.failed > 0 || (r.status !== null && r.status >= 400)
      case 'errors':
        return !!r.error
      case 'skipped':
        return false
      default:
        return true
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
            <h2
              data-testid="runner-results-title"
              className="text-[15px] font-semibold text-[var(--text)]"
            >
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
            <span className="text-[var(--muted)]">Ran today at {formatTime(runStartedAt)}</span>
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
            <StatCell
              label="Errors"
              value={String(totalErrors)}
              color={totalErrors > 0 ? '#cc2200' : undefined}
            />
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
              data-testid={`runner-filter-${tab.key}`}
              onClick={() => setActiveFilter(tab.key)}
              className="cursor-pointer border-none bg-transparent px-2.5 py-2 transition-colors"
              style={{
                color: activeFilter === tab.key ? 'var(--accent-text)' : 'var(--muted)',
                fontWeight: activeFilter === tab.key ? 600 : 400,
                borderBottom:
                  activeFilter === tab.key ? '2px solid var(--accent)' : '2px solid transparent',
                marginBottom: -1,
              }}
            >
              {tab.label} {tab.count !== undefined ? tab.count : ''}
            </button>
          ))}
          <div className="flex-1" />
          <div className="flex items-center gap-1 text-[var(--hint)]">
            <button
              type="button"
              className="cursor-pointer border-none bg-transparent px-1.5 py-1 font-medium text-[var(--accent)]"
            >
              List
            </button>
            <span className="text-[var(--border2)]">|</span>
            <button
              type="button"
              className="cursor-pointer border-none bg-transparent px-1.5 py-1 text-[var(--muted)]"
            >
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

type DetailTab = 'request' | 'response' | 'tests'
type DetailSection = 'body' | 'headers'

function ResultRow({ result }: { result: import('../../stores/runner.store').EndpointRunResult }) {
  const [expanded, setExpanded] = useState(false)
  const [tab, setTab] = useState<DetailTab>('response')
  const [section, setSection] = useState<DetailSection>('body')

  const mc = getMethodColors(result.method)
  const statusColor =
    result.status === null
      ? '#cc2200'
      : result.status < 300
        ? '#1a7a4a'
        : result.status < 500
          ? '#b35a00'
          : '#cc2200'

  const hasRequestData = !!(result.requestBody || result.requestHeaders)
  const hasResponseData = !!(result.responseBody || result.responseHeaders)

  return (
    <div className="border-b border-[var(--border)]">
      {/* Summary row — clickable to expand */}
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full cursor-pointer flex-col items-stretch gap-0 border-none bg-transparent px-5 py-3 text-left transition-colors hover:bg-[var(--surface)]"
      >
        <div className="mb-0.5 flex items-center gap-2">
          <span style={{ color: 'var(--muted)' }}>
            {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          </span>
          <span
            className="shrink-0 font-bold"
            style={{ color: mc.color, fontFamily: 'var(--font-mono)' }}
          >
            {result.method}
          </span>
          <span className="text-[var(--text)]">{result.endpointName}</span>

          <div className="ml-auto flex items-center gap-3">
            {result.status !== null && (
              <span className="font-medium" style={{ color: statusColor }}>
                {result.status}
              </span>
            )}
            {result.error && result.status === null && (
              <span className="font-medium text-[#cc2200]">Error</span>
            )}
            <span className="text-[var(--muted)]">{result.duration} ms</span>
            {result.responseSize != null && result.responseSize > 0 && (
              <span className="text-[var(--muted)]">{formatBytes(result.responseSize)}</span>
            )}
          </div>
        </div>

        <div className="ml-[20px] mb-1 truncate text-[var(--hint)]">{result.url}</div>

        {result.error && <div className="ml-[20px] mt-1 text-[#cc2200]">{result.error}</div>}

        {result.assertions.length > 0 ? (
          <div className="ml-[20px] mt-1.5 space-y-0.5">
            {result.assertions.map((a, i) => (
              <div key={i} className="flex items-center gap-1.5">
                <span style={{ color: a.passed ? '#1a7a4a' : '#cc2200' }}>
                  {a.passed ? '✓' : '✗'}
                </span>
                <span style={{ color: a.passed ? 'var(--text)' : '#cc2200' }}>{a.name}</span>
                {a.actual !== undefined && (
                  <span className="text-[var(--muted)]">| actual: {String(a.actual)}</span>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="ml-[20px] mt-1 text-[var(--hint)]">No tests found</div>
        )}
      </button>

      {/* Expanded detail panel */}
      {expanded && (
        <div
          className="border-t border-[var(--border)] bg-[var(--surface)]"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center border-b border-[var(--border)] px-5">
            {(['request', 'response', 'tests'] as DetailTab[]).map((t) => {
              const enabled = t === 'tests' || (t === 'request' ? hasRequestData : hasResponseData)
              return (
                <button
                  key={t}
                  type="button"
                  disabled={!enabled}
                  onClick={() => setTab(t)}
                  className="cursor-pointer border-none bg-transparent px-3 py-2 transition-colors disabled:cursor-not-allowed"
                  style={{
                    color:
                      tab === t ? 'var(--accent-text)' : enabled ? 'var(--muted)' : 'var(--hint)',
                    fontWeight: tab === t ? 600 : 400,
                    borderBottom: tab === t ? '2px solid var(--accent)' : '2px solid transparent',
                    marginBottom: -1,
                    textTransform: 'capitalize',
                  }}
                >
                  {t}
                </button>
              )
            })}
          </div>

          {tab !== 'tests' && (
            <div className="flex items-center border-b border-[var(--border)] px-5">
              {(['body', 'headers'] as DetailSection[]).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setSection(s)}
                  className="cursor-pointer border-none bg-transparent px-2.5 py-1.5"
                  style={{
                    color: section === s ? 'var(--text)' : 'var(--muted)',
                    fontWeight: section === s ? 600 : 400,
                    textTransform: 'capitalize',
                    fontSize: 12,
                  }}
                >
                  {s}
                </button>
              ))}
            </div>
          )}

          <div className="px-5 py-3">
            {tab === 'request' && section === 'body' && (
              <PreBlock content={result.requestBody} emptyText="No request body" />
            )}
            {tab === 'request' && section === 'headers' && (
              <HeadersTable headers={result.requestHeaders} emptyText="No request headers" />
            )}
            {tab === 'response' && section === 'body' && (
              <PreBlock
                content={result.responseBody}
                emptyText={
                  result.error ? 'No response (request failed)' : 'No response body captured'
                }
              />
            )}
            {tab === 'response' && section === 'headers' && (
              <HeadersTable headers={result.responseHeaders} emptyText="No response headers" />
            )}
            {tab === 'tests' && <TestsList assertions={result.assertions} error={result.error} />}
          </div>
        </div>
      )}
    </div>
  )
}

function PreBlock({ content, emptyText }: { content?: string; emptyText: string }) {
  if (!content) return <div className="text-[var(--hint)]">{emptyText}</div>
  return (
    <pre
      className="max-h-[400px] overflow-auto rounded border border-[var(--border)] bg-[var(--white)] p-2.5 font-mono"
      style={{ fontSize: 12, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}
    >
      {content}
    </pre>
  )
}

function HeadersTable({
  headers,
  emptyText,
}: {
  headers?: Record<string, string>
  emptyText: string
}) {
  const entries = headers ? Object.entries(headers) : []
  if (entries.length === 0) return <div className="text-[var(--hint)]">{emptyText}</div>
  return (
    <div className="overflow-x-auto rounded border border-[var(--border)] bg-[var(--white)]">
      <table className="w-full" style={{ fontSize: 12 }}>
        <tbody>
          {entries.map(([k, v]) => (
            <tr key={k} className="border-b border-[var(--border)] last:border-0">
              <td
                className="px-2.5 py-1.5 font-medium text-[var(--text)]"
                style={{ width: '30%', verticalAlign: 'top', wordBreak: 'break-word' }}
              >
                {k}
              </td>
              <td
                className="px-2.5 py-1.5 font-mono text-[var(--muted)]"
                style={{ wordBreak: 'break-all' }}
              >
                {v}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function TestsList({
  assertions,
  error,
}: {
  assertions: import('../../stores/runner.store').AssertionResult[]
  error?: string
}) {
  if (error) return <div className="text-[#cc2200]">{error}</div>
  if (assertions.length === 0)
    return <div className="text-[var(--hint)]">No tests defined for this request.</div>
  return (
    <div className="space-y-1">
      {assertions.map((a, i) => (
        <div key={i} className="flex flex-col gap-0.5 py-1">
          <div className="flex items-center gap-1.5">
            <span style={{ color: a.passed ? '#1a7a4a' : '#cc2200' }}>{a.passed ? '✓' : '✗'}</span>
            <span style={{ color: a.passed ? 'var(--text)' : '#cc2200', fontWeight: 500 }}>
              {a.name}
            </span>
          </div>
          {a.actual !== undefined && (
            <div className="ml-5 text-[var(--muted)]" style={{ fontSize: 11 }}>
              actual: <span className="font-mono">{String(a.actual)}</span>
            </div>
          )}
          {a.error && (
            <div className="ml-5 text-[#cc2200]" style={{ fontSize: 11 }}>
              {a.error}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
