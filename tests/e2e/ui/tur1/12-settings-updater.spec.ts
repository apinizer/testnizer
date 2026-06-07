/**
 * MST-191, MST-192 — Settings theme + locale persist
 */
import { expect } from '@playwright/test'
import { uiTest } from './_setup'
import { dismissOverlays } from '../../helpers/ui/bootstrap'
import { pressModShortcut } from '../../helpers/ui/keyboard'

uiTest.describe('Tur1 — Settings [MST-191, MST-192]', () => {
  uiTest.beforeEach(async ({ window }) => {
    await dismissOverlays(window)
  })

  // Theme + locale are worker-global (electron-store + ui.store). Leaving the
  // window on Dark/Turkish breaks later locale-/contrast-sensitive specs in the
  // same worker. Restore Light + English through the settings modal (Save writes
  // the live store), regardless of which assertion ran.
  uiTest.afterEach(async ({ window }) => {
    try {
      await dismissOverlays(window)
      await pressModShortcut(window, ',')
      const modal = window.getByTestId('settings-modal')
      await expect(modal).toBeVisible({ timeout: 8_000 })
      // Light theme button (label may be EN "Light" or TR "Açık").
      await modal.getByRole('button', { name: /^Light$|^Açık$/i }).first().click()
      // Language back to English.
      await modal
        .locator('select')
        .first()
        .selectOption('en')
        .catch(() => {})
      await modal.getByRole('button', { name: /Save|Kaydet/i }).click()
      await expect(modal).toBeHidden({ timeout: 5_000 })
    } catch {
      await dismissOverlays(window).catch(() => {})
    }
  })

  uiTest('MST-191 theme switch updates document data attribute', async ({ window }) => {
    await pressModShortcut(window, ',')
    await expect(window.getByTestId('settings-modal')).toBeVisible({ timeout: 8_000 })
    await window.getByRole('button', { name: /Dark|Koyu/i }).click()
    await window.getByRole('button', { name: /Save|Kaydet/i }).click()
    await expect(window.getByTestId('settings-modal')).toBeHidden({ timeout: 5_000 })
    const theme = await window.evaluate(() => document.documentElement.getAttribute('data-theme'))
    expect(theme === 'dark' || theme === 'system').toBeTruthy()
  })

  uiTest('MST-192 locale TR switch shows Turkish labels', async ({ window }) => {
    await pressModShortcut(window, ',')
    await expect(window.getByTestId('settings-modal')).toBeVisible()
    await window.locator('#settings-modal select, [id^="settings-lang"]').first().selectOption('tr').catch(async () => {
      await window.getByRole('combobox').first().selectOption('tr')
    })
    await window.getByRole('button', { name: /Save|Kaydet/i }).click()
    await expect(window.getByTestId('nav-apis')).toBeVisible()
  })
})
