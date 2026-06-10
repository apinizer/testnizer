import { expect } from '@playwright/test'
import { uiTest } from './_setup'
import {
  dismissOverlays,
  navigateSidebar,
  ensureCanonicalProject,
  E2E_PROJECT_NAME,
} from '../helpers/ui/bootstrap'

/**
 * UI wiring for the folder-level auth + scripts editor: right-click a folder →
 * Settings opens the FolderSettingsModal, which can set a Bearer token and save.
 * End-to-end resolution is covered by the runner E2E + unit suites; this guards
 * the menu entry + modal mount + save round-trip.
 */
uiTest.describe('Folder Settings modal', () => {
  uiTest.beforeEach(async ({ window }) => {
    await dismissOverlays(window)
    await ensureCanonicalProject(window)
    await navigateSidebar(window, 'apis')
  })

  uiTest('right-click folder → Settings opens the editor and saves a bearer', async ({
    window,
  }) => {
    // The empty project's tree root is a single module node labelled with the
    // project name. Add a folder under it so we have a real folder to configure.
    const root = window
      .getByTestId('tree-node')
      .filter({ hasText: E2E_PROJECT_NAME })
      .first()
    await expect(root).toBeVisible({ timeout: 10_000 })
    await root.click({ button: 'right' })
    const addMenu = window.locator('[data-context-menu]')
    await expect(addMenu).toBeVisible()
    await addMenu.getByRole('button', { name: /Add Folder/i }).click()

    const folderNode = window
      .getByTestId('tree-node')
      .filter({ hasText: /New Folder/i })
      .first()
    await expect(folderNode).toBeVisible({ timeout: 8_000 })

    // Right-click the folder → Settings.
    await folderNode.click({ button: 'right' })
    const menu = window.locator('[data-context-menu]')
    await expect(menu).toBeVisible()
    await menu.getByRole('button', { name: /^Settings$/ }).click()

    // Modal mounted with both tabs.
    const authTab = window.getByRole('button', { name: /^Authorization$/ })
    await expect(authTab).toBeVisible({ timeout: 8_000 })
    await expect(window.getByRole('button', { name: /^Scripts$/ })).toBeVisible()

    // Choose Bearer and enter a token referencing an env var.
    const typeSelect = window.locator('select').first()
    await typeSelect.selectOption('bearer')
    const tokenInput = window.getByPlaceholder('{{accessToken}}')
    await expect(tokenInput).toBeVisible()
    await tokenInput.fill('{{accessToken}}')

    // Save closes the modal.
    await window.getByRole('button', { name: /^Save$/ }).click()
    await expect(authTab).toBeHidden({ timeout: 8_000 })

    // Reopen to confirm the bearer token persisted.
    await folderNode.click({ button: 'right' })
    await window.locator('[data-context-menu]').getByRole('button', { name: /^Settings$/ }).click()
    await expect(window.getByPlaceholder('{{accessToken}}')).toHaveValue('{{accessToken}}', {
      timeout: 8_000,
    })
    await window.keyboard.press('Escape')
  })
})
