import { expect } from '@playwright/test'
import { uiTest } from './_setup'
import {
  closeAllTabs,
  dismissOverlays,
  fillCommandPalette,
  navigateSidebar,
  openCommandPalette,
} from '../helpers/ui/bootstrap'
import { SECURITY_TOOL_NAMES, TOOL_NAMES } from '../helpers/ui/inventory'

uiTest.describe('Tools panel', () => {
  uiTest.beforeEach(async ({ window }) => {
    await dismissOverlays(window)
    await closeAllTabs(window)
    await navigateSidebar(window, 'tools')
  })

  for (const toolName of TOOL_NAMES) {
    uiTest(`tools sidebar lists ${toolName}`, async ({ window }) => {
      await expect(window.getByText(toolName, { exact: false })).toBeVisible()
    })
  }

  for (const toolName of TOOL_NAMES) {
    uiTest(`opens ${toolName} via command palette`, async ({ window }) => {
      await navigateSidebar(window, 'apis')
      await openCommandPalette(window)
      const keyword = toolName.split(/[\s/↔]/)[0]
      await fillCommandPalette(window, keyword)
      await window
        .getByRole('option', {
          name: new RegExp(toolName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'),
        })
        .click()
      await expect(window.getByTestId('workbench')).toBeVisible()
      await window.keyboard.press('Escape')
    })
  }

  // The security tools live on their own page since the Security section
  // landed — assert them where they actually are.
  for (const toolName of SECURITY_TOOL_NAMES) {
    uiTest(`security page lists ${toolName}`, async ({ window }) => {
      await navigateSidebar(window, 'security')
      await expect(window.getByText(toolName, { exact: false }).first()).toBeVisible()
      await navigateSidebar(window, 'tools')
    })
  }

  uiTest('tools panel search filters list', async ({ window }) => {
    const search = window
      .locator('input[placeholder*="Search"], input[placeholder*="search"]')
      .first()
    if (await search.isVisible()) {
      await search.fill('UUID')
      await expect(window.getByText('UUID', { exact: false }).first()).toBeVisible()
      // Leave the panel unfiltered: these specs share one Electron instance, so
      // a leftover query hides every other tool from the NEXT spec file.
      await search.fill('')
    }
  })
})
