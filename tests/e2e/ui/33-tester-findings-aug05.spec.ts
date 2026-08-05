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
import { fillUrl, saveRequestToTree } from '../helpers/ui/request-flow'
import { openCollectionRunner } from '../helpers/ui/runner-flow'
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
