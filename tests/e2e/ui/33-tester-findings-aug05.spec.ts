/**
 * The findings reported against 1.5.0-rc3 on 5 August, walked as the tester
 * walked them.
 *
 *   1. With the Console open, the bottom of the Runner's Run lifecycle form
 *      (the "Run teardown script" box) sat underneath the drawer. There was no
 *      vertical scrollbar, so it could be neither reached nor typed into.
 *
 *   2. A pre-request script that threw logged "Script error" and then sent the
 *      request anyway, which came back 200.
 *
 *   3. The Delay field, sitting next to Iterations and labelled only "Delay",
 *      read as "delay between iterations".
 *
 * All three have unit coverage. These exist because (1) is a pure layout fact
 * that no unit test can observe, and because (2) was reported as a Runner
 * screen behaviour — worth pinning end to end rather than at the handler.
 */
import { expect } from '@playwright/test'
import { uiTest } from './_setup'
import {
  closeAllTabs,
  dismissOverlays,
  ensureCanonicalProject,
  navigateSidebar,
  openHttpRequestTab,
} from '../helpers/ui/bootstrap'
import {
  addPreScript,
  clickSend,
  fillUrl,
  saveRequestToTree,
  waitForResponseError,
} from '../helpers/ui/request-flow'
import {
  openCollectionRunner,
  readRunnerTabSummary,
  selectOnlyRunnerEndpoint,
  selectOnlyRunnerEndpoints,
  startRunnerTabRun,
  waitRunnerTabComplete,
} from '../helpers/ui/runner-flow'
import { openConsolePanel } from '../helpers/ui/console-flow'
import { localHttpBin } from '../helpers/test-servers'

/** Close the console drawer if it is open, so later specs start clean. */
async function closeConsolePanel(page: Parameters<typeof openConsolePanel>[0]): Promise<void> {
  if (await page.getByTestId('console-panel').isVisible().catch(() => false)) {
    await page.getByTestId('footer-console').click().catch(() => {})
  }
}

uiTest.describe('tester findings, 5 August (1.5.0-rc3)', () => {
  uiTest.beforeEach(async ({ window }) => {
    await dismissOverlays(window)
    await ensureCanonicalProject(window)
  })

  uiTest.afterEach(async ({ window }) => {
    await closeConsolePanel(window)
    await closeAllTabs(window)
  })

  uiTest('the Console drawer does not cover the bottom of the Runner form', async ({ window }) => {
    await navigateSidebar(window, 'apis')
    await openHttpRequestTab(window)
    await fillUrl(window, `${localHttpBin()}/get?console-scroll=1`)
    await saveRequestToTree(window, `Console Scroll ${Date.now()}`)
    await openCollectionRunner(window)

    const consolePanel = window.getByTestId('console-panel')
    await openConsolePanel(window)
    await expect(consolePanel).toBeVisible()

    /*
     * The geometry that WAS the bug: the drawer is absolutely positioned, so it
     * used to overlap the workbench instead of shrinking it. Anything the
     * overlap covered was unreachable — no scroll appeared, because as far as
     * the content area knew it still had the full height.
     *
     * Assert the two boxes do not overlap. That is the property, independent of
     * which control happens to sit at the bottom of the form today.
     */
    const workbench = window.getByTestId('workbench')
    const consoleBox = await consolePanel.boundingBox()
    expect(consoleBox).not.toBeNull()

    // The scrollable region of the runner config — its bottom edge must clear
    // the top of the drawer.
    const formBottom = await window.evaluate(() => {
      const scroller = document.querySelector('[data-testid="console-panel"]')
      const drawerTop = scroller ? scroller.getBoundingClientRect().top : Number.POSITIVE_INFINITY
      // Every element that scrolls its own content, excluding the drawer.
      const panes = Array.from(document.querySelectorAll('div')).filter((el) => {
        const style = getComputedStyle(el)
        const scrolls = style.overflowY === 'auto' || style.overflowY === 'scroll'
        return scrolls && !el.closest('[data-testid="console-panel"]')
      })
      const lowest = panes.reduce((max, el) => Math.max(max, el.getBoundingClientRect().bottom), 0)
      return { lowest, drawerTop }
    })

    // Allow a pixel of rounding slack; the point is that the content area stops
    // AT the drawer rather than running underneath it.
    expect(formBottom.lowest).toBeLessThanOrEqual(formBottom.drawerTop + 1)
    await expect(workbench).toBeVisible()
  })

  uiTest('Send does not fire a request whose pre-request script threw', async ({ window }) => {
    await navigateSidebar(window, 'apis')
    await openHttpRequestTab(window)
    await fillUrl(window, `${localHttpBin()}/get?should-not-happen=1`)
    await addPreScript(window, `throw new Error('boom')`)

    await clickSend(window)

    // The response pane is where the user is looking after pressing Send, so
    // that is where the error has to appear — it used to go to the Console
    // only, while the request went out and came back 200.
    await waitForResponseError(window)
    const pane = window.getByTestId('response-error')
    await expect(pane).toContainText(/Pre-request script error/i)
    await expect(pane).toContainText(/boom/)
    // No status badge: nothing was sent, so there is no response to score.
    await expect(window.getByTestId('response-status')).toHaveCount(0)
  })

  uiTest('a run reports the step that its pre-request script killed', async ({ window }) => {
    await navigateSidebar(window, 'apis')
    await openHttpRequestTab(window)
    await fillUrl(window, `${localHttpBin()}/get?run-script-abort=1`)
    await addPreScript(window, `throw new Error('boom')`)
    const name = `Script Abort ${Date.now()}`
    await saveRequestToTree(window, name)

    await openCollectionRunner(window)
    await selectOnlyRunnerEndpoint(window, name)
    await startRunnerTabRun(window)
    await waitRunnerTabComplete(window)

    // The step is a FAILURE the run can act on — not a pass scored on whatever
    // the server happened to answer, and not a silent skip.
    const summary = await readRunnerTabSummary(window)
    expect(summary.failed).toBe(1)
    expect(summary.passed).toBe(0)

    // The row carries no status — it never reached the wire — so it reads
    // "Error" rather than a green 200.
    const list = window.getByTestId('runner-results-list')
    await expect(list).toContainText(name)
    await expect(list).toContainText('Error')

    // Open the row: the reason has to be readable, not just the fact of failure.
    await list.getByText(name).first().click()
    await expect(window.getByTestId('workbench')).toContainText(/Pre-request script error/i, {
      timeout: 10_000,
    })
  })

  uiTest('Stop and "Skip teardown" are different buttons, not the same click', async ({
    window,
  }) => {
    /*
     * The reported scenario, and the property that actually fixes it.
     *
     * Abandoning cleanup used to be inferred from a second Stop arriving after
     * the teardown phase had begun — the user's INTENT read off the CLOCK. The
     * first Stop cannot cancel the request already on the wire, so people click
     * again, and whichever click landed inside teardown killed the rest of it.
     *
     * What makes that impossible now is that the destructive action is a
     * DIFFERENT, LABELLED button, reachable only while cleanup is visibly
     * running. So this pins the label flip — under the old behaviour the button
     * read "Stop" throughout, and mashing it was enough to lose cleanup.
     *
     * The precise race (a click landing at an exact moment inside teardown) is
     * pinned at the handler level in `runner-lifecycle.test.ts`, where the
     * timing can be driven deterministically instead of raced.
     */
    await navigateSidebar(window, 'apis')
    const stamp = Date.now()
    const slowName = `Slow Main ${stamp}`
    const cleanup1 = `Cleanup A ${stamp}`
    const cleanup2 = `Cleanup B ${stamp}`

    await openHttpRequestTab(window)
    await fillUrl(window, `${localHttpBin()}/delay/2`)
    await saveRequestToTree(window, slowName)

    // A SLOW first cleanup step, so there is a wide window during teardown —
    // exactly the window the old code let a stray click fall into. Wide enough
    // that a loaded CI machine still observes the phase.
    await openHttpRequestTab(window)
    await fillUrl(window, `${localHttpBin()}/delay/5`)
    await saveRequestToTree(window, cleanup1)

    await openHttpRequestTab(window)
    await fillUrl(window, `${localHttpBin()}/get?cleanup=b`)
    await saveRequestToTree(window, cleanup2)

    await openCollectionRunner(window)
    await selectOnlyRunnerEndpoints(window, stamp.toString())
    await window.getByLabel(new RegExp(`: ${cleanup1}$`)).selectOption('teardown')
    await window.getByLabel(new RegExp(`: ${cleanup2}$`)).selectOption('teardown')

    await startRunnerTabRun(window)

    // Press Stop while the slow main request is still on the wire.
    const stop = window.getByTestId('runner-stop')
    await expect(stop).toBeVisible({ timeout: 15_000 })
    await expect(stop).toHaveText('Stop')
    await stop.click()

    /*
     * Once cleanup starts, the same position is a DIFFERENT action and says so.
     * This is the assertion the old behaviour cannot satisfy: it kept saying
     * "Stop" while quietly meaning "abandon cleanup".
     *
     * Do NOT click again here. An earlier version of this test pressed Stop a
     * second time to act out the impatient user — and on CI that click landed
     * on the button this line is about to assert, skipped the cleanup, ended
     * the run and removed the button. The fix had worked; the test had
     * invalidated its own premise. The impatience is what the LABEL protects
     * against, so checking the label is the whole point.
     */
    await expect(stop).toHaveText('Skip teardown', { timeout: 20_000 })

    // We never pressed it, so every cleanup step runs.
    await waitRunnerTabComplete(window)
    const list = window.getByTestId('runner-results-list')
    await expect(list).toContainText(cleanup1)
    await expect(list).toContainText(cleanup2)
    // …and the report does not claim cleanup was skipped when it was not.
    await expect(window.getByTestId('workbench')).not.toContainText(/teardown was skipped/i)
  })

  uiTest('the Delay field says which gap it fills', async ({ window }) => {
    await navigateSidebar(window, 'apis')
    await openHttpRequestTab(window)
    await fillUrl(window, `${localHttpBin()}/get?delay-label=1`)
    await saveRequestToTree(window, `Delay Label ${Date.now()}`)
    await openCollectionRunner(window)

    // A bare "Delay" next to "Iterations" is what made a tester time a run and
    // report per-request delay as a bug. The behaviour matches Postman; the
    // label now says so.
    await expect(window.getByText('Delay between requests')).toBeVisible({ timeout: 15_000 })
  })
})
