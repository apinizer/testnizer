/**
 * MST-183, MST-184 — History restore + search
 */
import { expect } from '@playwright/test'
import { uiTest } from './_setup'
import { dismissOverlays, navigateSidebar, openHttpRequestTab } from '../../helpers/ui/bootstrap'
import { fillUrl, sendAndWaitResponse } from '../../helpers/ui/request-flow'
import { localHttpBin } from '../../helpers/test-servers'

const http = () => localHttpBin()
const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`

uiTest.describe('Tur1 — History advanced [MST-183, MST-184]', () => {
  uiTest.beforeEach(async ({ window }) => {
    await dismissOverlays(window)
    await navigateSidebar(window, 'apis')
  })

  uiTest('MST-184 history search filters by URL fragment after send', async ({ window }) => {
    const marker = `histsearch-${uid()}`
    await openHttpRequestTab(window)
    await fillUrl(window, `${http()}/get?${marker}=1`)
    await sendAndWaitResponse(window)
    await navigateSidebar(window, 'history')
    await window.getByPlaceholder('Filter history...').fill(marker)
    await expect(window.getByTestId('history-entry').first()).toBeVisible({ timeout: 15_000 })
    await expect(window.getByTestId('history-entry')).toHaveCount(1, { timeout: 5_000 })
  })

  uiTest('MST-183 send populates history row visible in list', async ({ window }) => {
    const marker = `restore-${uid()}`
    await openHttpRequestTab(window)
    await fillUrl(window, `${http()}/get?${marker}=1`)
    await sendAndWaitResponse(window)
    await navigateSidebar(window, 'history')
    await window.getByPlaceholder('Filter history...').fill(marker)
    await expect(window.getByTestId('history-entry').first()).toBeVisible({ timeout: 15_000 })
  })
})
