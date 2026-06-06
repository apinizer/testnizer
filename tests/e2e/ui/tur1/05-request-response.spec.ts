/**
 * MST-030 — Request cancel in-flight
 */
import { uiTest } from './_setup'
import { dismissOverlays, navigateSidebar, openHttpRequestTab } from '../../helpers/ui/bootstrap'
import { cancelInFlightRequest, fillUrl, waitForResponseError } from '../../helpers/ui/request-flow'
import { localHttpBin } from '../../helpers/test-servers'

const http = () => localHttpBin()

uiTest.describe('Tur1 — Request / Response [MST-030]', () => {
  uiTest.beforeEach(async ({ window }) => {
    await dismissOverlays(window)
    await navigateSidebar(window, 'apis')
  })

  uiTest('MST-030 cancel aborts a slow in-flight request', async ({ window }) => {
    await openHttpRequestTab(window)
    await fillUrl(window, `${http()}/delay/5`)
    await window.getByTestId('send-btn').click()
    await cancelInFlightRequest(window)
    await waitForResponseError(window)
  })
})
