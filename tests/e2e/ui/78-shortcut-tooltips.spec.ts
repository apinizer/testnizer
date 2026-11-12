/**
 * The protocol action buttons name the Ctrl/Cmd+Enter chord in their tooltip
 * (`title`) — only in a state where the chord (`run-active-request.ts`) does
 * what a click does. HTTP Send says "Send (⌘Enter)" while idle and plain
 * "Cancel" while a request runs (the chord never cancels). WebSocket Connect
 * says "Connect (⌘Enter)" while disconnected, and the composer's Send names it
 * only once connected — before that the chord connects instead.
 *
 * The tooltip is the native `title`, so the assertions read the attribute;
 * the screenshots record the hovered button (Chromium does not paint native
 * tooltips into a page screenshot).
 *
 * Local servers only (HTTP echo, ws-echo). Cleanup: the WebSocket is
 * disconnected in `finally`, tabs are closed.
 */
import { expect } from '@playwright/test'
import { uiTest } from './_setup'
import {
  closeAllTabs,
  dismissOverlays,
  ensureCanonicalProject,
  expectNoErrorBoundary,
  navigateSidebar,
  openHttpRequestTab,
  openNewDropdownItem,
} from '../helpers/ui/bootstrap'
import { fillUrl } from '../helpers/ui/request-flow'
import { fillMonaco } from '../helpers/ui/monaco'
import { getTestServerUrls, localHttpBin } from '../helpers/test-servers'

const SHOTS = 'test-results/screens'
/** `formatShortcut(['Mod', 'Enter'])` on the host the Electron app runs on. */
const CHORD = process.platform === 'darwin' ? '⌘Enter' : 'Ctrl+Enter'

uiTest.describe('action buttons name the Ctrl/Cmd+Enter chord', () => {
  uiTest.beforeEach(async ({ window }) => {
    await dismissOverlays(window)
    await ensureCanonicalProject(window)
    await navigateSidebar(window, 'apis')
    await closeAllTabs(window)
  })

  uiTest.afterEach(async ({ window }) => {
    await closeAllTabs(window).catch(() => {})
  })

  uiTest('HTTP Send: the chord while idle, not as Cancel', async ({ window }) => {
    await openHttpRequestTab(window)
    await fillUrl(window, `${localHttpBin()}/delay/2`)
    const send = window.getByTestId('send-btn')
    await send.hover()
    await expect(send).toHaveAttribute('title', `Send (${CHORD})`)
    await window.screenshot({ path: `${SHOTS}/78-http-send-tooltip.png` })

    // In flight the button is Cancel and the chord would send, not cancel.
    await send.click()
    await expect(send).toHaveAttribute('title', 'Cancel', { timeout: 5_000 })
    await expect(window.getByTestId('response-status')).toContainText('200', { timeout: 30_000 })
    await expect(send).toHaveAttribute('title', `Send (${CHORD})`)
    await expectNoErrorBoundary(window)
  })

  uiTest('WebSocket: Connect names the chord, then Send once connected', async ({ window }) => {
    const { ws } = getTestServerUrls()
    await openNewDropdownItem(window, /WebSocket/i)
    await window.getByTestId('ws-url').fill(ws)
    const connect = window.getByTestId('ws-connect')
    await connect.hover()
    await expect(connect).toHaveAttribute('title', `Connect (${CHORD})`)
    // Disconnected: the chord connects, so the composer's Send does not claim it.
    const sendBefore = window.getByTestId('ws-send')
    await expect(sendBefore).toBeVisible()
    await expect(sendBefore).toBeDisabled()
    await expect(sendBefore).not.toHaveAttribute('title', /Enter/)
    await window.screenshot({ path: `${SHOTS}/78-ws-connect-tooltip.png` })

    try {
      await connect.click()
      const disconnect = window.getByTestId('ws-disconnect')
      await expect(disconnect).toBeVisible({ timeout: 15_000 })
      await expect(disconnect).not.toHaveAttribute('title', /Enter/)

      await fillMonaco(window, 'ws-composer', '{"probe":"tooltip"}')
      const sendMessage = window.getByTestId('ws-send')
      await sendMessage.hover()
      await expect(sendMessage).toHaveAttribute('title', `Send Message (${CHORD})`)
      await window.screenshot({ path: `${SHOTS}/78-ws-send-tooltip.png` })
    } finally {
      await window
        .getByTestId('ws-disconnect')
        .click({ timeout: 2_000 })
        .catch(() => {})
    }
    await expectNoErrorBoundary(window)
  })

  uiTest('GraphQL Run names the chord', async ({ window }) => {
    const { graphql } = getTestServerUrls()
    await openNewDropdownItem(window, /GraphQL/i)
    await window.getByTestId('graphql-url').fill(graphql)
    const run = window.getByTestId('graphql-run')
    await run.hover()
    await expect(run).toHaveAttribute('title', `Run (${CHORD})`)
    await expectNoErrorBoundary(window)
  })
})
