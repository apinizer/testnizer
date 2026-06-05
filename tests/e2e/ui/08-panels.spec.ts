import { expect } from '@playwright/test'
import { uiTest } from './_setup'
import { dismissOverlays, navigateSidebar } from '../helpers/ui/bootstrap'

uiTest.describe('Side panels', () => {
  uiTest.beforeEach(async ({ window }) => {
    await dismissOverlays(window)
  })

  uiTest('Tests panel shows overview surface', async ({ window }) => {
    await navigateSidebar(window, 'tests')
    await expect(window.getByText(/Tests|Overview|Suite/i).first()).toBeVisible()
  })

  uiTest('Mocks panel has new server control', async ({ window }) => {
    await navigateSidebar(window, 'mocks')
    await expect(window.getByRole('button', { name: /New|Mock/i }).first()).toBeVisible()
  })

  uiTest('History panel shows requests tab', async ({ window }) => {
    await navigateSidebar(window, 'history')
    await expect(window.getByText(/Requests|History/i).first()).toBeVisible()
  })

  uiTest('APIs panel has search and new dropdown', async ({ window }) => {
    await navigateSidebar(window, 'apis')
    await expect(window.getByTestId('new-dropdown-btn')).toBeVisible()
    await expect(window.getByPlaceholder(/Search|search/i)).toBeVisible()
  })
})
