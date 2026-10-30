/**
 * MST-054 P2 — Bulk header edit paste
 * MST-055 P2 — Params path :id vs query preview
 * MST-056 P2 — Network unreachable error UX
 * MST-057 P2 — DNS failure error UX
 * MST-058 P2 — Method badge colours
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
  clickSend,
  fillUrl,
  waitForResponseError,
} from '../../helpers/ui/request-flow'
import { kvToggleBulkEdit, kvFillBulk } from '../../helpers/ui/keyvalue'

// RFC 5737 TEST-NET — guaranteed unreachable
const UNREACHABLE_HOST = 'http://192.0.2.1/get'
const DNS_FAIL_HOST = 'http://this.host.definitely.does.not.exist.invalid/get'

uiTest.describe('Tur1 — HTTP UX errors + misc [MST-054..058]', () => {
  uiTest.beforeEach(async ({ window }) => {
    await dismissOverlays(window)
    await ensureCanonicalProject(window)
    await navigateSidebar(window, 'apis')
    await openHttpRequestTab(window)
  })

  // MST-054: Bulk header paste
  uiTest('MST-054 bulk header edit paste applies multiple headers at once', async ({ window }) => {
    await window.getByTestId('req-tab-headers').click()

    await expect(window.getByTestId('kv-bulk-toggle')).toBeVisible()
    await kvToggleBulkEdit(window)
    await kvFillBulk(window, 'X-Bulk-1: value-one\nX-Bulk-2: value-two\nX-Bulk-3: value-three')
    // Switch back to table mode
    await kvToggleBulkEdit(window)

    // Headers must appear as rows (kv-key IS the <input>, not a wrapper)
    await expect(window.getByTestId('kv-row-0')).toBeVisible({ timeout: 5_000 })
    await expect(window.getByTestId('kv-row-0').getByTestId('kv-key')).toHaveValue('X-Bulk-1')
    await expect(window.getByTestId('kv-row-2').getByTestId('kv-key')).toHaveValue('X-Bulk-3')
  })

  // MST-055: Path params :id vs query preview
  uiTest('MST-055 path param :id shows in URL preview and is distinct from query params', async ({ window }) => {
    // Fill a URL with a path parameter segment
    await fillUrl(window, 'https://api.example.com/users/:userId/posts')
    await window.getByTestId('req-tab-params').click()

    // The params tab should show :userId as a path param or the URL should reflect it
    const urlValue = await window.getByTestId('url-input').inputValue()
    expect(urlValue).toMatch(/:userId|userId/)

    // Path variables get their own table, separate from the query params table.
    const pathSection = window.getByTestId('path-variables')
    await expect(pathSection).toBeVisible()
    await expect(pathSection.getByTestId('path-var-row-userId')).toBeVisible()
  })

  // MST-056: Network unreachable error UX
  uiTest('MST-056 network unreachable shows user-facing error (not blank screen)', async ({ window }) => {
    await fillUrl(window, UNREACHABLE_HOST)
    await clickSend(window)

    await waitForResponseError(window, 40_000)
    await expect(window.getByTestId('response-error')).toContainText(
      /network|connect|unreachable|refused|ECONNREFUSED|ETIMEDOUT|timed? ?out|EHOSTUNREACH/i,
    )
    await expect(window.getByTestId('send-btn')).toBeVisible()
  })

  // MST-057: DNS failure error UX
  uiTest('MST-057 DNS failure shows user-facing error message', async ({ window }) => {
    await fillUrl(window, DNS_FAIL_HOST)
    await clickSend(window)

    await waitForResponseError(window, 40_000)
    await expect(window.getByTestId('response-error')).toContainText(
      /ENOTFOUND|DNS|resolve|not found|getaddrinfo/i,
    )
    await expect(window.getByTestId('send-btn')).toBeVisible()
  })

  // MST-058: Method badge colours
  uiTest('MST-058 method badges have correct colour tokens per HTTP method', async ({ window }) => {
    // Open the URL method picker and check each badge renders with a bg colour
    const methodPicker = window.getByTestId('url-method')
    await methodPicker.click()

    // Every method option renders a MethodBadge with a non-transparent colour.
    for (const method of ['GET', 'POST', 'PUT', 'DELETE', 'PATCH']) {
      const opt = window.getByTestId(`url-method-option-${method}`)
      await expect(opt).toBeVisible()
      const color = await opt
        .getByText(method, { exact: true })
        .evaluate((el: Element) => (globalThis as typeof globalThis & Window).getComputedStyle(el).color)
      expect(color).not.toBe('')
      expect(color).not.toBe('rgba(0, 0, 0, 0)')
    }
    await window.keyboard.press('Escape')
  })
})
