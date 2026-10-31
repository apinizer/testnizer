/**
 * MST-177 P1  HTML report export (IPC path + the real Export buttons, issue #266)
 * MST-181 P2  Failed item drill-down filter
 * MST-255     Start run is visible without scrolling (issue #255); narrow Schedule mode
 */
import { expect, type ElectronApplication } from '@playwright/test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
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
import { setContentSize } from '../../helpers/ui/layout-extra'

const http = () => localHttpBin()
const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`

/** Point the native Save dialog at `target` (restored by the returned fn). */
async function stubSaveDialog(
  app: ElectronApplication,
  target: string | null,
): Promise<() => Promise<void>> {
  await app.evaluate(
    ({ dialog }, target) => {
      const d = dialog as unknown as Record<string, unknown>
      d.__e266_showSaveDialog = d.__e266_showSaveDialog ?? d.showSaveDialog
      d.showSaveDialog = async () =>
        target ? { canceled: false, filePath: target } : { canceled: true, filePath: undefined }
    },
    target,
  )
  return async () => {
    await app.evaluate(({ dialog }) => {
      const d = dialog as unknown as Record<string, unknown>
      if (d.__e266_showSaveDialog) {
        d.showSaveDialog = d.__e266_showSaveDialog
        delete d.__e266_showSaveDialog
      }
    })
  }
}

/** The headline numbers an exported HTML report prints (`data-stat`, issue #266). */
function htmlStat(html: string, name: string): number {
  const m = html.match(new RegExp(`data-stat="${name}"[^>]*>\\s*(\\d+)\\s*<`))
  if (!m) throw new Error(`report has no data-stat="${name}"`)
  return Number(m[1])
}

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
   * The IPC layer is exercised directly first (runner:export, format:'html'),
   * then the REAL buttons (`runner-export-html` / `runner-export-json`, issue
   * #266) are clicked with the native Save dialog stubbed to a temp file; the
   * saved report's headline counts must equal the in-app summary.
   */
  uiTest('MST-177 exported HTML report contains pass and fail counts', async ({ window, app }) => {
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

    // ── The real buttons (issue #266) ──────────────────────────────
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tn-report-'))
    const htmlFile = path.join(dir, 'report.html')
    const jsonFile = path.join(dir, 'report.json')
    const results = window.getByTestId('workbench')
    const exportHtml = results.getByTestId('runner-export-html')
    const exportJson = results.getByTestId('runner-export-json')
    await expect(exportHtml).toBeVisible()
    await expect(exportJson).toBeVisible()

    let restore = await stubSaveDialog(app, htmlFile)
    try {
      await exportHtml.click()
      await expect.poll(() => fs.existsSync(htmlFile), { timeout: 10_000 }).toBe(true)
    } finally {
      await restore()
    }
    const saved = fs.readFileSync(htmlFile, 'utf8')
    expect(saved.toLowerCase()).toContain('<!doctype html')
    // Headline counts == the in-app summary (teardown excluded, same helper).
    expect(htmlStat(saved, 'passed')).toBe(summary.passed)
    expect(htmlStat(saved, 'failed')).toBe(summary.failed)

    restore = await stubSaveDialog(app, jsonFile)
    try {
      await exportJson.click()
      await expect.poll(() => fs.existsSync(jsonFile), { timeout: 10_000 }).toBe(true)
    } finally {
      await restore()
    }
    const rows = JSON.parse(fs.readFileSync(jsonFile, 'utf8')) as Array<{ status: number | null }>
    expect(Array.isArray(rows)).toBe(true)
    expect(rows.length).toBeGreaterThanOrEqual(2)
    expect(rows.some((r) => r.status === 500)).toBe(true)

    // Cancelling the dialog writes nothing and shows no error toast.
    const cancelled = path.join(dir, 'never.html')
    restore = await stubSaveDialog(app, null)
    try {
      await exportHtml.click()
      await window.waitForTimeout(500)
    } finally {
      await restore()
    }
    expect(fs.existsSync(cancelled)).toBe(false)
    await expect(window.getByText(/export failed|could not export/i)).toHaveCount(0)

    fs.rmSync(dir, { recursive: true, force: true })
  })

  /**
   * MST-255 — the primary action is never below the fold (issue #255).
   * At the default Playwright/Electron window the Run configuration column
   * scrolls; Start run used to sit at y=887 behind the footer. It now lives in
   * a pinned action bar, so it is in the viewport as soon as the config opens —
   * without scrolling — and stays there after the column is scrolled.
   */
  uiTest('MST-255 Start run is in the viewport without scrolling the config', async ({ window }) => {
    const suiteName = `Fold255-${uid()}`
    await createTestSuite(window, suiteName)
    await addSuiteItem(window, suiteName)
    await fillUrl(window, `${http()}/get?mst255=1`)
    await saveActiveSuiteItem(window)

    await runSuiteFromContextMenu(window, suiteName)
    await waitRunnerConfigReady(window)

    const start = window.getByTestId('runner-start')
    await expect(start).toBeInViewport({ ratio: 1 })
    await expect(window.getByTestId('runner-action-bar')).toBeInViewport({ ratio: 1 })

    // Scroll the config body to the very bottom: the bar does not move.
    const before = await start.boundingBox()
    await window.getByTestId('runner-action-bar').evaluate((bar) => {
      const scroller = bar.parentElement?.querySelector(':scope > .overflow-auto')
      if (scroller) scroller.scrollTop = scroller.scrollHeight
    })
    const after = await start.boundingBox()
    expect(after?.y).toBe(before?.y)
    await expect(start).toBeInViewport({ ratio: 1 })
  })

  /**
   * MST-255 narrow (1.6.0 screen review G-16) — at 1024x700 in Schedule mode
   * the Run Sequence pane kept its full width, the config column overflowed
   * horizontally and "Save configuration" was clipped at the right edge. The
   * sequence pane now shrinks first, the fields stack and the action bar wraps:
   * every footer button lies inside the bar, each label stays on one line, and
   * the config body never needs a horizontal scrollbar.
   */
  uiTest(
    'MST-255 narrow: Schedule mode at 1024x700 — no clipped footer, no horizontal overflow',
    async ({ app, window }) => {
      const suiteName = `Narrow255-${uid()}`
      await createTestSuite(window, suiteName)
      await addSuiteItem(window, suiteName)
      await fillUrl(window, `${http()}/get?mst255=narrow`)
      await saveActiveSuiteItem(window)

      await runSuiteFromContextMenu(window, suiteName)
      await waitRunnerConfigReady(window)
      await window
        .getByTestId('workbench')
        .getByLabel(/Schedule runs/i)
        .check()

      const original = await setContentSize(app, window, 1024, 700)
      try {
        const bar = window.getByTestId('runner-action-bar')
        await expect(bar).toBeInViewport({ ratio: 1 })
        const barBox = (await bar.boundingBox())!
        for (const id of ['runner-start', 'runner-save-config']) {
          const button = window.getByTestId(id)
          await expect(button).toBeVisible()
          const b = (await button.boundingBox())!
          expect(b.x + b.width, `${id} right edge past the bar`).toBeLessThanOrEqual(
            barBox.x + barBox.width + 1,
          )
          expect(b.x, `${id} left edge before the bar`).toBeGreaterThanOrEqual(barBox.x - 1)
          // One line: a two-line label roughly doubles the 13 px button (~34 px).
          expect(b.height, `${id} label wrapped`).toBeLessThanOrEqual(44)
        }
        const body = window.getByTestId('runner-config-body')
        const spill = await body.evaluate((el) => el.scrollWidth - el.clientWidth)
        expect(spill, 'config body overflows horizontally').toBeLessThanOrEqual(1)
        const column = window.getByTestId('runner-config-pane')
        const columnSpill = await column.evaluate((el) => el.scrollWidth - el.clientWidth)
        expect(columnSpill, 'config column overflows horizontally').toBeLessThanOrEqual(1)
      } finally {
        await setContentSize(app, window, original.width, original.height)
      }
    },
  )

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

    // The runner is a tab now, not a modal. Scope to the results LIST, not the
    // whole workbench: the tab shows the Run Sequence beside the results, and
    // that list names every selected endpoint whatever the filter says — the
    // modal simply had nothing else on screen to catch.
    const workbench = window.getByTestId('workbench')
    const results = workbench.getByTestId('runner-results-list')

    // Click the Failed filter tab.
    const failedBtn = workbench.getByTestId('runner-filter-failed')
    await expect(failedBtn).toBeVisible({ timeout: 10_000 })
    await failedBtn.click()

    // The failing endpoint should be visible; the passing one should not.
    await expect(results.getByText(failName, { exact: false }).first()).toBeVisible({
      timeout: 10_000,
    })
    // The passing request must not appear in the failed-only view.
    const passCount = await results.getByText(passName, { exact: false }).count()
    expect(passCount).toBe(0)

    await closeCollectionRunner(window)
  })
})
