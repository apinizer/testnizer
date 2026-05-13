import { useState, useMemo } from 'react'
import { RotateCcw, Plus, X, ExternalLink } from 'lucide-react'
import { getMethodColors } from '../../styles/tokens'
import MonacoWrapper from '../shared/MonacoWrapper'
import type { EndpointRunResult, RunnerReport } from '../../stores/runner.store'

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

  const totalPassed = results.filter(
    (r) => !r.error && r.failed === 0 && r.status !== null && r.status < 400,
  ).length
  const totalFailed = results.filter(
    (r) => r.error || r.failed > 0 || (r.status !== null && r.status >= 400),
  ).length
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
  }, [results, activeFilter])

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
              <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--text)' }}>
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
              <StatCell label="Iterations" value="1" />
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

        {/* Iteration header */}
        {results.length > 0 && !isRunning && (
          <div
            className="shrink-0 px-5 py-2"
            style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}
          >
            Iteration 1
          </div>
        )}

        {/* Results list */}
        <div className="flex-1 overflow-auto">
          {filteredResults.map((result, idx) => (
            <ResultRow
              key={`${result.endpointId}-${idx}`}
              result={result}
              isSelected={result.endpointId === selectedResultId}
              onClick={() =>
                onSelectResult(result.endpointId === selectedResultId ? null : result.endpointId)
              }
            />
          ))}
        </div>
      </div>

      {/* ═══ Right: Response detail pane ═══ */}
      {selectedResult && (
        <div className="flex w-[48%] min-w-[360px] flex-col overflow-hidden border-l border-[var(--border)]">
          {/* Detail header: index + method + breadcrumb */}
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

          {/* ── Response tab — status meta is already shown in the tab bar
                 above; we surface body + response headers + tests here so the
                 reader has one place for everything the server returned. */}
          {detailTab === 'response' && (
            <div className="flex flex-1 flex-col overflow-hidden">
              {selectedResult.error ? (
                <div className="p-4" style={{ fontSize: 13, color: '#cc2200' }}>
                  {selectedResult.error}
                </div>
              ) : selectedResult.responseBody ? (
                <>
                  {/* Pretty bar */}
                  <div
                    className="flex shrink-0 items-center gap-3 border-b border-[var(--border)] px-4 py-1.5"
                    style={{ fontSize: 13 }}
                  >
                    <span style={{ fontWeight: 500, color: 'var(--text)' }}>Pretty</span>
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
                <div className="p-4" style={{ fontSize: 13, color: 'var(--hint)' }}>
                  No response body available.
                </div>
              )}
              {selectedResult.responseHeaders &&
                Object.keys(selectedResult.responseHeaders).length > 0 && (
                  <div className="shrink-0 border-t border-[var(--border)] px-4 py-3">
                    <SectionLabel>Response Headers</SectionLabel>
                    <HeadersTable headers={selectedResult.responseHeaders} />
                  </div>
                )}
              {selectedResult.assertions.length > 0 && (
                <div className="shrink-0 border-t border-[var(--border)] px-4 py-3">
                  <div
                    style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', marginBottom: 4 }}
                  >
                    Tests
                  </div>
                  {selectedResult.assertions.map((a, i) => (
                    <div
                      key={i}
                      className="flex items-center gap-1.5 py-0.5"
                      style={{ fontSize: 13 }}
                    >
                      <span style={{ color: a.passed ? '#1a7a4a' : '#cc2200' }}>
                        {a.passed ? '✓' : '✗'}
                      </span>
                      <span style={{ color: a.passed ? 'var(--text)' : '#cc2200' }}>{a.name}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ── Request tab — method, URL, request headers, and request body
                 captured by the runner. Read-only for inspection; the
                 "Open endpoint" button is the path to actually edit the
                 underlying suite item / endpoint. */}
          {detailTab === 'request' && (
            <div className="flex-1 overflow-auto p-4" style={{ fontSize: 13 }}>
              <SectionLabel>Method</SectionLabel>
              <div
                style={{
                  color: 'var(--text)',
                  fontFamily: 'var(--font-mono)',
                  marginBottom: 16,
                }}
              >
                {selectedResult.method}
              </div>
              <SectionLabel>URL</SectionLabel>
              <div
                style={{
                  color: 'var(--text)',
                  fontFamily: 'var(--font-mono)',
                  wordBreak: 'break-all',
                  marginBottom: 16,
                }}
              >
                {selectedResult.url}
              </div>
              {selectedResult.requestHeaders &&
                Object.keys(selectedResult.requestHeaders).length > 0 && (
                  <>
                    <SectionLabel>Headers</SectionLabel>
                    <div style={{ marginBottom: 16 }}>
                      <HeadersTable headers={selectedResult.requestHeaders} />
                    </div>
                  </>
                )}
              {selectedResult.requestBody && (
                <>
                  <SectionLabel>Body</SectionLabel>
                  <pre
                    style={{
                      color: 'var(--text)',
                      fontFamily: 'var(--font-mono)',
                      fontSize: 12,
                      padding: 8,
                      background: 'var(--surface)',
                      borderRadius: 4,
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-all',
                      margin: 0,
                    }}
                  >
                    {formatBody(selectedResult.requestBody)}
                  </pre>
                </>
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
