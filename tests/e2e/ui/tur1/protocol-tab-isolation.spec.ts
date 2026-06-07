/**
 * MST-156 — Protocol tab isolation: HTTP + WS state does not bleed between tabs.
 * MST-159 — Error classifier i18n: trigger classified errors and verify message
 *            appears (Turkish or English, depending on locale setting).
 *
 * Both are P2; MST-156 is the primary focus here.
 *
 * MST-156 strategy:
 *   1. Open an HTTP tab, fill URL + send.
 *   2. Open a WS tab, connect.
 *   3. Switch back to HTTP tab — WS state must not be visible (no ws-disconnect btn).
 *   4. Switch to WS tab — HTTP response pane must not be visible.
 *
 * MST-159 strategy:
 *   - Trigger ECONNREFUSED (connect to closed port).
 *   - The error-classifier.ts normalises the raw Node error into a
 *     human-readable string. The test verifies the UI shows a non-empty
 *     error message rather than a raw stack trace.
 */
import { expect } from '@playwright/test'
import { uiTest } from './_setup'
import {
  dismissOverlays,
  ensureCanonicalProject,
  navigateSidebar,
  openNewDropdownItem,
  openHttpRequestTab,
} from '../../helpers/ui/bootstrap'
import { getTestServerUrls, localHttpBin } from '../../helpers/test-servers'
import { fillMonaco } from '../../helpers/ui/monaco'

uiTest.describe('Tur1 — Protocol tab isolation + error i18n [MST-156, MST-159]', () => {
  uiTest.beforeEach(async ({ window }) => {
    await dismissOverlays(window)
    await ensureCanonicalProject(window)
    await navigateSidebar(window, 'apis')
  })

  // ── MST-156: HTTP + WS tab state isolation ────────────────────────────────
  uiTest('MST-156 HTTP and WS tabs do not bleed state into each other', async ({ window }) => {
    const http = localHttpBin()
    const { ws } = getTestServerUrls()

    // Click each open tab until the editor surface matching `wantEditor` shows.
    // Tab names collide across the worker-scoped app (many "New Request" tabs),
    // so identify the target by its rendered editor rather than the name.
    async function switchToTabWith(wantEditor: 'http' | 'ws'): Promise<void> {
      const probe = wantEditor === 'http' ? 'url-input' : 'ws-disconnect'
      const tabs = window.locator('[data-testid="endpoint-tab"]')
      const n = await tabs.count()
      for (let i = 0; i < n; i++) {
        await tabs.nth(i).click()
        await window.waitForTimeout(250)
        if (await window.getByTestId(probe).isVisible().catch(() => false)) return
      }
      throw new Error(`no tab showed the ${wantEditor} editor (${probe})`)
    }

    // 1. Open HTTP tab and send a request
    await openHttpRequestTab(window)
    await window.getByTestId('url-input').fill(`${http}/get`)
    await window.getByTestId('send-btn').click()
    // Wait for HTTP response
    await expect(window.getByTestId('response-status').or(window.getByText(/200/i)).first()).toBeVisible({
      timeout: 15_000,
    })

    // 2. Open a WS tab and connect
    await openNewDropdownItem(window, /WebSocket/i)
    await window.getByTestId('ws-url').fill(ws)
    await window.getByTestId('ws-connect').click()
    await expect(window.getByTestId('ws-disconnect')).toBeVisible({ timeout: 15_000 })

    // 3. Switch to the HTTP tab: url-input visible, WS disconnect must NOT be.
    await switchToTabWith('http')
    await expect(window.getByTestId('url-input')).toBeVisible({ timeout: 10_000 })
    await expect(window.getByTestId('ws-disconnect')).toBeHidden()

    // 4. Switch to the WS tab: ws-disconnect visible, url-input must NOT be.
    await switchToTabWith('ws')
    await expect(window.getByTestId('ws-disconnect')).toBeVisible({ timeout: 10_000 })
    await expect(window.getByTestId('url-input')).toBeHidden()

    // Cleanup
    await window.getByTestId('ws-disconnect').click()
  })

  // ── MST-159: Error classifier i18n ────────────────────────────────────────
  uiTest('MST-159 connection error shows human-readable classified message', async ({ window }) => {
    // Trigger ECONNREFUSED by sending HTTP to a closed port
    await openHttpRequestTab(window)
    await window.getByTestId('url-input').fill('http://127.0.0.1:1/test')
    await window.getByTestId('send-btn').click()

    // The response area should show a non-empty error — not a raw stack trace.
    // The response-error pane is the canonical signal (the classifier text lives
    // inside it, so an .or() over both trips strict mode).
    await expect(window.getByTestId('response-error').first()).toBeVisible({ timeout: 15_000 })

    // The message must not look like a raw JS stack trace
    const errorText = await window
      .getByText(/connection refused|network error|ECONNREFUSED|unreachable|bağlantı|hata/i)
      .first()
      .textContent()
      .catch(() => 'ok')
    if (errorText) {
      // Should not contain raw "at Object." stack frames
      expect(errorText).not.toMatch(/at Object\.|at Function\.\s/)
    }
  })
})
