import { ChevronDown, ChevronRight, CheckCircle2, XCircle } from 'lucide-react'
import { useRunnerStore } from '../../stores/runner.store'
import MethodBadge from '../shared/MethodBadge'
import StatusBadge from '../shared/StatusBadge'

export default function RunnerResultsPanel() {
  const results = useRunnerStore((s) => s.results)
  const endpoints = useRunnerStore((s) => s.endpoints)
  const isRunning = useRunnerStore((s) => s.isRunning)
  const currentIndex = useRunnerStore((s) => s.currentIndex)
  const toggleResultExpand = useRunnerStore((s) => s.toggleResultExpand)

  const selectedCount = endpoints.filter((ep) => ep.selected).length
  const totalPassed = results.reduce(
    (acc, r) => acc + r.testResults.filter((t) => t.passed).length, 0
  )
  const totalFailed = results.reduce(
    (acc, r) => acc + r.testResults.filter((t) => !t.passed).length, 0
  )
  const totalTime = results.reduce((acc, r) => acc + r.duration, 0)
  const progress = selectedCount > 0 ? (results.length / selectedCount) * 100 : 0

  return (
    <div className="flex flex-1 flex-col overflow-hidden bg-[var(--white)]">
      {/* Progress bar */}
      {(isRunning || results.length > 0) && (
        <div className="shrink-0 border-b border-[var(--border)] px-5 py-3">
          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-[0.875rem] text-[var(--muted)]">
              {isRunning ? `Running ${currentIndex + 1} of ${selectedCount}...` : `Completed ${results.length} of ${selectedCount}`}
            </span>
            <span className="text-[0.875rem] font-medium text-[var(--text)]">
              {Math.round(progress)}%
            </span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-[var(--border)]">
            <div
              className="h-full rounded-full transition-all duration-300"
              style={{
                width: `${progress}%`,
                background: totalFailed > 0 ? '#cc2200' : 'var(--accent)',
              }}
            />
          </div>
        </div>
      )}

      {/* Results list */}
      <div className="flex-1 overflow-auto">
        {results.length === 0 && !isRunning && (
          <div className="flex h-full items-center justify-center text-sm text-[var(--hint)]">
            Click "Run Collection" to start
          </div>
        )}

        {results.map((result) => {
          const passed = result.testResults.filter((t) => t.passed).length
          const total = result.testResults.length
          const allPassed = total > 0 && passed === total

          return (
            <div key={result.endpointId} className="border-b border-[var(--border)]">
              <button
                type="button"
                onClick={() => toggleResultExpand(result.endpointId)}
                className="flex w-full cursor-pointer items-center gap-3 bg-transparent px-5 py-2.5 text-left transition-colors hover:bg-[var(--surface)]"
                style={{ border: 'none' }}
              >
                <span className="text-[var(--hint)]">
                  {result.expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                </span>
                <MethodBadge method={result.method} />
                <span className="flex-1 truncate text-[0.875rem] text-[var(--text)]">
                  {result.name}
                </span>
                {result.status && (
                  <StatusBadge status={result.status} statusText={result.statusText} />
                )}
                {result.error && !result.status && (
                  <span className="rounded-full bg-[#fff0f0] px-2 py-0.5 text-[0.875rem] text-[#cc2200]">
                    Error
                  </span>
                )}
                <span className="text-[0.875rem] text-[var(--muted)]">{result.duration}ms</span>
                {total > 0 && (
                  <span
                    className="rounded-full px-2 py-0.5 text-[0.875rem] font-medium"
                    style={{
                      background: allPassed ? 'var(--green-bg)' : '#fff0f0',
                      color: allPassed ? 'var(--green)' : '#cc2200',
                    }}
                  >
                    {passed}/{total}
                  </span>
                )}
              </button>

              {result.expanded && (
                <div className="border-t border-[var(--border)] bg-[var(--surface)] px-8 py-2.5">
                  {result.error && (
                    <div className="mb-2 text-sm text-[#cc2200]">{result.error}</div>
                  )}
                  {result.testResults.length > 0 ? (
                    <div className="space-y-1">
                      {result.testResults.map((tr, idx) => (
                        <div key={idx} className="flex items-center gap-2 text-sm">
                          {tr.passed ? (
                            <CheckCircle2 size={13} className="text-[var(--green)]" />
                          ) : (
                            <XCircle size={13} className="text-[#cc2200]" />
                          )}
                          <span className={tr.passed ? 'text-[var(--text)]' : 'text-[#cc2200]'}>
                            {tr.assertion.name}
                          </span>
                          {tr.actual !== undefined && (
                            <span className="text-[var(--muted)]">
                              (actual: {String(tr.actual)})
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-sm text-[var(--hint)]">No test assertions</div>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Summary */}
      {results.length > 0 && !isRunning && (
        <div className="flex shrink-0 items-center gap-5 border-t border-[var(--border)] bg-[var(--bg)] px-5 py-2.5">
          <div className="flex items-center gap-1.5 text-[0.875rem]">
            <CheckCircle2 size={13} className="text-[var(--green)]" />
            <span className="font-semibold text-[var(--green)]">{totalPassed}</span>
            <span className="text-[var(--muted)]">passed</span>
          </div>
          <div className="flex items-center gap-1.5 text-[0.875rem]">
            <XCircle size={13} className="text-[#cc2200]" />
            <span className="font-semibold text-[#cc2200]">{totalFailed}</span>
            <span className="text-[var(--muted)]">failed</span>
          </div>
          <div className="flex-1" />
          <span className="text-[0.875rem] text-[var(--muted)]">
            Total: <span className="font-semibold text-[var(--text)]">{totalTime}ms</span>
          </span>
        </div>
      )}
    </div>
  )
}
