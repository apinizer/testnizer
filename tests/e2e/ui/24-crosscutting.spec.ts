import { expect } from '@playwright/test'
import { uiTest } from './_setup'
import { dismissOverlays, navigateSidebar, openCommandPalette, openHttpRequestTab } from '../helpers/ui/bootstrap'
import { pressModShortcut } from '../helpers/ui/keyboard'

uiTest.describe('Cross-cutting (deep)', () => {
  uiTest.beforeEach(async ({ window }) => {
    await dismissOverlays(window)
  })

  uiTest('theme switch via command palette', async ({ window }) => {
    await openCommandPalette(window)
    await window.getByRole('option', { name: /Switch theme: Dark|Tema: Koyu/i }).click()
    await openCommandPalette(window)
    await window.getByRole('option', { name: /Switch theme: Light|Tema: Açık/i }).click()
  })

  uiTest('locale switch TR and EN', async ({ window }) => {
    await openCommandPalette(window)
    await window.getByRole('option', { name: /Türkçe|Turkish/i }).click()
    await openCommandPalette(window)
    await window.getByRole('option', { name: /English/i }).click()
  })

  uiTest('tab persistence across tab switches', async ({ window }) => {
    await navigateSidebar(window, 'apis')
    const tabs = window.locator('[data-testid="endpoint-tab"]')
    await openHttpRequestTab(window)
    const url = window.getByTestId('url-input')
    const value = `https://persist-test.example/e2e-${Date.now()}`
    await url.fill(value)
    const filledTabIndex = (await tabs.count()) - 1
    await openHttpRequestTab(window)
    await tabs.nth(filledTabIndex).click()
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
