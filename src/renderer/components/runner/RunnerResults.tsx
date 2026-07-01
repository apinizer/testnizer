import { useState, useMemo, useEffect } from 'react'
import { RotateCcw, Plus, X, ExternalLink, ChevronDown, ChevronRight } from 'lucide-react'
import { getMethodColors } from '../../styles/tokens'
import MonacoWrapper from '../shared/MonacoWrapper'
import type { EndpointRunResult, RunnerReport } from '../../stores/runner.store'
import { endpointDidPass } from '../../../shared/runner-verdict'

type FilterTab = 'all' | 'passed' | 'failed' | 'skipped' | 'errors' | 'console'

interface RunnerResultsProps {
  results: EndpointRunResult[]
  report: RunnerReport | null
  isRunning: boolean
  currentIndex: number
  totalCount: number
  runStartedAt: number | null
  sourceLabel?: string
  onStop: () => void
  onNewRun: () => void
  onRunAgain: () => void
  onViewAllRuns: () => void
  selectedResultId: string | null
  onSelectResult: (id: string | null) => void
  /** When provided, the result detail header shows an "Open endpoint" button
   * that navigates the user to the endpoint editor tab so they can fix the
   * request without leaving the runner. */
  onOpenEndpoint?: (endpointId: string) => void
}

export default function RunnerResults({
  results,
  report,
  isRunning,
  currentIndex,
  totalCount,
  runStartedAt,
  sourceLabel,
  onStop,
  onNewRun,
  onRunAgain,
  onViewAllRuns,
  selectedResultId,
  onSelectResult,
  onOpenEndpoint,
}: RunnerResultsProps) {
  const [activeFilter, setActiveFilter] = useState<FilterTab>('all')
  const [detailTab, setDetailTab] = useState<'response' | 'request'>('response')
  // Per-iteration collapse state. Default is "all expanded" — collapsing is
  // an opt-in for long runs. Keyed by 1-based iteration index so older
  // history rows (no `iteration` field) bucket into Iteration 1 cleanly.
  const [collapsedIterations, setCollapsedIterations] = useState<Set<number>>(new Set())

  // Verdict via the SHARED rule (shared/runner-verdict.ts) — a passing test that
  // allows a non-2xx code (idempotent DELETE → 400) must NOT be bucketed as
  // failed here just because the status is 4xx (issue #16 parity with main).
  const totalPassed = results.filter(endpointDidPass).length
  const totalFailed = results.filter((r) => !endpointDidPass(r)).length
  const totalDuration = report
    ? report.completedAt - report.startedAt
    : results.reduce((acc, r) => acc + r.duration, 0)
  const totalTests = results.length
  const totalErrors = results.filter((r) => r.error).length
  const avgRespTime =
    results.length > 0
      ? Math.round(results.reduce((acc, r) => acc + r.duration, 0) / results.length)
      : 0
  const progress = totalCount > 0 ? (currentIndex / totalCount) * 100 : 0

  const selectedResult = useMemo(
    () => results.find((r) => r.endpointId === selectedResultId),
    [results, selectedResultId],
  )

  const filteredResults = useMemo(() => {
    return results.filter((r) => {
      switch (activeFilter) {
        case 'passed':
          return endpointDidPass(r)
        case 'failed':
          return !endpointDidPass(r)
        case 'errors':
          return !!r.error
        case 'skipped':
          return false
        default:
          return true
      }
    })
  }, [results, activeFilter])

  // Bucket filtered results by 1-based iteration index. Results predating
  // the iteration field (older history rows) fall into bucket 1 so the UI
  // stays backwards compatible — a single "Iteration 1" group identical to
  // the previous flat list.
  const iterationGroups = useMemo(() => {
    const map = new Map<number, EndpointRunResult[]>()
    for (const r of filteredResults) {
      const iter = r.iteration && r.iteration > 0 ? r.iteration : 1
      const bucket = map.get(iter)
      if (bucket) bucket.push(r)
      else map.set(iter, [r])
    }
    return Array.from(map.entries()).sort((a, b) => a[0] - b[0])
  }, [filteredResults])

  // Auto-expand any new iteration that arrives mid-run so the user sees
  // results stream in. Without this, a user who collapsed Iteration 1 mid-
  // run would also have Iteration 2 collapsed by default (Set carries over).
  useEffect(() => {
    setCollapsedIterations((prev) => {
      if (prev.size === 0) return prev
      // Drop entries for iterations that no longer exist (e.g. after a new
      // run replaced the results) to prevent stale collapse state hiding
      // fresh data.
      const valid = new Set(iterationGroups.map((g) => g[0]))
      const next = new Set<number>()
      for (const i of prev) if (valid.has(i)) next.add(i)
      return next.size === prev.size ? prev : next
    })
  }, [iterationGroups])

  const toggleIteration = (iter: number) => {
    setCollapsedIterations((prev) => {
      const next = new Set(prev)
      if (next.has(iter)) next.delete(iter)
      else next.add(iter)
      return next
    })
  }

  const FILTER_TABS: { key: FilterTab; label: string; count: number }[] = [
    { key: 'all', label: 'All', count: results.length },
    { key: 'passed', label: 'Passed', count: totalPassed },
    { key: 'failed', label: 'Failed', count: totalFailed },
    { key: 'skipped', label: 'Skipped', count: 0 },
    { key: 'errors', label: 'Errors', count: totalErrors },
    { key: 'console', label: 'Console log', count: 0 },
  ]

  const formatTime = (ts: number | null) => {
    if (!ts) return ''
    return new Date(ts).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
  }

  const formatDuration = (ms: number) => {
    if (ms < 1000) return `${ms}ms`
    const s = ms / 1000
    if (s < 60) return `${s.toFixed(0)}s ${ms % 1000}ms`
    return `${Math.floor(s / 60)}m ${Math.round(s % 60)}s`
  }

  const formatBody = (body: string | undefined): string => {
    if (!body) return ''
    // Try JSON
    try {
      const parsed = JSON.parse(body)
      return JSON.stringify(parsed, null, 2)
    } catch {
      /* not JSON */
    }
    // Try XML pretty-print
    if (body.trimStart().startsWith('<')) {
      return formatXml(body)
    }
    return body
  }

  return (
    <div className="flex flex-1 overflow-hidden">
      {/* ═══ Left: results list ═══ */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Running progress */}
        {isRunning && (
          <div className="shrink-0 border-b border-[var(--border)] px-5 py-3">
            <div className="mb-1.5 flex items-center justify-between" style={{ fontSize: 13 }}>
              <span style={{ color: 'var(--muted)' }}>
                Running {currentIndex} of {totalCount}...
              </span>
              <button
                type="button"
                onClick={onStop}
                className="cursor-pointer rounded-[5px] border border-[#cc2200] bg-transparent px-3 py-1"
                style={{ fontSize: 13, fontWeight: 500, color: '#cc2200' }}
              >
                Stop
              </button>
            </div>
            <div className="h-1 overflow-hidden rounded-full bg-[var(--border)]">
              <div
                className="h-full rounded-full bg-[var(--accent)] transition-all"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        )}

        {/* Summary header */}
        {!isRunning && results.length > 0 && (
          <div className="shrink-0 border-b border-[var(--border)] px-5 py-3">
            {/* Title + actions */}
            <div className="mb-2 flex items-center justify-between">
              <span
                data-testid="runner-results-title"
                style={{ fontSize: 15, fontWeight: 600, color: 'var(--text)' }}
              >
                Run results
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={onRunAgain}
                  className="flex cursor-pointer items-center gap-1.5 rounded-[6px] border border-[var(--border)] bg-[var(--white)] px-3 py-1.5 hover:bg-[var(--surface)]"
                  style={{ fontSize: 13, color: 'var(--muted)' }}
                >
                  <RotateCcw size={13} />
                  Run Again
                </button>
                <button
                  type="button"
                  onClick={onNewRun}
                  className="flex cursor-pointer items-center gap-1.5 rounded-[6px] border border-[var(--border)] bg-[var(--white)] px-3 py-1.5 hover:bg-[var(--surface)]"
                  style={{ fontSize: 13, color: 'var(--muted)' }}
                >
                  <Plus size={13} />
                  New Run
                </button>
              </div>
            </div>

            {/* Timestamp */}
            <div className="mb-3 flex items-center gap-2" style={{ fontSize: 13 }}>
              <span
                className="inline-block h-2.5 w-2.5 rounded-full"
                style={{ background: totalFailed > 0 ? '#cc2200' : '#1a7a4a' }}
              />
              <span style={{ color: 'var(--muted)' }}>Ran today at {formatTime(runStartedAt)}</span>
              <button
                type="button"
                onClick={onViewAllRuns}
                className="cursor-pointer border-none bg-transparent hover:underline"
                style={{ fontSize: 13, color: 'var(--accent)' }}
              >
                View all runs
              </button>
            </div>

            {/* Stats row */}
            <div className="flex gap-8">
              <StatCell label="Source" value={sourceLabel || 'Runner'} />
              <StatCell label="Environment" value={report ? 'Active' : '-'} />
              <StatCell label="Iterations" value={String(iterationGroups.length || 1)} />
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
          <div className="flex shrink-0 items-center border-b border-[var(--border)] px-5">
            {FILTER_TABS.map((tab) => (
              <button
                key={tab.key}
                type="button"
                data-testid={`runner-filter-${tab.key}`}
                onClick={() => setActiveFilter(tab.key)}
                className="cursor-pointer border-none bg-transparent px-3 py-2"
                style={{
                  fontSize: 13,
                  color: activeFilter === tab.key ? 'var(--text)' : 'var(--muted)',
                  fontWeight: activeFilter === tab.key ? 600 : 400,
                  borderBottom:
                    activeFilter === tab.key ? '2px solid var(--accent)' : '2px solid transparent',
                  marginBottom: -1,
                }}
              >
                {tab.label} {tab.count}
              </button>
            ))}
            <div className="flex-1" />
            <div className="flex items-center gap-1.5" style={{ fontSize: 13 }}>
              <span style={{ fontWeight: 600, color: 'var(--text)' }}>List</span>
              <span style={{ color: 'var(--border2)' }}>|</span>
              <span style={{ color: 'var(--muted)' }}>Grid</span>
            </div>
          </div>
        )}

        {/* Results list grouped by iteration. Single-iteration runs render
            one group ("Iteration 1") and look identical to the previous
            flat list; multi-iteration runs get one collapsible group per
            iteration with pass/fail counts in the header. */}
        <div className="flex-1 overflow-auto">
          {iterationGroups.map(([iter, rows]) => {
            const collapsed = collapsedIterations.has(iter)
            const passed = rows.filter(endpointDidPass).length
            const failed = rows.length - passed
            return (
              <div key={iter}>
                {!isRunning && (
                  <button
                    type="button"
                    onClick={() => toggleIteration(iter)}
                    className="flex w-full cursor-pointer items-center gap-1.5 border-none bg-transparent px-5 py-2 text-left hover:bg-[var(--surface)]"
                    style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}
                    aria-expanded={!collapsed}
                  >
                    {collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                    <span>Iteration {iter}</span>
                    <span style={{ color: 'var(--hint)', fontWeight: 400, marginLeft: 6 }}>
                      ({rows.length} {rows.length === 1 ? 'request' : 'requests'}
                      {failed > 0 ? `, ${failed} failed` : ''}
                      {passed > 0 && failed === 0 ? `, ${passed} passed` : ''})
                    </span>
                  </button>
                )}
                {!collapsed &&
                  rows.map((result, idx) => (
                    <ResultRow
                      key={`${iter}-${result.endpointId}-${idx}`}
                      result={result}
                      isSelected={result.endpointId === selectedResultId}
                      onClick={() =>
                        onSelectResult(
                          result.endpointId === selectedResultId ? null : result.endpointId,
                        )
                      }
                    />
                  ))}
              </div>
            )
          })}
        </div>
      </div>

      {/* ═══ Right: Response detail pane ═══ */}
      {selectedResult && (
        <div className="flex w-[48%] min-w-[360px] flex-col overflow-hidden border-l border-[var(--border)]">
          {/* Detail header: index + method + endpoint name */}
          <div className="flex shrink-0 items-center gap-2 border-b border-[var(--border)] px-4 py-2">
            <span style={{ fontSize: 13, color: 'var(--hint)' }}>
              {filteredResults.findIndex((r) => r.endpointId === selectedResultId) + 1}
            </span>
            <MethodLabel method={selectedResult.method} />
            <span
              className="flex-1 truncate"
              style={{ fontSize: 13, color: 'var(--text)', fontWeight: 500 }}
            >
              {selectedResult.endpointName}
            </span>
            {onOpenEndpoint && (
              <button
                type="button"
                onClick={() => onOpenEndpoint(selectedResult.endpointId)}
                className="flex cursor-pointer items-center gap-1 rounded border-none bg-transparent p-1 text-[var(--hint)] hover:text-[var(--accent)]"
                title="Open endpoint editor"
              >
                <ExternalLink size={14} />
                <span style={{ fontSize: 12 }}>Open endpoint</span>
              </button>
            )}
            <button
              type="button"
              onClick={() => onSelectResult(null)}
              className="cursor-pointer border-none bg-transparent p-1 text-[var(--hint)] hover:text-[var(--text)]"
            >
              <X size={16} />
            </button>
          </div>

          {/* Tabs + status meta */}
          <div className="flex shrink-0 items-center border-b border-[var(--border)] px-4">
            {(['response', 'request'] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => setDetailTab(tab)}
                className="cursor-pointer border-none bg-transparent px-3 py-2 capitalize"
                style={{
                  fontSize: 13,
                  color: detailTab === tab ? 'var(--accent-text)' : 'var(--muted)',
                  fontWeight: detailTab === tab ? 600 : 400,
                  borderBottom:
                    detailTab === tab ? '2px solid var(--accent)' : '2px solid transparent',
                  marginBottom: -1,
                }}
              >
                {tab.charAt(0).toUpperCase() + tab.slice(1)}
              </button>
            ))}
            {/* Status · duration · size */}
            <div className="ml-auto flex items-center gap-2" style={{ fontSize: 13 }}>
              {selectedResult.status !== null && (
                <span
                  style={{
                    fontWeight: 600,
                    color: selectedResult.status < 400 ? '#1a7a4a' : '#cc2200',
                  }}
                >
                  {selectedResult.status}
                </span>
              )}
              {selectedResult.status !== null && <span style={{ color: 'var(--hint)' }}>·</span>}
              <span style={{ color: 'var(--muted)' }}>{selectedResult.duration} ms</span>
              {selectedResult.responseSize != null && selectedResult.responseSize > 0 && (
                <>
                  <span style={{ color: 'var(--hint)' }}>·</span>
                  <span style={{ color: 'var(--muted)' }}>
                    {formatBytes(selectedResult.responseSize)}
                  </span>
                </>
              )}
            </div>
          </div>

          {/* ── Response tab — HTTP message order: Status/Headers → Body.
                 Headers and assertions sit above the body so the reader gets
                 metadata first, then dives into the payload. */}
          {detailTab === 'response' && (
            <div className="flex flex-1 flex-col overflow-hidden">
              {selectedResult.error ? (
                <div className="p-4" style={{ fontSize: 13, color: '#cc2200' }}>
                  {selectedResult.error}
                </div>
              ) : (
                <>
                  {selectedResult.responseHeaders &&
                    Object.keys(selectedResult.responseHeaders).length > 0 && (
                      <div
                        className="shrink-0 overflow-y-auto border-b border-[var(--border)] px-4 py-3"
                        style={{ maxHeight: 220 }}
                      >
                        <SectionLabel>Response Headers</SectionLabel>
                        <HeadersTable headers={selectedResult.responseHeaders} />
                      </div>
                    )}
                  {selectedResult.assertions.length > 0 && (
                    <div className="shrink-0 border-b border-[var(--border)] px-4 py-3">
                      <SectionLabel>Tests</SectionLabel>
                      {selectedResult.assertions.map((a, i) => (
                        <div
                          key={i}
                          className="flex items-center gap-1.5 py-0.5"
                          style={{ fontSize: 13 }}
                        >
                          <span style={{ color: a.passed ? '#1a7a4a' : '#cc2200' }}>
                            {a.passed ? '✓' : '✗'}
                          </span>
                          <span style={{ color: a.passed ? 'var(--text)' : '#cc2200' }}>
                            {a.name}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                  {selectedResult.responseBody ? (
                    <>
                      <div
                        className="flex shrink-0 items-center gap-3 border-b border-[var(--border)] px-4 py-1.5"
                        style={{ fontSize: 13 }}
                      >
                        <SectionLabel>Body</SectionLabel>
                        <span className="ml-auto" style={{ fontWeight: 500, color: 'var(--text)' }}>
                          Pretty
                        </span>
                        <span style={{ color: 'var(--hint)' }}>∨</span>
                      </div>
                      <div className="flex-1 overflow-hidden">
                        <MonacoWrapper
                          value={formatBody(selectedResult.responseBody)}
                          language={detectLanguage(selectedResult.responseBody)}
                          readOnly
                          lineNumbers="on"
                          height="100%"
                        />
                      </div>
                    </>
                  ) : (
                    <div className="flex-1 p-4" style={{ fontSize: 13, color: 'var(--hint)' }}>
                      No response body available.
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {/* ── Request tab — HTTP message order: Method/URL → Headers →
                 Body. Mirrors the Response tab's vertical rhythm so the
                 reader scans both panes the same way. */}
          {detailTab === 'request' && (
            <div className="flex flex-1 flex-col overflow-hidden">
              {/* Summary: method + URL */}
              <div className="shrink-0 border-b border-[var(--border)] px-4 py-3">
                <div className="mb-2 flex items-center gap-2">
                  <SectionLabel>Method</SectionLabel>
                  <span
                    className="ml-1"
                    style={{ color: 'var(--text)', fontFamily: 'var(--font-mono)', fontSize: 13 }}
                  >
                    {selectedResult.method}
                  </span>
                </div>
                <SectionLabel>URL</SectionLabel>
                <div
                  style={{
                    color: 'var(--text)',
                    fontFamily: 'var(--font-mono)',
                    fontSize: 13,
                    wordBreak: 'break-all',
                  }}
                >
                  {selectedResult.url}
                </div>
              </div>

              {/* Headers (above body, matching Response tab order) */}
              {selectedResult.requestHeaders &&
                Object.keys(selectedResult.requestHeaders).length > 0 && (
                  <div
                    className="shrink-0 overflow-y-auto border-b border-[var(--border)] px-4 py-3"
                    style={{ maxHeight: 220 }}
                  >
                    <SectionLabel>Request Headers</SectionLabel>
                    <HeadersTable headers={selectedResult.requestHeaders} />
                  </div>
                )}

              {/* Body */}
              {selectedResult.requestBody ? (
                <>
                  <div
                    className="flex shrink-0 items-center gap-3 border-b border-[var(--border)] px-4 py-1.5"
                    style={{ fontSize: 13 }}
                  >
                    <SectionLabel>Body</SectionLabel>
                    <span className="ml-auto" style={{ fontWeight: 500, color: 'var(--text)' }}>
                      Pretty
                    </span>
                    <span style={{ color: 'var(--hint)' }}>∨</span>
                  </div>
                  <div className="flex-1 overflow-hidden">
                    <MonacoWrapper
                      value={formatBody(selectedResult.requestBody)}
                      language={detectLanguage(selectedResult.requestBody)}
                      readOnly
                      lineNumbers="on"
                      height="100%"
                    />
                  </div>
                </>
              ) : (
                <div className="flex-1 p-4" style={{ fontSize: 13, color: 'var(--hint)' }}>
                  No request body available.
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/* ═══ Sub-components ═══ */

function StatCell({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div>
      <div style={{ fontSize: 13, color: 'var(--hint)', marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 13, fontWeight: 600, color: color || 'var(--text)' }}>{value}</div>
    </div>
  )
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--muted)', marginBottom: 4 }}>
      {children}
    </div>
  )
}

function HeadersTable({ headers }: { headers: Record<string, string> }) {
  const entries = Object.entries(headers)
  if (entries.length === 0) return null
  return (
    <table className="w-full" style={{ fontSize: 13 }}>
      <thead>
        <tr className="border-b border-[var(--border)]">
          <th className="py-2 pr-4 text-left" style={{ fontWeight: 600, color: 'var(--muted)' }}>
            Key
          </th>
          <th className="py-2 text-left" style={{ fontWeight: 600, color: 'var(--muted)' }}>
            Value
          </th>
        </tr>
      </thead>
      <tbody>
        {entries.map(([key, value]) => (
          <tr key={key} className="border-b border-[var(--border)]">
            <td className="py-2 pr-4" style={{ fontWeight: 500, color: 'var(--text)' }}>
              {key}
            </td>
            <td className="py-2" style={{ color: 'var(--muted)', wordBreak: 'break-all' }}>
              {value}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function MethodLabel({ method }: { method: string }) {
  const mc = getMethodColors(method)
  return (
    <span
      style={{
        fontSize: 13,
        fontWeight: 700,
        color: mc.color,
        fontFamily: 'var(--font-mono)',
        letterSpacing: '0.02em',
        flexShrink: 0,
      }}
    >
      {method}
    </span>
  )
}

function ResultRow({
  result,
  isSelected,
  onClick,
}: {
  result: EndpointRunResult
  isSelected: boolean
  onClick: () => void
}) {
  const mc = getMethodColors(result.method)
  const statusColor =
    result.status === null
      ? '#cc2200'
      : result.status < 300
        ? '#1a7a4a'
        : result.status < 500
          ? '#b35a00'
          : '#cc2200'

  return (
    <div
      className="cursor-pointer border-b border-[var(--border)] px-5 py-3 transition-colors hover:bg-[var(--surface)]"
      style={{ background: isSelected ? 'var(--accent-light)' : undefined }}
      onClick={onClick}
    >
      {/* Row 1: METHOD path > Name ... status */}
      <div className="mb-1 flex items-center gap-2">
        <span
          style={{
            fontSize: 13,
            fontWeight: 700,
            color: mc.color,
            fontFamily: 'var(--font-mono)',
            flexShrink: 0,
          }}
        >
          {result.method}
        </span>
        <span
          style={{
            fontSize: 13,
            fontWeight: 600,
            color: 'var(--text)',
            flex: 1,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {result.endpointName}
        </span>
        {result.status !== null && (
          <span style={{ fontSize: 13, fontWeight: 600, color: statusColor, flexShrink: 0 }}>
            {result.status}
          </span>
        )}
        {result.error && result.status === null && (
          <span style={{ fontSize: 13, fontWeight: 500, color: '#cc2200', flexShrink: 0 }}>
            Error
          </span>
        )}
      </div>

      {/* Row 2: URL */}
      <div
        style={{
          fontSize: 13,
          color: 'var(--hint)',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          marginBottom: 4,
        }}
      >
        {result.url}
      </div>

      {/* Row 3: Tests or "No tests found" */}
      {result.assertions.length > 0 ? (
        <div>
          {result.assertions.map((a, i) => (
            <div
              key={i}
              className="flex items-center gap-1.5"
              style={{ fontSize: 13, paddingTop: 1, paddingBottom: 1 }}
            >
              <span style={{ color: a.passed ? '#1a7a4a' : '#cc2200' }}>
                {a.passed ? '✓' : '✗'}
              </span>
              <span style={{ color: a.passed ? 'var(--text)' : '#cc2200' }}>{a.name}</span>
            </div>
          ))}
        </div>
      ) : (
        <div style={{ fontSize: 13, color: 'var(--hint)' }}>No tests found</div>
      )}
    </div>
  )
}

function formatXml(xml: string): string {
  let formatted = ''
  let indent = 0
  const pad = '  '
  // Split on tags
  const parts = xml.replace(/(>)\s*(<)/g, '$1\n$2').split('\n')
  for (const part of parts) {
    const trimmed = part.trim()
    if (!trimmed) continue
    // Closing tag
    if (trimmed.startsWith('</')) {
      indent = Math.max(0, indent - 1)
    }
    formatted += pad.repeat(indent) + trimmed + '\n'
    // Opening tag that is not self-closing and not a declaration
    if (
      trimmed.startsWith('<') &&
      !trimmed.startsWith('</') &&
      !trimmed.startsWith('<?') &&
      !trimmed.endsWith('/>')
    ) {
      // Check it's not a tag with content on the same line like <tag>value</tag>
      if (!/<\/[^>]+>$/.test(trimmed)) {
        indent++
      }
    }
  }
  return formatted.trimEnd()
}

function detectLanguage(body: string): string {
  const trimmed = body.trimStart()
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) return 'json'
  if (trimmed.startsWith('<')) return 'xml'
  return 'plaintext'
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const kb = bytes / 1024
  if (kb < 1024) return `${kb.toFixed(kb < 10 ? 3 : 1)} KB`
  return `${(kb / 1024).toFixed(1)} MB`
}
