/**
 * A request in flight belongs to ONE tab (issue #76).
 *
 * `response` and `isLoading` were single values for the whole window, so a slow
 * request in tab A turned tab B's Send button into a red **Cancel** — and
 * pressing it aborted A's request — while B's pane showed A's spinner and then
 * A's response.
 *
 * The store test drives that at the state level. This drives it the way the
 * tester hit it: two real tabs, a genuinely slow endpoint, and the buttons the
 * user actually clicks.
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
import { fillUrl } from '../helpers/ui/request-flow'
import { localHttpBin } from '../helpers/test-servers'

const http = () => localHttpBin()

/** The Send button's own label tells us which state the ACTIVE tab is in. */
async function sendButtonIsCancel(window: import('@playwright/test').Page) {
  const title = await window.getByTestId('send-btn').getAttribute('title')
  return (title ?? '').toLowerCase().includes('cancel')
}

uiTest.describe('request state is per tab (issue #76)', () => {
  uiTest.beforeEach(async ({ window }) => {
    await dismissOverlays(window)
    await ensureCanonicalProject(window)
    await navigateSidebar(window, 'apis')
    await closeAllTabs(window)
  })

  uiTest('a slow request in one tab leaves the other tab idle', async ({ window }) => {
    // Tab A — a request that takes long enough to still be running when we look
    // at the second tab.
    await openHttpRequestTab(window)
    await fillUrl(window, `${http()}/delay/3`)
    await window.getByTestId('send-btn').click()

    // It really is in flight: A's own button offers to cancel.
    await expect
      .poll(() => sendButtonIsCancel(window), { timeout: 5_000 })
      .toBe(true)

    // Tab B — opened while A is still waiting.
    await openHttpRequestTab(window)
    await fillUrl(window, `${http()}/get`)

    // The bug: B's button read Cancel, and clicking it aborted A's request.
    expect(await sendButtonIsCancel(window)).toBe(false)
    // …and B showed A's spinner.
    await expect(window.getByTestId('response-loading')).toHaveCount(0)

    await closeAllTabs(window)
  })

  uiTest("a response lands in the tab that asked for it", async ({ window }) => {
    // A: slow. B: fast, sent second but answered first.
    await openHttpRequestTab(window)
    await fillUrl(window, `${http()}/delay/2`)
    await window.getByTestId('send-btn').click()
    await expect.poll(() => sendButtonIsCancel(window), { timeout: 5_000 }).toBe(true)

    await openHttpRequestTab(window)
    await fillUrl(window, `${http()}/status/418`)
    await window.getByTestId('send-btn').click()

    // B settles on its own answer while A is still running.
    await expect(window.getByTestId('response-status')).toContainText('418', { timeout: 15_000 })

    // A's response arrives later; it must not repaint the tab the user is on.
    await window.waitForTimeout(3_000)
    await expect(window.getByTestId('response-status')).toContainText('418')

    await closeAllTabs(window)
  })
})
