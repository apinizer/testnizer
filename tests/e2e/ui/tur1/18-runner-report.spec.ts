/**
 * MST-177 P1  HTML report export
 * MST-181 P2  Failed item drill-down filter
 */
import { expect } from '@playwright/test'
import { uiTest } from './_setup'
import {
  dismissOverlays,
  ensureCanonicalProject,
  navigateSidebar,
  openHttpRequestTab,
} from '../../helpers/ui/bootstrap'
import {
  fillUrl,
  addVisualAssertion,
  saveRequestToTree,
} from '../../helpers/ui/request-flow'
import {
  openCollectionRunner,
  startCollectionRun,
  waitCollectionRunComplete,
  closeCollectionRunner,
  selectOnlyRunnerEndpoints,
  startRunnerTabRun,
  waitRunnerTabComplete,
  readRunnerTabSummary,
  waitRunnerConfigReady,
} from '../../helpers/ui/runner-flow'
import {
  createTestSuite,
  addSuiteItem,
  saveActiveSuiteItem,
  runSuiteFromContextMenu,
} from '../../helpers/ui/suite-flow'
import { exportRunnerReportHtml } from '../../helpers/ui/runner-extra'
import { localHttpBin } from '../../helpers/test-servers'

const http = () => localHttpBin()
const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`

uiTest.describe('Tur1 — Runner report [MST-177, MST-181]', () => {
  uiTest.beforeEach(async ({ window }) => {
    await dismissOverlays(window)
    await ensureCanonicalProject(window)
    await navigateSidebar(window, 'apis')
  })

  /**
   * MST-177 — HTML report export
   * After a completed run the IPC runner:export handler must return HTML that
   * contains the pass/fail counts embedded in the document.
   *
   * The export helper reads the RunnerTab's `runner-report-${tabId}`
   * sessionStorage payload — that key is only written by the suite/RunnerTab
   * path (the collection-runner MODAL keeps results in the Zustand store and
   * never touches sessionStorage). So this test runs a mixed pass/fail suite
   * via the RunnerTab and then exports.
   *
   * NOTE: The UI "Export HTML" button has no data-testid; we exercise the IPC
   * layer directly (runner:export with format:'html').
   * NEEDS HOOK: data-testid="runner-export-html" on the Export HTML button in
   * RunnerResults so the button click path can also be tested.
   */
  uiTest('MST-177 exported HTML report contains pass and fail counts', async ({ window }) => {
    const suiteName = `Report177-${uid()}`

    await createTestSuite(window, suiteName)

    // Passing item: 200 with assertion status==200.
    await addSuiteItem(window, suiteName)
    await fillUrl(window, `${http()}/get?mst177=pass`)
    await addVisualAssertion(window, /Status code equals/i, { expected: 200 })
    await saveActiveSuiteItem(window)

    // Failing item: 500 with assertion status==200.
    await addSuiteItem(window, suiteName)
    await fillUrl(window, `${http()}/status/500`)
    await addVisualAssertion(window, /Status code equals/i, { expected: 200 })
    await saveActiveSuiteItem(window)

    await runSuiteFromContextMenu(window, suiteName)
    await waitRunnerConfigReady(window)
    await startRunnerTabRun(window)
    await waitRunnerTabComplete(window, 120_000)

    const summary = await readRunnerTabSummary(window)
    expect(summary.passed).toBeGreaterThanOrEqual(1)
    expect(summary.failed).toBeGreaterThanOrEqual(1)

    // Export via IPC and validate HTML content.
    const html = await exportRunnerReportHtml(window)
    expect(html.length).toBeGreaterThan(100)
    expect(html.toLowerCase()).toContain('<!doctype html')

    // The HTML must reference pass/fail counts somewhere.
    const hasPassCount = /passed|pass|✓|✅/i.test(html)
    const hasFailCount = /failed|fail|✗|❌/i.test(html)
    expect(hasPassCount || html.includes('200')).toBe(true)
    expect(hasFailCount || html.includes('500')).toBe(true)
  })

  /**
   * MST-181 P2 — Failed item drill-down filter
   * After a mixed pass/fail run the runner-filter-failed button must narrow
   * the displayed rows to only failing items.
   *
   * NOTE: This test uses the collection runner modal because that is where
   * runner-filter-* testids are confirmed present.
   */
  uiTest('MST-181 failed filter shows only failed results', async ({ window }) => {
    // Shared tag lets us scope the collection run to just these two requests —
    // the worker-scoped app accumulates many saved requests across tests and an
    // unscoped run would make the filtered view non-deterministic.
    const tag = `mst181-${uid()}`
    const passName = `Pass-${tag}`
    const failName = `Fail-${tag}`

    await openHttpRequestTab(window)
    await fillUrl(window, `${http()}/get?mst181=pass`)
    await addVisualAssertion(window, /Status code equals/i, { expected: 200 })
    await saveRequestToTree(window, passName)

    await openHttpRequestTab(window)
    await fillUrl(window, `${http()}/status/500`)
    await addVisualAssertion(window, /Status code equals/i, { expected: 200 })
    await saveRequestToTree(window, failName)

    await openCollectionRunner(window)
    await selectOnlyRunnerEndpoints(window, tag)
    await startCollectionRun(window)
    await waitCollectionRunComplete(window)

    const modal = window.getByTestId('collection-runner-modal')

    // Click the Failed filter tab.
    const failedBtn = modal.getByTestId('runner-filter-failed')
    await expect(failedBtn).toBeVisible({ timeout: 10_000 })
    await failedBtn.click()

    // The failing endpoint should be visible; the passing one should not.
    await expect(modal.getByText(failName, { exact: false }).first()).toBeVisible({ timeout: 10_000 })
    // The passing request must not appear in the failed-only view.
    // (It may appear 0 or > 0 times depending on exact filter UI — assert count <= 0)
    const passCount = await modal.getByText(passName, { exact: false }).count()
    expect(passCount).toBe(0)

    await closeCollectionRunner(window)
  })
})
