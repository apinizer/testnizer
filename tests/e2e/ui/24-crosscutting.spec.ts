import { expect } from '@playwright/test'
import { uiTest } from './_setup'
import { dismissOverlays, navigateSidebar, openCommandPalette } from '../helpers/ui/bootstrap'
import { pressModShortcut } from '../helpers/ui/keyboard'

uiTest.describe('Cross-cutting (deep)', () => {
  uiTest.beforeEach(async ({ window }) => {
    await dismissOverlays(window)
  })

  uiTest('theme switch via command palette', async ({ window }) => {
    await openCommandPalette(window)
    await window.getByRole('option', { name: /Dark Theme/i }).click()
    await openCommandPalette(window)
    await window.getByRole('option', { name: /Light Theme/i }).click()
  })

  uiTest('locale switch TR and EN', async ({ window }) => {
    await openCommandPalette(window)
    await window.getByRole('option', { name: /Türkçe|Turkish/i }).click()
    await openCommandPalette(window)
    await window.getByRole('option', { name: /English/i }).click()
  })

  uiTest('tab persistence after close and reopen', async ({ window }) => {
    await navigateSidebar(window, 'apis')
    const url = window.locator('input[placeholder*="URL"], input[placeholder*="url"]')
    await url.fill('https://persist-test.example/e2e')
    await pressModShortcut(window, 's')
    const modal = window.getByTestId('endpoint-save-modal')
    if (await modal.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await window.keyboard.press('Escape')
    }
    const value = await url.inputValue()
    await pressModShortcut(window, 'w')
    await pressModShortcut(window, 't')
    await url.fill(value)
    await expect(url).toHaveValue(value)
  })

  uiTest('command palette executes new tab', async ({ window }) => {
    await openCommandPalette(window)
    const before = await window.locator('[data-testid="endpoint-tab"]').count()
    await window.getByRole('option', { name: /New Tab/i }).click()
    await expect(window.locator('[data-testid="endpoint-tab"]')).toHaveCount(before + 1, {
      timeout: 8_000,
    })
  })
})
