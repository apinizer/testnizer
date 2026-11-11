/**
 * Tester findings 8 and 9 (1.6.0): the Headers autocomplete took over Tab.
 *
 *  8. Typing `Authorization` in an empty key and pressing Tab left
 *     `Proxy-Authorization` in the box, the caret still in the key cell, and the
 *     request went out with the wrong header.
 *  9. Tabbing through the empty value of a `Content-Type` row filled in
 *     `application/json`, which nobody typed.
 *
 * Rule (VS Code / Postman): the suggestion list opens with nothing selected;
 * Tab / Enter accept a suggestion only after an arrow-key pick. With no pick,
 * Tab keeps the text and moves focus on. The unit side is
 * tests/renderer/header-autocomplete-tab.test.tsx; this spec proves the real
 * keyboard focus movement and what reaches the wire (the echo server's
 * `/headers` returns the request headers it received).
 */
import { expect, type Locator, type Page } from '@playwright/test'
import { uiTest } from './_setup'
import {
  closeAllTabs,
  dismissOverlays,
  ensureCanonicalProject,
  navigateSidebar,
  openHttpRequestTab,
} from '../helpers/ui/bootstrap'
import { fillUrl } from '../helpers/ui/request-flow'
import { sendAndReadBody } from '../helpers/ui/http-extra'
import { localHttpBin } from '../helpers/test-servers'

const shot = (page: Page, step: string) =>
  page.screenshot({ path: `test-results/screens/68-${step}.png` })

/** The last header row, adding one when the table has none or the last is used. */
async function emptyHeaderRow(page: Page): Promise<Locator> {
  const rows = page.locator('[data-testid^="kv-row-"]')
  const count = await rows.count()
  const last = count > 0 ? rows.nth(count - 1) : null
  if (last && (await last.getByTestId('kv-key').inputValue()) === '') return last
  await page.getByTestId('kv-add-row').click()
  return rows.nth(count)
}

uiTest.describe('Headers autocomplete — Tab keeps what was typed (findings 8, 9)', () => {
  uiTest.beforeEach(async ({ window }) => {
    await dismissOverlays(window)
    await ensureCanonicalProject(window)
    await navigateSidebar(window, 'apis')
    await closeAllTabs(window)
  })

  uiTest(
    'Authorization + Tab stays, empty Content-Type value stays empty, the wire agrees',
    async ({ window }) => {
      const token = `e2e68-${Date.now().toString(36)}`
      await openHttpRequestTab(window)
      await fillUrl(window, `${localHttpBin()}/headers`)
      await window.getByTestId('req-tab-headers').click()

      // ── Finding 8 ──────────────────────────────────────────────────────────
      const authRow = await emptyHeaderRow(window)
      const authKey = authRow.getByTestId('kv-key')
      const authValue = authRow.getByTestId('kv-value').locator('input')
      await authKey.click()
      await authKey.pressSequentially('Authorization')
      // The list is open: `Proxy-Authorization` contains what was typed.
      await expect(window.getByTestId('kv-autocomplete')).toBeVisible()
      await window.keyboard.press('Tab')
      await shot(window, '1-authorization-after-tab')

      await expect(authKey).toHaveValue('Authorization')
      await expect(authValue).toBeFocused()

      // The value cell of Authorization offers `Bearer ` / `Basic ` on focus;
      // typing over it keeps the typed text.
      await authValue.pressSequentially(`Bearer ${token}`)
      await window.keyboard.press('Tab')
      await expect(authValue).toHaveValue(`Bearer ${token}`)
      await expect(authKey).toHaveValue('Authorization')

      // ── Finding 9 ──────────────────────────────────────────────────────────
      const ctRow = await emptyHeaderRow(window)
      const ctKey = ctRow.getByTestId('kv-key')
      const ctValue = ctRow.getByTestId('kv-value').locator('input')
      await ctKey.click()
      await ctKey.pressSequentially('Content-Type')
      // optional: the key list may or may not be open for an exact name; the tester pressed Escape
      if (
        await window
          .getByTestId('kv-autocomplete')
          .isVisible()
          .catch(() => false)
      ) {
        await window.keyboard.press('Escape')
      }
      await window.keyboard.press('Tab')
      await expect(ctValue).toBeFocused()
      // Focusing the empty value opens the Content-Type value list — the repro.
      await expect(window.getByTestId('kv-autocomplete')).toBeVisible()
      await shot(window, '2-content-type-value-list')

      await window.keyboard.press('Tab')
      await shot(window, '3-content-type-after-second-tab')
      await expect(ctValue).toHaveValue('')
      await expect(ctRow.getByTestId('kv-description')).toBeFocused()
      await expect(window.getByTestId('kv-autocomplete')).toBeHidden()
      await expect(ctKey).toHaveValue('Content-Type')

      // ── What reaches the wire ──────────────────────────────────────────────
      const { status, body } = await sendAndReadBody(window)
      expect(status).toBe(200)
      // `sendAndReadBody` returns '' when the body pane cannot be read.
      expect(body.trim().length).toBeGreaterThan(0)
      const text = body.replace(/\u00a0/g, ' ')
      expect(text).toMatch(new RegExp(`"authorization"\\s*:\\s*"Bearer ${token}"`, 'i'))
      expect(text.toLowerCase()).not.toContain('proxy-authorization')
      expect(text).not.toMatch(/"content-type":\s*"application\/json"/i)
    },
  )

  uiTest('an arrow-key pick is still accepted with Tab and with Enter', async ({ window }) => {
    await openHttpRequestTab(window)
    await window.getByTestId('req-tab-headers').click()

    const row = await emptyHeaderRow(window)
    const key = row.getByTestId('kv-key')
    await key.click()
    await key.pressSequentially('Authorization')
    await window.keyboard.press('ArrowDown')
    await window.keyboard.press('Tab')
    await expect(key).toHaveValue('Proxy-Authorization')
    await expect(key).toBeFocused()

    await key.fill('')
    await key.pressSequentially('Content-Ty')
    await window.keyboard.press('ArrowDown')
    await window.keyboard.press('Enter')
    await expect(key).toHaveValue('Content-Type')
    await shot(window, '4-arrow-pick-accepted')
  })
})
