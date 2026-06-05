import { expect } from '@playwright/test'
import { uiTest } from './_setup'
import { ALL_INVENTORY } from '../helpers/ui/inventory'
import { dismissOverlays, navigateSidebar } from '../helpers/ui/bootstrap'

uiTest.describe('UI inventory sweep', () => {
  uiTest.beforeEach(async ({ window }) => {
    await dismissOverlays(window)
    await navigateSidebar(window, 'apis')
    await window.getByTestId('new-dropdown-btn').click()
    await window.getByTestId('new-dropdown-menu').getByRole('button', { name: /^HTTP$/i }).click()
    await expect(window.getByTestId('send-btn')).toBeVisible({ timeout: 10_000 })
  })

  for (const item of ALL_INVENTORY) {
    uiTest(`inventory: ${item.id} — ${item.description}`, async ({ window }) => {
      if (item.requiresPage) {
        await navigateSidebar(window, item.requiresPage)
        if (item.requiresPage === 'apis') {
          await window.getByTestId('new-dropdown-btn').click()
          await window.getByTestId('new-dropdown-menu').getByRole('button', { name: /^HTTP$/i }).click()
        }
      }

      const locator = window.locator(item.selector).first()
      await expect(locator).toBeVisible({ timeout: 8_000 })

      if (item.action === 'click') {
        await locator.click()
        // Modals close after click tests that open overlays
        if (item.id.startsWith('footer-')) {
          await window.keyboard.press('Escape')
        }
      }
    })
  }

  uiTest('inventory: all New dropdown protocol entries exist', async ({ window }) => {
    await window.getByTestId('new-dropdown-btn').click()
    const menu = window.getByTestId('new-dropdown-menu')
    await expect(menu).toBeVisible()
    const labels = [
      'HTTP',
      'Quick Request',
      'SOAP',
      'WebSocket',
      'GraphQL',
      'gRPC',
      'SSE',
      'MCP',
      'Socket.IO',
    ]
    for (const label of labels) {
      await expect(menu.getByRole('button', { name: new RegExp(label, 'i') })).toBeVisible()
    }
  })
})
