import { expect } from '@playwright/test'
import { uiTest } from './_setup'
import { dismissOverlays, openCommandPalette } from '../helpers/ui/bootstrap'

uiTest.describe('Collection runner', () => {
  uiTest.beforeEach(async ({ window }) => {
    await dismissOverlays(window)
  })

  uiTest('opens from command palette and closes with Escape', async ({ window }) => {
    await openCommandPalette(window)
    await window.getByRole('option', { name: /Open collection runner|Koleksiyon çalıştırıcısını aç/i }).click()
    await expect(window.getByTestId('collection-runner-modal')).toBeVisible({ timeout: 8_000 })
    await window.keyboard.press('Escape')
    await expect(window.getByTestId('collection-runner-modal')).toBeHidden({ timeout: 5_000 })
  })
})
