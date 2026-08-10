/**
 * MST-204..207, MST-205 — Tools + command palette smoke
 */
import { expect } from '@playwright/test'
import { uiTest } from './_setup'
import { dismissOverlays, navigateSidebar, openCommandPalette } from '../../helpers/ui/bootstrap'
import { pressModShortcut } from '../../helpers/ui/keyboard'

uiTest.describe('Tur1 — Tools & palette [MST-204..207]', () => {
  uiTest.beforeEach(async ({ window }) => {
    await dismissOverlays(window)
  })

  uiTest('MST-207 Tools panel lists core utilities', async ({ window }) => {
    await navigateSidebar(window, 'tools')
    for (const label of [/JSONPath/i, /Hash/i, /UUID/i]) {
      await expect(window.getByText(label).first()).toBeVisible({ timeout: 10_000 })
    }
    // JWT lives on the Security page now (it moved there with the security
    // batch); asserting it on the Tools page has been failing every nightly
    // run since.
    await navigateSidebar(window, 'security')
    await expect(window.getByText(/JWT/i).first()).toBeVisible({ timeout: 10_000 })
    await navigateSidebar(window, 'tools')
  })

  uiTest('MST-205 command palette opens and finds New Request', async ({ window }) => {
    await navigateSidebar(window, 'apis')
    await openCommandPalette(window)
    const palette = window.getByTestId('command-palette')
    await expect(palette.getByRole('option', { name: /New tab|Yeni sekme/i }).first()).toBeVisible({
      timeout: 8_000,
    })
    await pressModShortcut(window, 'k', { shift: true }).catch(() =>
      window.keyboard.press('Escape'),
    )
  })
})
