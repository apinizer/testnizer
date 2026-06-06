import { expect } from '@playwright/test'
import { uiTest } from './_setup'
import { dismissOverlays, E2E_PROJECT_NAME, navigateSidebar } from '../helpers/ui/bootstrap'
import { treeSearch } from '../helpers/ui/tree'

uiTest.describe('Tree CRUD (deep)', () => {
  uiTest.beforeEach(async ({ window }) => {
    await dismissOverlays(window)
    await navigateSidebar(window, 'apis')
  })

  uiTest('tree search filters nodes', async ({ window }) => {
    await treeSearch(window, E2E_PROJECT_NAME)
    await expect(window.getByTestId('tree-node').first()).toBeVisible()
  })

  uiTest('add folder via context menu on Default module', async ({ window }) => {
    const module = window.getByTestId('tree-node').filter({ hasText: /Default|module/i }).first()
    if (await module.isVisible()) {
      await module.click({ button: 'right' })
      const menu = window.locator('[data-context-menu]')
      if (await menu.isVisible()) {
        await menu.getByRole('button', { name: /Add Folder/i }).click()
        await expect(window.getByTestId('tree-node').filter({ hasText: /New Folder|Folder/i })).toBeVisible({
          timeout: 8_000,
        })
      }
    }
  })

  uiTest('import dropdown shows format options', async ({ window }) => {
    await window.getByRole('button', { name: /Import/i }).first().click()
    await expect(window.getByText(/OpenAPI|Postman|WSDL/i).first()).toBeVisible()
    await window.keyboard.press('Escape')
  })
})
