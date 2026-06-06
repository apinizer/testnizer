/**
 * MST-085 — Wrong file type actionable error
 */
import { expect } from '@playwright/test'
import { uiTest } from './_setup'
import { dismissOverlays, navigateSidebar } from '../../helpers/ui/bootstrap'
import { openImportDropdown } from '../../helpers/ui/import-flow'
import { stubImportOpenFile } from '../../helpers/ui/import-export-ui-flow'

uiTest.describe('Tur1 — Import errors [MST-085]', () => {
  uiTest.beforeEach(async ({ window }) => {
    await dismissOverlays(window)
    await navigateSidebar(window, 'apis')
  })

  uiTest('MST-085 Postman environment file rejected as collection import', async ({ window }) => {
    await stubImportOpenFile(window, 'postman-env-wrong-type.json')
    await openImportDropdown(window, /Postman/i)
    const modal = window.getByTestId('import-modal')
    await modal.getByRole('button', { name: /Click to select a/i }).click()
    await expect(modal.getByText(/mismatch|environment|Postman/i).first()).toBeVisible({
      timeout: 15_000,
    })
  })
})
