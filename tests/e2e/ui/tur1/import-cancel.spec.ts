/**
 * MST-090 — Import cancel mid-wizard: no partial tree pollution
 *
 * Tests that cancelling the import modal at various steps does not
 * create orphaned folders or endpoints in the project tree.
 */
import { expect } from '@playwright/test'
import { uiTest } from './_setup'
import { dismissOverlays, navigateSidebar } from '../../helpers/ui/bootstrap'
import { getActiveProjectId, listEndpointsByProject } from '../../helpers/ui/assert-ipc'
import { openImportDropdown } from '../../helpers/ui/import-flow'
import { stubImportOpenFile } from '../../helpers/ui/import-export-ui-flow'

uiTest.describe('Tur1 — Import cancel mid-wizard [MST-090]', () => {
  uiTest.beforeEach(async ({ window }) => {
    await dismissOverlays(window)
    await navigateSidebar(window, 'apis')
  })

  uiTest('MST-090 cancel on format selection step leaves tree unchanged', async ({ window }) => {
    const projectId = await getActiveProjectId(window)
    const rowsBefore = ((await listEndpointsByProject(window, projectId)) as unknown[]).length

    // The "Import API Data" button opens a format dropdown; picking a format opens the modal.
    await openImportDropdown(window, /Postman/i)
    const modal = window.getByTestId('import-modal')
    await expect(modal).toBeVisible({ timeout: 8_000 })

    // Cancel by pressing Escape
    await window.keyboard.press('Escape')
    await expect(modal).toBeHidden({ timeout: 10_000 })

    const rowsAfter = ((await listEndpointsByProject(window, projectId)) as unknown[]).length
    expect(rowsAfter).toBe(rowsBefore)
  })

  uiTest('MST-090 cancel after file selection (step 2) leaves tree unchanged', async ({ app, window }) => {
    const projectId = await getActiveProjectId(window)
    const rowsBefore = ((await listEndpointsByProject(window, projectId)) as unknown[]).length

    const restoreDialog = await stubImportOpenFile(app, 'postman-v2.1.json')
    try {
      await openImportDropdown(window, /Postman/i)
      const modal = window.getByTestId('import-modal')

      // Pick the (stubbed-dialog) file: the wizard advances to the destination step
      await modal.getByRole('button', { name: /Click to select a/i }).click()
      await expect(modal.getByText(/Ready to import/i)).toBeVisible({ timeout: 15_000 })

      await modal.getByRole('button', { name: /^Cancel$/i }).click()
      await expect(modal).toBeHidden({ timeout: 10_000 })
    } finally {
      await restoreDialog()
    }

    const rowsAfter = ((await listEndpointsByProject(window, projectId)) as unknown[]).length
    expect(rowsAfter).toBe(rowsBefore)
  })

  uiTest('MST-090 cancel after folder name entry (step 3) leaves tree unchanged', async ({ app, window }) => {
    const projectId = await getActiveProjectId(window)
    const rowsBefore = ((await listEndpointsByProject(window, projectId)) as unknown[]).length

    const restoreDialog = await stubImportOpenFile(app, 'postman-v2.1.json')
    try {
      await openImportDropdown(window, /Postman/i)
      const modal = window.getByTestId('import-modal')

      await modal.getByRole('button', { name: /Click to select a/i }).click()
      await expect(modal.getByText(/Ready to import/i)).toBeVisible({ timeout: 15_000 })

      // Fill folder name but do NOT click Import — cancel instead
      await modal.getByPlaceholder('Folder name').fill('Should Not Be Created')
      await modal.getByRole('button', { name: /^Cancel$/i }).click()
      await expect(modal).toBeHidden({ timeout: 10_000 })
    } finally {
      await restoreDialog()
    }

    // Give the app a moment to settle
    await window.waitForTimeout(300)

    const rowsAfter = ((await listEndpointsByProject(window, projectId)) as unknown[]).length
    expect(rowsAfter).toBe(rowsBefore)
  })

  uiTest('MST-090 reopening import modal after cancel shows clean state', async ({ app, window }) => {
    const restoreDialog = await stubImportOpenFile(app, 'postman-v2.1.json')
    try {
      await openImportDropdown(window, /Postman/i)
      const modal = window.getByTestId('import-modal')
      await modal.getByRole('button', { name: /Click to select a/i }).click()
      await expect(modal.getByText(/Ready to import/i)).toBeVisible({ timeout: 15_000 })
      await modal.getByPlaceholder('Folder name').fill('Stale Folder Name')

      await modal.getByRole('button', { name: /^Cancel$/i }).click()
      await expect(modal).toBeHidden({ timeout: 10_000 })

      // Reopen the same format: the modal must be back at the file-pick step,
      // not carry the file / folder name of the cancelled run.
      await openImportDropdown(window, /Postman/i)
      const reopened = window.getByTestId('import-modal')
      await expect(reopened.getByRole('button', { name: /Click to select a/i })).toBeVisible()
      await expect(reopened.getByText(/Ready to import/i)).toBeHidden()
      await expect(reopened.getByPlaceholder('Folder name')).toBeHidden()
      await window.keyboard.press('Escape')
      await expect(reopened).toBeHidden({ timeout: 10_000 })
    } finally {
      await restoreDialog()
    }
  })
})
