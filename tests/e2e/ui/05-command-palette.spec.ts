import { expect } from '@playwright/test'
import { uiTest } from './_setup'
import { dismissOverlays, fillCommandPalette, openCommandPalette } from '../helpers/ui/bootstrap'

const PALETTE_ACTIONS = [
  /New tab/i,
  /Close current tab/i,
  /Toggle sidebar/i,
  /Send request/i,
  /Save endpoint/i,
  /Save project/i,
  /Open import/i,
  /Open settings/i,
  /Switch theme: Light/i,
  /Switch theme: Dark/i,
  /Switch theme: System/i,
  /Change language: English/i,
  /Change language: Türkçe/i,
  /Go to project APIs/i,
  /Manage environments/i,
  /Go to mock servers/i,
  /Open collection runner/i,
  /New project/i,
  /Show keyboard shortcuts/i,
  /About Testnizer/i,
] as const

uiTest.describe('Command palette', () => {
  uiTest.beforeEach(async ({ window }) => {
    await dismissOverlays(window)
  })

  for (const pattern of PALETTE_ACTIONS) {
    uiTest(`lists action: ${pattern.source}`, async ({ window }) => {
      await openCommandPalette(window)
      await expect(window.getByRole('option', { name: pattern })).toBeVisible()
      await window.keyboard.press('Escape')
    })
  }

  uiTest('search filters actions', async ({ window }) => {
    await openCommandPalette(window)
    await fillCommandPalette(window, 'JWT')
    await expect(window.getByRole('option', { name: /JWT/i })).toBeVisible()
    await window.keyboard.press('Escape')
  })
})
