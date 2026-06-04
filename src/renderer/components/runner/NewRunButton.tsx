import { useEffect, useRef, useState } from 'react'
import { FolderOpen, Play } from 'lucide-react'
import { useTranslation } from '../../lib/i18n'

interface TestSuiteRow {
  id: string
  name: string
}

interface NewRunButtonProps {
  /** Suites available in the current project. When empty the dropdown is
   * hidden and the button surfaces a tooltip explaining why. */
  suites: TestSuiteRow[]
  /** When 'schedule', clicking a suite seeds the runner in schedule mode;
   * otherwise the runner opens for a manual run. */
  mode: 'manual' | 'schedule'
  /** Suite click handler — wired by callers to openOrReuseRunnerTab so
   * each surface decides scheduleMode / sessionData / tabName. */
  onPickSuite: (suite: TestSuiteRow) => void
  /** Fallback used only by manual-mode callers when no suites exist. The
   * scheduled-tasks surface omits this — there's nothing to fall back to
   * for "schedule without a suite". */
  onFallback?: () => void
}

/**
 * Shared "New Run" header button used by TestsHome, RunnerHistory (All
 * Runs), and ScheduledTasksView. Renders identically across all three
 * surfaces and owns the suite-picker dropdown so the surfaces don't drift
 * out of style sync.
 *
 * Behaviour:
 *   - 0 suites + manual mode → falls through to `onFallback` (legacy
 *     blank-slate picker) so a brand-new project isn't blocked.
 *   - 0 suites + schedule mode → button disabled with a tooltip pointing
 *     at the sidebar.
 *   - ≥1 suite → click opens a dropdown; selecting a row invokes
 *     `onPickSuite`.
 */
export default function NewRunButton({ suites, mode, onPickSuite, onFallback }: NewRunButtonProps) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const wrapperRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function handler(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const empty = suites.length === 0
  const disabled = empty && mode === 'schedule'
  const tooltipKey =
    empty && mode === 'schedule'
      ? 'newRun.tooltipNoSuitesSchedule'
      : mode === 'schedule'
        ? 'newRun.tooltipSchedule'
        : 'newRun.tooltipRun'
  const headerKey = mode === 'schedule' ? 'newRun.headerSchedule' : 'newRun.headerRun'

  return (
    <div ref={wrapperRef} style={{ position: 'relative' }}>
      <button
        type="button"
        onClick={() => {
          if (empty && mode === 'manual' && onFallback) {
            onFallback()
            return
          }
          if (!empty) setOpen((v) => !v)
        }}
        disabled={disabled}
        title={t(tooltipKey)}
        className="flex cursor-pointer items-center gap-1.5 rounded-[6px] border-none px-3 py-1.5 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
        style={{ background: '#e86826', fontSize: 13 }}
      >
        <Play size={13} />
        {t('newRun.label')}
      </button>
      {open && !empty && (
        <div
          className="absolute right-0 z-50 mt-1 overflow-hidden rounded-[8px] border"
          style={{
            top: '100%',
            background: 'var(--white)',
            borderColor: 'var(--border)',
            minWidth: 260,
            boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
          }}
        >
          <div
            className="px-3 py-2"
            style={{
              borderBottom: '1px solid var(--border)',
              color: 'var(--muted)',
              fontSize: 12,
              fontWeight: 600,
              textTransform: 'uppercase',
              letterSpacing: 0.5,
            }}
          >
            {t(headerKey)}
          </div>
          <div className="max-h-[320px] overflow-auto">
            {suites.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => {
                  setOpen(false)
                  onPickSuite(s)
                }}
                className="flex w-full cursor-pointer items-center gap-2 border-none bg-transparent px-3 py-2 text-left hover:bg-[var(--surface)]"
                style={{ color: 'var(--text)', fontSize: 13 }}
              >
                <FolderOpen size={14} style={{ color: 'var(--accent)' }} />
                <span style={{ flex: 1 }}>{s.name}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
