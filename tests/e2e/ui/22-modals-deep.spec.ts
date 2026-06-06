import { expect } from '@playwright/test'
import { uiTest } from './_setup'
import { dismissOverlays, navigateSidebar } from '../helpers/ui/bootstrap'
import { pressModShortcut } from '../helpers/ui/keyboard'

uiTest.describe('Modals deep', () => {
  uiTest.beforeEach(async ({ window }) => {
    await dismissOverlays(window)
  })

  uiTest('environment modal: add variable', async ({ window }) => {
    await window.getByTestId('footer-env').click()
    await expect(window.getByTestId('environment-modal')).toBeVisible()
    await window.getByRole('button', { name: /Add variable|Add/i }).first().click()
    await window.keyboard.press('Escape')
  })

  uiTest('settings modal: theme and save', async ({ window }) => {
    await pressModShortcut(window, ',')
    await expect(window.getByTestId('settings-modal')).toBeVisible()
    await window.getByRole('button', { name: /Dark/i }).first().click()
    await window.getByRole('button', { name: /Save/i }).click()
    await expect(window.getByTestId('settings-modal')).toBeHidden({ timeout: 8_000 })
  })

  uiTest('import modal cURL paste step', async ({ window }) => {
    await pressModShortcut(window, 'o')
    await window.getByTestId('import-modal').getByRole('button', { name: 'cURL cURL' }).click()
    await window.getByRole('button', { name: /Next/i }).click()
    const ta = window.locator('textarea').first()
    await ta.fill('curl https://example.com')
    await expect(ta).toHaveValue(/curl/)
    await window.keyboard.press('Escape')
  })

  uiTest('endpoint save modal from shortcut', async ({ window }) => {
    await navigateSidebar(window, 'apis')
    await window.getByTestId('new-dropdown-btn').click()
    await window.getByTestId('new-dropdown-menu').getByRole('button', { name: /HTTP/i }).click()
    await pressModShortcut(window, 's')
    await expect(window.getByTestId('endpoint-save-modal')).toBeVisible({ timeout: 8_000 })
    await window.keyboard.press('Escape')
  })
})
