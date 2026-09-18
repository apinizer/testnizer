/**
 * Issue #125 — "Save response": pin the current response to a saved request,
 * see it under the Saved tab, reopen the request, Open / Delete it.
 */
import { expect } from '@playwright/test'
import { uiTest } from './_setup'
import {
  closeAllTabs,
  dismissOverlays,
  ensureCanonicalProject,
  navigateSidebar,
  openHttpRequestTab,
} from '../../helpers/ui/bootstrap'
import { fillUrl, saveRequestToTree, sendAndWaitResponse } from '../../helpers/ui/request-flow'
import { treeClearSearch, treeOpenNode } from '../../helpers/ui/tree'
import { localHttpBin } from '../../helpers/test-servers'

const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`

uiTest.describe('Tur1 — Save response [issue #125]', () => {
  uiTest('save → Saved tab → reopen → Open → Delete', async ({ window }) => {
    await dismissOverlays(window)
    await ensureCanonicalProject(window)
    await closeAllTabs(window)
    const name = `saved-resp-${uid()}`

    await navigateSidebar(window, 'apis')
    await openHttpRequestTab(window)
    await fillUrl(window, `${localHttpBin()}/get?x=1`)
    await sendAndWaitResponse(window)

    // Scratch tab: the button explains instead of opening the name prompt.
    await window.getByTestId('response-save-btn').click()
    await expect(window.getByTestId('response-save-popover')).toHaveCount(0)

    await saveRequestToTree(window, name)

    await window.getByTestId('response-save-btn').click()
    const pop = window.getByTestId('response-save-popover')
    await expect(pop).toBeVisible()
    await pop.locator('input').fill('200 sample')
    await pop.locator('input').press('Enter')
    await expect(pop).toBeHidden({ timeout: 10_000 })

    await expect(window.getByTestId('res-tab-saved')).toContainText('1')
    await expect(window.getByTestId('saved-response-row')).toHaveCount(1)
    await expect(window.getByTestId('saved-response-row')).toContainText('200 sample')

    // Reopen from the tree: no response yet → saved-only panel lists it.
    await closeAllTabs(window)
    await treeOpenNode(window, name)
    try {
      await expect(window.getByTestId('response-saved-only')).toBeVisible({ timeout: 10_000 })
      await expect(window.getByTestId('saved-response-row')).toHaveCount(1)
      await window
        .getByTestId('saved-response-row')
        .getByRole('button', { name: /^(Open|Aç)$/ })
        .click()
      await expect(window.getByTestId('res-tab-body')).toBeVisible({ timeout: 10_000 })
      await expect(window.getByTestId('response-status')).toContainText('200')

      // Delete with confirm.
      await window.getByTestId('res-tab-saved').click()
      await window
        .getByTestId('saved-response-row')
        .getByTitle(/Delete saved response|Kayıtlı yanıtı sil/)
        .click()
      await window.getByTestId('delete-confirm-btn').click()
      await expect(window.getByTestId('saved-response-row')).toHaveCount(0)
    } finally {
      await treeClearSearch(window)
    }
  })

  uiTest(
    'opening a different saved request shows ITS examples, never the previous ones',
    async ({ window }) => {
      await dismissOverlays(window)
      await ensureCanonicalProject(window)
      await closeAllTabs(window)
      const a = `sr-a-${uid()}`
      const b = `sr-b-${uid()}`

      await navigateSidebar(window, 'apis')
      await openHttpRequestTab(window)
      await fillUrl(window, `${localHttpBin()}/get?a=1`)
      await sendAndWaitResponse(window)
      await saveRequestToTree(window, a)
      await window.getByTestId('response-save-btn').click()
      await window.getByTestId('response-save-popover').locator('input').press('Enter')
      await expect(window.getByTestId('saved-response-row')).toHaveCount(1)

      await navigateSidebar(window, 'apis')
      await openHttpRequestTab(window)
      await fillUrl(window, `${localHttpBin()}/get?b=1`)
      await saveRequestToTree(window, b)
      await sendAndWaitResponse(window)
      await window.getByTestId('res-tab-saved').click()
      await expect(window.getByTestId('saved-response-row')).toHaveCount(0)
      await expect(window.getByTestId('res-tab-saved')).not.toContainText('1')
    },
  )
})
