/**
 * MST-038, MST-039 — Response toolbar + Actual Request
 */
import { expect } from '@playwright/test'
import { uiTest } from './_setup'
import { dismissOverlays, ensureCanonicalProject, navigateSidebar, openHttpRequestTab } from '../../helpers/ui/bootstrap'
import { fillUrl, sendAndWaitResponse } from '../../helpers/ui/request-flow'
import { expectCopyToClipboard } from '../../helpers/ui/clipboard'
import { localHttpBin } from '../../helpers/test-servers'

const http = () => localHttpBin()

uiTest.describe('Tur1 — Response toolbar [MST-038, MST-039]', () => {
  uiTest.beforeEach(async ({ window }) => {
    await dismissOverlays(window)
    await ensureCanonicalProject(window)
    await navigateSidebar(window, 'apis')
  })

  uiTest('MST-038 pretty/raw toggle and copy work on response body', async ({ window, app }) => {
    const marker = `TB${Math.random().toString(36).slice(2, 6)}`
    await openHttpRequestTab(window)
    await fillUrl(window, `${http()}/get?tb=${marker}`)
    await sendAndWaitResponse(window)
    await window.getByTestId('res-tab-body').click()
    const body = window.getByTestId('res-body-content')
    await window.getByTestId('res-body-raw').click()
    await expect(body.getByText(new RegExp(marker)).first()).toBeVisible()
    await window.getByTestId('res-body-preview').click()
    await expect(body.getByText(new RegExp(marker)).first()).toBeVisible()
    // System clipboard is shared OS-wide → serialise across parallel workers.
    await expectCopyToClipboard(window, app, 'res-body-copy', marker)
  })

  uiTest('MST-039 response body contains echoed query after send', async ({ window }) => {
    await openHttpRequestTab(window)
    await fillUrl(window, `${http()}/get?actual=1`)
    await sendAndWaitResponse(window)
    await window.getByTestId('res-tab-body').click()
    await expect(window.getByTestId('res-body-content').getByText(/actual/i).first()).toBeVisible({
      timeout: 10_000,
    })
  })
})
