/**
 * MST-028 — Quick Request flow
 */
import { expect } from '@playwright/test'
import { uiTest } from './_setup'
import { dismissOverlays, navigateSidebar } from '../../helpers/ui/bootstrap'
import { fillUrl, sendAndWaitResponse } from '../../helpers/ui/request-flow'
import { localHttpBin } from '../../helpers/test-servers'

const http = () => localHttpBin()

uiTest.describe('Tur1 — Quick Request [MST-028]', () => {
  uiTest.beforeEach(async ({ window }) => {
    await dismissOverlays(window)
    await navigateSidebar(window, 'apis')
  })

  uiTest('MST-028 Quick Request sends without persisting to tree', async ({ window }) => {
    const before = await window.getByTestId('tree-node').count()
    await window.getByTestId('new-dropdown-btn').click()
    await window.getByTestId('new-dropdown-menu').getByText(/Quick Request/i).click()
    await expect(window.getByTestId('url-input')).toBeVisible({ timeout: 8_000 })
    await fillUrl(window, `${http()}/get?quick=1`)
    await sendAndWaitResponse(window)
    // Unsaved quick tab — tree count unchanged.
    await expect(window.getByTestId('tree-node')).toHaveCount(before)
  })
})
