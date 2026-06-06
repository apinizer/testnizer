/**
 * MST-041 — Request timeout finite vs inherit vs 0 (no timeout)
 */
import { expect } from '@playwright/test'
import { uiTest } from './_setup'
import { dismissOverlays, navigateSidebar, openHttpRequestTab } from '../../helpers/ui/bootstrap'
import { clickSend, fillUrl, waitForResponseError, waitForResponseStatus } from '../../helpers/ui/request-flow'
import { localHttpBin } from '../../helpers/test-servers'

const http = () => localHttpBin()

uiTest.describe('Tur1 — HTTP timeout [MST-041]', () => {
  uiTest.beforeEach(async ({ window }) => {
    await dismissOverlays(window)
    await navigateSidebar(window, 'apis')
    await openHttpRequestTab(window)
  })

  uiTest('MST-041 finite timeout aborts slow requests; inherit uses general default', async ({ window }) => {
    await window.getByTestId('req-tab-settings').click()
    const timeoutInput = window.getByTestId('settings-timeout')

    // Explicit 500ms timeout → /delay/3 must fail.
    await timeoutInput.fill('500')
    await fillUrl(window, `${http()}/delay/3`)
    await clickSend(window)
    await waitForResponseError(window, 15_000)

    // Empty = inherit general timeout (30s default) — short delay succeeds.
    await timeoutInput.fill('')
    await fillUrl(window, `${http()}/delay/1`)
    await clickSend(window)
    expect(await waitForResponseStatus(window, 20_000)).toBe(200)
  })
})
