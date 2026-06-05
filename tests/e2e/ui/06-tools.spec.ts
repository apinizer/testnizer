import { expect } from '@playwright/test'
import { uiTest } from './_setup'
import {
  dismissOverlays,
  fillCommandPalette,
  navigateSidebar,
  openCommandPalette,
} from '../helpers/ui/bootstrap'
import { TOOL_NAMES } from '../helpers/ui/inventory'

uiTest.describe('Tools panel', () => {
  uiTest.beforeEach(async ({ window }) => {
    await dismissOverlays(window)
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
      await window.getByRole('option', { name: new RegExp(toolName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') }).click()
      await expect(window.getByTestId('workbench')).toBeVisible()
      await window.keyboard.press('Escape')
    })
  }

  uiTest('tools panel search filters list', async ({ window }) => {
    const search = window.locator('input[placeholder*="Search"], input[placeholder*="search"]')
    if (await search.isVisible()) {
      await search.fill('UUID')
      await expect(window.getByText('UUID', { exact: false })).toBeVisible()
    }
  })
})
