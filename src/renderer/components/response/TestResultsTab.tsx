import { useState } from 'react'
import { useResponseStore } from '../../stores/response.store'
import { ChevronDown } from 'lucide-react'
import { useTranslation } from '../../lib/i18n'
import type { TestResult } from '../../types'

type FilterMode = 'all' | 'passed' | 'failed'

/**
 * Postman-style Test Results tab — PASSED/FAILED badges with filter dropdown.
 * Reads the active tab's HTTP response by default; a caller with its own
 * results (the MCP result area, issue #160) passes them in.
 */
export default function TestResultsTab({ results: given }: { results?: TestResult[] } = {}) {
  const { t } = useTranslation()
  const response = useResponseStore((s) => s.response)
  const results = given ?? response?.testResults ?? []
  const [filter, setFilter] = useState<FilterMode>('all')
  const [showFilterDrop, setShowFilterDrop] = useState(false)

  if (results.length === 0) {
    return (
      <div className="p-4 text-center" style={{ color: 'var(--hint)' }}>
        {t('response.tests.none')}
      </div>
    )
  }

  const passed = results.filter((r) => r.passed).length
  const failed = results.length - passed

  const filtered =
    filter === 'all'
      ? results
      : filter === 'passed'
        ? results.filter((r) => r.passed)
        : results.filter((r) => !r.passed)

  const filterLabel =
    filter === 'all'
      ? t('response.tests.filter')
      : filter === 'passed'
        ? t('response.tests.passed')
        : t('response.tests.failed')

  return (
    <div className="h-full overflow-auto" data-testid="test-results-panel">
      {/* Filter bar — Postman style */}
      <div
        className="flex items-center gap-3 px-4 py-2"
        style={{
          borderBottom: '1px solid var(--border)',
        }}
      >
        {/* Filter dropdown */}
        <div style={{ position: 'relative' }}>
          <button
            type="button"
            onClick={() => setShowFilterDrop((v) => !v)}
            className="flex cursor-pointer items-center gap-1 rounded px-2 py-1"
            style={{
              background: 'transparent',
              border: '1px solid var(--border2)',
              color: 'var(--text)',
              borderRadius: 4,
            }}
          >
            {filterLabel}
            <ChevronDown size={12} style={{ color: 'var(--muted)' }} />
          </button>

          {showFilterDrop && (
            <div
              style={{
                position: 'absolute',
                top: 'calc(100% + 2px)',
                left: 0,
                zIndex: 200,
                background: 'var(--white)',
                border: '1px solid var(--border)',
                borderRadius: 6,
                padding: 4,
                minWidth: 120,
                boxShadow: 'var(--shadow-drop)',
              }}
            >
              {(['all', 'passed', 'failed'] as FilterMode[]).map((mode) => (
                <div
                  key={mode}
                  onClick={() => {
                    setFilter(mode)
                    setShowFilterDrop(false)
                  }}
                  className="cursor-pointer rounded px-3 py-1.5"
                  style={{ color: 'var(--text)' }}
                  onMouseEnter={(e) => {
                    ;(e.currentTarget as HTMLElement).style.background = 'var(--surface)'
                  }}
                  onMouseLeave={(e) => {
                    ;(e.currentTarget as HTMLElement).style.background = 'transparent'
                  }}
                >
                  {mode === 'all'
                    ? t('response.tests.all')
                    : mode === 'passed'
                      ? t('response.tests.passed')
                      : t('response.tests.failed')}
                  {mode === 'all' && ` (${results.length})`}
                  {mode === 'passed' && ` (${passed})`}
                  {mode === 'failed' && ` (${failed})`}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Result rows — Postman style with PASSED/FAILED badges */}
      <div>
        {filtered.map((r, idx) => (
          <div
            key={idx}
            className="flex items-start gap-3 px-4 py-3"
            style={{ borderBottom: '1px solid var(--border-split)' }}
          >
            {/* PASSED / FAILED badge */}
            <span
              className="mt-[1px] shrink-0 rounded px-2 py-0.5 font-bold uppercase"
              style={{
                background: r.passed ? 'var(--green-bg)' : 'rgba(239,68,68,0.12)',
                color: r.passed ? 'var(--green)' : 'var(--red)',
                border: r.passed
                  ? '1px solid var(--green-border)'
                  : '1px solid rgba(239,68,68,0.3)',
                letterSpacing: '0.02em',
              }}
            >
              {r.passed ? t('response.tests.passBadge') : t('response.tests.failBadge')}
            </span>

            {/* Test name + error */}
            <div className="flex-1 min-w-0">
              <span style={{ color: 'var(--text)' }}>{r.assertion.name}</span>
              {!r.passed && r.error && (
                <span className="ml-1" style={{ color: 'var(--muted)' }}>
                  {' | '}
                  <span style={{ color: 'var(--red)' }}>{r.error}</span>
                </span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
