import { useState, useMemo, useEffect } from 'react'
import { RotateCcw, Plus, X, ExternalLink, ChevronDown, ChevronRight } from 'lucide-react'
import { getMethodColors } from '../../styles/tokens'
import MonacoWrapper from '../shared/MonacoWrapper'
import type { EndpointRunResult, RunnerReport } from '../../stores/runner.store'
import { endpointDidPass, isSkippedStep } from '../../../shared/runner-verdict'
import { summarizeRun, statusBadge, SYNTHETIC_STATUS } from '../../../shared/runner-summary'
import type { RunStopReason } from '../../../shared/runner-types'
import { useTranslation } from '../../lib/i18n'

type FilterTab = 'all' | 'passed' | 'failed' | 'skipped' | 'errors' | 'console'

/**
 * Why the run ended early, as a message.
 *
 * An exhaustive map rather than a ternary chain: the chain it replaces fell
 * through to "Stopped by you — teardown still ran" for `setupFailed`, so a run
 * that nobody stopped told the user they had stopped it. `Record<RunStopReason,
 * …>` makes the next reason a compile error instead of a wrong sentence.
 */
const STOP_REASON_KEY: Record<RunStopReason, string> = {
  setupFailed: 'runLifecycle.stoppedSetupFailed',
  stopOnError: 'runLifecycle.stoppedOnError',
  cancelled: 'runLifecycle.stoppedCancelled',
  teardownAborted: 'runLifecycle.stoppedTeardownAborted',
  stoppedImmediately: 'runLifecycle.stoppedImmediately',
}

function stopReasonKey(reason: RunStopReason): string {
  return STOP_REASON_KEY[reason] ?? 'runLifecycle.stoppedCancelled'
}

/** Script console output, coloured by level (matches the app's Console tab). */
const CONSOLE_LEVEL_COLOR: Record<'log' | 'warn' | 'error', string> = {
  log: 'var(--text)',
  warn: '#b35a00',
  error: '#cc2200',
}

/** Status-badge palette. Keyed by tone so the same mapping serves every row. */
const BADGE_COLOR: Record<'ok' | 'warn' | 'error' | 'neutral', string> = {
  ok: '#1a7a4a',
  warn: '#b35a00',
  error: '#cc2200',
  neutral: 'var(--muted)',
}

interface RunnerResultsProps {
  results: EndpointRunResult[]
  report: RunnerReport | null
  isRunning: boolean
  currentIndex: number
  totalCount: number
  runStartedAt: number | null
  sourceLabel?: string
  /** Graceful stop: end the flow, let every teardown step and script finish. */
  onStop: () => void
  /**
   * Hard stop (issue #91): abort the request on the wire and run nothing after
   * the click, cleanup included. A separate button rather than a second meaning
   * for Stop — the single control had to infer which one the user wanted, and
   * inferred it from timing.
   */
  onStopDirect?: () => void
  /**
   * The run has reached cleanup. Stop then means something different — the
   * flow is already over, so the only thing left to abandon is the teardown —
   * and the button has to SAY so, because that is the difference between a
   * deliberate skip and the run finishing cleanup normally.
   */
  inTeardown?: boolean
  /** A stop has been requested — the buttons say so, since a graceful stop
   *  cannot interrupt the request already on the wire and otherwise looks
   *  ignored for as long as that request takes. */
  stopRequested?: 'graceful' | 'direct' | null
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
  onStopDirect,
  inTeardown = false,
  stopRequested = null,
  onNewRun,
  onRunAgain,
  onViewAllRuns,
  selectedResultId,
  onSelectResult,
  onOpenEndpoint,
}: RunnerResultsProps) {
  const { t } = useTranslation()
  const [activeFilter, setActiveFilter] = useState<FilterTab>('all')
  const [detailTab, setDetailTab] = useState<'response' | 'request' | 'console'>('response')
  // Per-iteration collapse state. Default is "all expanded" — collapsing is
  // an opt-in for long runs. Keyed by 1-based iteration index so older
  // history rows (no `iteration` field) bucket into Iteration 1 cleanly.
  const [collapsedIterations, setCollapsedIterations] = useState<Set<number>>(new Set())

  // Every headline number comes from the SHARED summary (shared/runner-summary),
  // which applies the verdict rule (a test that allows a 400 counts as passed —
  // issue #16), excludes teardown from the verdict (issue #72) and treats a
  // skipped row as neither passed nor failed.
  // The hand-rolled versions that used to live here counted `results.length` as
  // "All tests" (so setup/teardown/hook rows inflated it) and every row with an
  // `error` as an error (so a cleanup failure raised the Errors counter this very
  // feature promises never affects the verdict).
  const summary = useMemo(() => summarizeRun(results), [results])
  const totalPassed = summary.passed
  const totalFailed = summary.failed
  const teardownFailedCount = summary.teardownFailed
  const totalDuration = report
    ? report.completedAt - report.startedAt
    : results.reduce((acc, r) => acc + r.duration, 0)
  const totalTests = summary.total
  const totalErrors = summary.errors
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
        // A skipped row belongs under exactly one tab — its own. Without the
        // guard it would also appear under "Passed", since `endpointDidPass`
        // reads its absent status as a success.
        case 'passed':
          return !isSkippedStep(r) && endpointDidPass(r)
        case 'failed':
          return !isSkippedStep(r) && !endpointDidPass(r)
        case 'errors':
          return !!r.error
        case 'skipped':
          return isSkippedStep(r)
        case 'console':
          return (r.consoleLogs?.length ?? 0) > 0
        default:
          return true
      }
    })
  }, [results, activeFilter])

  // Bucket filtered results by 1-based iteration index. Results predating
  // the iteration field (older history rows) fall into bucket 1 so the UI
  // stays backwards compatible — a single "Iteration 1" group identical to
  // the previous flat list.
  // Setup / teardown rows belong to no iteration — they bracket the whole run
  // and render as their own sections (issue #72).
  const setupRows = useMemo(
    () => filteredResults.filter((r) => r.phase === 'setup'),
    [filteredResults],
  )
  const teardownRows = useMemo(
    () => filteredResults.filter((r) => r.phase === 'teardown'),
    [filteredResults],
  )

  const iterationGroups = useMemo(() => {
    const map = new Map<number, EndpointRunResult[]>()
    for (const r of filteredResults) {
      if (r.phase === 'setup' || r.phase === 'teardown') continue
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
    { key: 'skipped', label: 'Skipped', count: summary.skipped },
    { key: 'errors', label: 'Errors', count: totalErrors },
    { key: 'console', label: 'Console log', count: summary.consoleLogs },
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
                {inTeardown
                  ? `Cleaning up — ${currentIndex} of ${totalCount}...`
                  : `Running ${currentIndex} of ${totalCount}...`}
              </span>
              {/*
                Two stops, not one control that changes its mind (issue #91).
                Stop is the safe abort — the flow ends, cleanup still runs — and
                during cleanup it is the only thing left to abandon, so it says
                "Skip teardown" there. "Stop now" is the hard halt: it aborts
                the request on the wire and runs nothing afterwards.

                Both report the click immediately. A graceful stop deliberately
                lets the in-flight request finish, so without this the screen is
                unchanged for as long as that request takes — which is exactly
                how "Stop does not work" got reported.
              */}
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={onStop}
                  data-testid="runner-stop"
                  disabled={stopRequested === 'graceful' && !inTeardown}
                  title={
                    inTeardown
                      ? 'Abandon cleanup — including the step currently running'
                      : 'End the run — cleanup still runs (every teardown request and script)'
                  }
                  className="rounded-[5px] border border-[#cc2200] bg-transparent px-3 py-1 disabled:cursor-default disabled:opacity-60"
                  style={{
                    fontSize: 13,
                    fontWeight: 500,
                    color: '#cc2200',
                    cursor: stopRequested === 'graceful' && !inTeardown ? 'default' : 'pointer',
                  }}
                >
                  {inTeardown
                    ? 'Skip teardown'
                    : stopRequested === 'graceful'
                      ? 'Stopping…'
                      : 'Stop'}
                </button>
                {/* Hidden during cleanup: there it would be the same action as
                    the button beside it, and two controls doing one thing is
                    how the original ambiguity started. */}
                {onStopDirect && !inTeardown && (
                  <button
                    type="button"
                    onClick={onStopDirect}
                    data-testid="runner-stop-direct"
                    disabled={stopRequested === 'direct'}
                    title="Halt now — abort the request in flight and skip all remaining steps, cleanup included"
                    className="rounded-[5px] border border-[#cc2200] px-3 py-1 disabled:cursor-default disabled:opacity-60"
                    style={{
                      fontSize: 13,
                      fontWeight: 500,
                      color: '#ffffff',
                      background: '#cc2200',
                      cursor: stopRequested === 'direct' ? 'default' : 'pointer',
                    }}
                  >
                    {stopRequested === 'direct' ? 'Halting…' : 'Stop now'}
                  </button>
                )}
              </div>
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

            {/* Why the run ended early + whether cleanup got its turn. Without
                this line a short result list looks like data loss (issue #72). */}
            {(report?.stopReason || teardownFailedCount > 0) && (
              <div className="mb-3 flex flex-wrap items-center gap-2" style={{ fontSize: 12 }}>
                {report?.stopReason && (
                  <span style={{ color: 'var(--muted)' }}>
                    {t(stopReasonKey(report.stopReason))}
                  </span>
                )}
                {teardownFailedCount > 0 && (
                  <span style={{ color: '#b35a00' }}>
                    {t('runLifecycle.teardownSection')}: {teardownFailedCount} ·{' '}
                    {t('runLifecycle.teardownNote')}
                  </span>
                )}
              </div>
            )}

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
        <div className="flex-1 overflow-auto" data-testid="runner-results-list">
          {setupRows.length > 0 && (
            <PhaseSection title={t('runLifecycle.setupSection')}>
              {setupRows.map((result, idx) => (
                <ResultRow
                  key={`setup-${result.endpointId}-${idx}`}
                  result={result}
                  isSelected={result.endpointId === selectedResultId}
                  onClick={() =>
                    onSelectResult(
                      result.endpointId === selectedResultId ? null : result.endpointId,
                    )
                  }
                />
              ))}
            </PhaseSection>
          )}
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
          {teardownRows.length > 0 && (
            <PhaseSection
              title={t('runLifecycle.teardownSection')}
              note={t('runLifecycle.teardownNote')}
            >
              {teardownRows.map((result, idx) => (
                <ResultRow
                  key={`teardown-${result.endpointId}-${idx}`}
                  result={result}
                  isSelected={result.endpointId === selectedResultId}
                  onClick={() =>
                    onSelectResult(
                      result.endpointId === selectedResultId ? null : result.endpointId,
                    )
                  }
                />
              ))}
            </PhaseSection>
          )}
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
            {(
              [
                'response',
                'request',
                // Only offered when this step actually logged something, so the
                // tab strip stays quiet for the majority of rows.
                ...((selectedResult.consoleLogs?.length ?? 0) > 0 ? (['console'] as const) : []),
              ] as const
            ).map((tab) => (
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
              {(() => {
                const badge = statusBadge(selectedResult)
                if (!badge) return null
                return (
                  <>
                    <span style={{ fontWeight: 600, color: BADGE_COLOR[badge.tone] }}>
                      {badge.text}
                    </span>
                    <span style={{ color: 'var(--hint)' }}>·</span>
                  </>
                )
              })()}
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

          {detailTab === 'console' && (
            <div className="flex-1 overflow-auto px-4 py-3">
              {(selectedResult.consoleLogs ?? []).map((entry, i) => (
                <div
                  key={i}
                  className="whitespace-pre-wrap break-all"
                  style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: 12,
                    color: CONSOLE_LEVEL_COLOR[entry.level],
                  }}
                >
                  {entry.message}
                </div>
              ))}
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

/**
 * Header for a lifecycle phase (Setup / Teardown). Teardown carries a note
 * spelling out that its outcome does not move the run's verdict — otherwise a
 * red cleanup row next to a green summary reads like a bug (issue #72).
 */
function PhaseSection({
  title,
  note,
  children,
}: {
  title: string
  note?: string
  children: React.ReactNode
}) {
  return (
    <div>
      <div
        className="flex items-center gap-2 border-b border-[var(--border)] bg-[var(--surface)] px-5 py-2"
        style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}
      >
        <span>{title}</span>
        {note && <span style={{ fontWeight: 400, color: 'var(--hint)' }}>· {note}</span>}
      </div>
      {children}
    </div>
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
  // Shared badge logic: a run-level SCRIPT row is not an HTTP exchange and must
  // not render main's placeholder 200, and a row that never ran says so.
  const badge = statusBadge(result)

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
        {badge && (
          <span
            style={{
              fontSize: 13,
              fontWeight: badge.tone === 'neutral' ? 500 : 600,
              color: BADGE_COLOR[badge.tone],
              flexShrink: 0,
            }}
          >
            {badge.text}
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
        // "No tests found" is useful under a REQUEST — it says the step ran
        // unchecked. Under a run-level script row, or a step that never ran, it
        // is noise about something the user did not ask for.
        !SYNTHETIC_STATUS.has(result.statusText) && (
          <div style={{ fontSize: 13, color: 'var(--hint)' }}>No tests found</div>
        )
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
