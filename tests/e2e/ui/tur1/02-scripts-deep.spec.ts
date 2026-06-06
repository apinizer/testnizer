/**
 * MST-043 — Pre-request script env set + send
 */
import { expect } from '@playwright/test'
import { uiTest } from './_setup'
import { dismissOverlays, navigateSidebar, openHttpRequestTab } from '../../helpers/ui/bootstrap'
import { addPreScript, fillUrl, sendAndWaitResponse } from '../../helpers/ui/request-flow'
import { localHttpBin } from '../../helpers/test-servers'

const http = () => localHttpBin()

uiTest.describe('Tur1 — Scripts deep [MST-043]', () => {
  uiTest.beforeEach(async ({ window }) => {
    await dismissOverlays(window)
    await navigateSidebar(window, 'apis')
  })

  uiTest('MST-043 pre-request script sets env var consumed in URL', async ({ window }) => {
    const marker = `pre-${Math.random().toString(36).slice(2, 8)}`
    await openHttpRequestTab(window)
    await addPreScript(
      window,
      `pm.environment.set('dynPath', '/get?marker=${marker}')`,
    )
    await fillUrl(window, `${http()}{{dynPath}}`)
    await sendAndWaitResponse(window)
    await window.getByTestId('res-tab-body').click()
    await expect(window.getByTestId('res-body-content').getByText(new RegExp(marker)).first()).toBeVisible({
      timeout: 10_000,
    })
  })
})
