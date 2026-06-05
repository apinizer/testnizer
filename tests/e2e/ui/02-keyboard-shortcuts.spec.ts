import { expect } from '@playwright/test'
import { uiTest } from './_setup'
import { dismissOverlays, navigateSidebar } from '../helpers/ui/bootstrap'
import { pressModShortcut } from '../helpers/ui/keyboard'

uiTest.describe('Keyboard shortcuts', () => {
  uiTest.beforeEach(async ({ window }) => {
    await dismissOverlays(window)
    await navigateSidebar(window, 'apis')
    await window.getByTestId('new-dropdown-btn').click()
    await window.getByTestId('new-dropdown-menu').getByRole('button', { name: /^HTTP$/i }).click()
    await expect(window.getByTestId('send-btn')).toBeVisible({ timeout: 10_000 })
  })

  uiTest('Cmd/Ctrl+K opens command palette', async ({ window }) => {
    await pressModShortcut(window, 'k')
    await expect(window.getByTestId('command-palette')).toBeVisible()
    await window.keyboard.press('Escape')
  })

  uiTest('? opens shortcut cheatsheet', async ({ window }) => {
    await window.keyboard.press('Shift+Slash')
    await expect(window.getByTestId('shortcut-cheatsheet')).toBeVisible()
    await window.keyboard.press('Escape')
  })

  uiTest('Cmd/Ctrl+O opens import modal', async ({ window }) => {
    await pressModShortcut(window, 'o')
    await expect(window.getByTestId('import-modal')).toBeVisible()
    await window.keyboard.press('Escape')
  })

  uiTest('Cmd/Ctrl+, opens settings modal', async ({ window }) => {
    await pressModShortcut(window, ',')
    await expect(window.getByTestId('settings-modal')).toBeVisible()
    await window.keyboard.press('Escape')
  })

  uiTest('Cmd/Ctrl+Shift+S opens save project modal', async ({ window }) => {
    await pressModShortcut(window, 's', { shift: true })
    await expect(window.getByTestId('save-modal')).toBeVisible()
    await window.keyboard.press('Escape')
  })

  uiTest('Cmd/Ctrl+T opens new tab', async ({ window }) => {
    const tabsBefore = await window.locator('[data-testid="endpoint-tab"]').count()
    await pressModShortcut(window, 't')
    await expect(window.locator('[data-testid="endpoint-tab"]')).toHaveCount(tabsBefore + 1, {
      timeout: 5_000,
    })
  })

  uiTest('Cmd/Ctrl+L focuses URL input', async ({ window }) => {
    await pressModShortcut(window, 'l')
    const urlInput = window.locator('input[placeholder*="URL"], input[placeholder*="url"]')
    await expect(urlInput).toBeFocused()
  })

  uiTest('Cmd/Ctrl+N opens new request tab', async ({ window }) => {
    const tabsBefore = await window.locator('[data-testid="endpoint-tab"]').count()
    await pressModShortcut(window, 'n')
    await expect(window.locator('[data-testid="endpoint-tab"]')).toHaveCount(tabsBefore + 1, {
      timeout: 5_000,
    })
  })

  uiTest('Cmd/Ctrl+B toggles left panel', async ({ window }) => {
    const leftPanel = window.getByTestId('left-panel')
    const visibleBefore = await leftPanel.isVisible()
    await pressModShortcut(window, 'b')
    if (visibleBefore) {
      await expect(leftPanel).toBeHidden({ timeout: 3_000 })
      await pressModShortcut(window, 'b')
      await expect(leftPanel).toBeVisible({ timeout: 3_000 })
    }
  })

  uiTest('Cmd/Ctrl+S opens endpoint save modal on unsaved tab', async ({ window }) => {
    await pressModShortcut(window, 's')
    await expect(window.getByTestId('endpoint-save-modal')).toBeVisible()
    await window.keyboard.press('Escape')
  })
})
