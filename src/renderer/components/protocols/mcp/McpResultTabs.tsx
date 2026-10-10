import { useState, type ReactNode } from 'react'
import { useTranslation } from '../../../lib/i18n'
import type { McpTestRun } from '../../../lib/mcp-send-scripts'
import TestResultsTab from '../../response/TestResultsTab'
import { ErrorLine } from './ui'

type View = 'result' | 'tests'

/**
 * Result | Test Results under a finished MCP call (issue #160). Until the
 * call's Tests / Scripts produced something, only the result shows — no empty
 * tab. The Test Results view IS the HTTP response pane's (`TestResultsTab`):
 * same PASSED / FAILED badges, filter and colours; the tab label carries the
 * HTTP `passed/total` count, green when all passed, red otherwise.
 */
export default function McpResultTabs({
  tests,
  children,
}: {
  tests: McpTestRun | null
  children: ReactNode
}) {
  const { t } = useTranslation()
  const [view, setView] = useState<View>('result')
  if (!tests) return <>{children}</>
  const total = tests.results.length
  const passed = tests.results.filter((r) => r.passed).length
  const allPassed = passed === total && !tests.scriptError
  const tab = (id: View, label: ReactNode) => (
    <button
      type="button"
      role="tab"
      aria-selected={view === id}
      data-testid={`mcp-result-tab-${id}`}
      onClick={() => setView(id)}
      className={`flex cursor-pointer items-center gap-1.5 border-x-0 border-t-0 border-b-2 bg-transparent px-2 py-1 text-[12px] ${
        view === id
          ? 'border-[var(--accent)] text-[var(--accent-text)]'
          : 'border-transparent text-[var(--muted)] hover:text-[var(--text)]'
      }`}
    >
      {label}
    </button>
  )

  return (
    <div className="flex flex-col gap-2">
      <div role="tablist" className="flex items-center gap-1 border-b border-[var(--border)]">
        {tab('result', t('mcp.result.title'))}
        {tab(
          'tests',
          <>
            {t('mcp.tests.tab')}
            <span
              data-testid="mcp-tests-summary"
              data-passed={allPassed ? 'true' : 'false'}
              title={t('mcp.tests.passedOf')
                .replace('{passed}', String(passed))
                .replace('{total}', String(total))}
              className={`rounded-full px-[5px] text-[10px] font-semibold ${
                allPassed
                  ? 'bg-[var(--green-bg)] text-[var(--green)]'
                  : 'bg-[var(--mb-delete-bg)] text-[var(--red)]'
              }`}
            >
              {`${passed}/${total}`}
            </span>
          </>,
        )}
      </div>
      {view === 'result' ? (
        children
      ) : (
        <div data-testid="mcp-test-results" className="flex flex-col gap-2">
          {tests.scriptError && (
            <ErrorLine testId="mcp-tests-script-error">
              {t('mcp.tests.scriptError').replace('{error}', tests.scriptError)}
            </ErrorLine>
          )}
          {(total > 0 || !tests.scriptError) && <TestResultsTab results={tests.results} />}
        </div>
      )}
    </div>
  )
}
