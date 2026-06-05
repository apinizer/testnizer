import { expect } from '@playwright/test'
import { uiTest } from './_setup'
import { dismissOverlays, navigateSidebar, openNewDropdownItem } from '../helpers/ui/bootstrap'
import { NEW_DROPDOWN_PROTOCOLS } from '../helpers/ui/inventory'

uiTest.describe('Protocol editors', () => {
  uiTest.beforeEach(async ({ window }) => {
    await dismissOverlays(window)
    await navigateSidebar(window, 'apis')
  })

  for (const label of NEW_DROPDOWN_PROTOCOLS) {
    uiTest(`New dropdown opens ${label.source}`, async ({ window }) => {
      if (/Import|cURL/i.test(label.source)) {
        await openNewDropdownItem(window, label)
        await expect(window.getByTestId('import-modal')).toBeVisible()
        await window.keyboard.press('Escape')
        return
      }
      await openNewDropdownItem(window, label)
      // Protocol tab should appear in workbench
      await expect(window.getByTestId('workbench')).toBeVisible()
      const tabs = window.locator('[data-testid="endpoint-tab"]')
      await expect(tabs.first()).toBeVisible({ timeout: 8_000 })
    })
  }
})
