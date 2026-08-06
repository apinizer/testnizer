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
     * What makes that impossible now is POSITION, not timing: the safe button
     * is graceful for the whole run and the destructive one is a separate,
     * labelled button beside it (issue #91). So this acts out the impatient
     * user for real — Stop, repeatedly, straight through the teardown phase —
     * and requires every cleanup step to survive it.
     *
     * An intermediate version renamed the SAFE button to "Skip teardown" once
     * cleanup began. That reintroduced the bug as geometry, and this test
     * caught it on CI three times in a row: a click retry waiting for the
     * re-enabled button landed on the rename and lost the cleanup.
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
    const direct = window.getByTestId('runner-stop-direct')
    await expect(stop).toBeVisible({ timeout: 15_000 })
    await expect(stop).toHaveText('Stop')
    await stop.click()

    /*
     * Wait for cleanup to be visibly running rather than guessing when it
     * starts. Abandoning cleanup lives on the OTHER button, and only renames
     * itself once there is cleanup to abandon.
     */
    await expect(direct).toHaveText('Skip teardown', { timeout: 20_000 })

    /*
     * THE assertion. Two things must hold at this instant, and between them no
     * amount of clicking the left button can lose the cleanup:
     *
     *   - it has not become the destructive action (the rename lives on the
     *     right button), and
     *   - it is inert, because the flow it ends is already over.
     *
     * Removing either one reopens issue #84: the first lets a stray click mean
     * "abandon cleanup", the second lets a click retry wait for the button to
     * re-enable and then press it.
     */
    await expect(stop).not.toHaveText('Skip teardown')
    await expect(stop).toBeDisabled()

    // The impatient user, for real: forced clicks straight at the safe button,
    // inside the teardown phase, where the old bug lived. The first cleanup
    // step is `/delay/5`, so there is room.
    for (let i = 0; i < 5; i++) {
      await stop.click({ force: true }).catch(() => {})
    }

    // Every cleanup step still runs, despite six presses of Stop straddling the
    // phase boundary.
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
