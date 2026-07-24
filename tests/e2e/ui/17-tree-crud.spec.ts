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

  // Issue #68: Add Folder must PROMPT — nothing is written until the user
  // confirms a name. The old flow persisted a folder called "New Folder" on the
  // menu click, so a mis-click left rubbish in the tree.
  uiTest('add folder via context menu prompts for a name before creating', async ({ window }) => {
    const module = window.getByTestId('tree-node').filter({ hasText: /Default|module/i }).first()
    if (!(await module.isVisible())) return
    await module.click({ button: 'right' })
    const menu = window.locator('[data-context-menu]')
    if (!(await menu.isVisible())) return

    await menu.getByRole('button', { name: /Add Folder/i }).click()

    // An empty inline editor appears — and no folder exists yet.
    const draft = window.getByTestId('new-folder-input')
    await expect(draft).toBeVisible({ timeout: 8_000 })
    await expect(draft).toHaveValue('')
    await expect(window.getByTestId('tree-node').filter({ hasText: /^New Folder$/ })).toHaveCount(0)

    // Escape abandons it without creating anything.
    await draft.press('Escape')
    await expect(draft).toBeHidden()

    // Confirming creates the folder under the typed name.
    await module.click({ button: 'right' })
    await menu.getByRole('button', { name: /Add Folder/i }).click()
    const draft2 = window.getByTestId('new-folder-input')
    await draft2.fill('İade İşlemleri')
    await draft2.press('Enter')
    await expect(
      window.getByTestId('tree-node').filter({ hasText: 'İade İşlemleri' }).first(),
    ).toBeVisible({ timeout: 8_000 })
  })

  uiTest('import dropdown shows format options', async ({ window }) => {
    await window.getByRole('button', { name: /Import/i }).first().click()
    await expect(window.getByText(/OpenAPI|Postman|WSDL/i).first()).toBeVisible()
    await window.keyboard.press('Escape')
  })
})
