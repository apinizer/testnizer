/**
 * QUERY, end to end.
 *
 * QUERY is the safe, idempotent HTTP method that carries a request BODY — the
 * standardised answer to "GET with a body, or POST?" for read operations whose
 * parameters do not fit in a URL.
 *
 * Listing it in a dropdown proves nothing; what matters is that the method AND
 * the body reach the server. Nothing in the send path decides whether to
 * include a body by looking at the method, so this is really a test that
 * nothing along the way quietly normalises an unfamiliar method back to GET.
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
import { fillUrl, setHttpMethod, sendAndWaitResponse, setBodyType } from '../helpers/ui/request-flow'
import { localHttpBin } from '../helpers/test-servers'

const http = () => localHttpBin()

uiTest.describe('HTTP QUERY method', () => {
  uiTest.beforeEach(async ({ window }) => {
    await dismissOverlays(window)
    await ensureCanonicalProject(window)
    await navigateSidebar(window, 'apis')
    await closeAllTabs(window)
  })

  uiTest.afterEach(async ({ window }) => {
    await closeAllTabs(window)
  })

  uiTest('is selectable and reaches the server with its body', async ({ window }) => {
    await openHttpRequestTab(window)
    await setHttpMethod(window, 'QUERY')
    await fillUrl(window, `${http()}/echo-method`)

    // The whole point of QUERY: a read request that carries a body.
    await setBodyType(window, 'json', '{"filter":{"status":"active"}}')

    await sendAndWaitResponse(window)
    await window.getByTestId('res-tab-body').click()

    const body = window.getByTestId('workbench')
    // The method arrived as QUERY — not normalised to GET or POST…
    await expect(body).toContainText('"method": "QUERY"', { timeout: 10_000 })
    // …and the body came with it.
    await expect(body).toContainText('active')
  })

  uiTest('shows a QUERY badge distinct from GET', async ({ window }) => {
    await openHttpRequestTab(window)
    await setHttpMethod(window, 'QUERY')

    await expect(window.getByTestId('url-method')).toContainText('QUERY')
  })
})
