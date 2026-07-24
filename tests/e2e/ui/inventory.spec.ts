import { expect } from '@playwright/test'
import { uiTest } from './_setup'
import { ALL_INVENTORY, NEW_DROPDOWN_PROTOCOLS, TOOL_NAMES } from '../helpers/ui/inventory'
import {
  dismissOverlays,
  navigateSidebar,
  openNewDropdownItem,
  openCommandPalette,
  expectNoErrorBoundary,
} from '../helpers/ui/bootstrap'
import { openTool } from '../helpers/ui/tools-flow'
import { pressModShortcut } from '../helpers/ui/keyboard'

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

/**
 * Screen-render coverage sweep. Distinct from the "control is visible" checks
 * above: here we actually mount each surface (sidebar page, protocol editor,
 * tool, modal) and assert the ErrorBoundary recovery panel is NOT showing —
 * the same marker the RTL harness keys on. A screen that throws on mount turns
 * one of these RED instead of white-screening 600+ users.
 */
uiTest.describe('Screen-render coverage sweep', () => {
  uiTest.beforeEach(async ({ window }) => {
    await dismissOverlays(window)
  })

  const SIDEBAR_PAGES = ['apis', 'tests', 'mocks', 'history', 'tools', 'settings'] as const
  for (const pageId of SIDEBAR_PAGES) {
    uiTest(`sidebar page renders: ${pageId}`, async ({ window }) => {
      await navigateSidebar(window, pageId)
      await expect(window.getByTestId(`nav-${pageId}`)).toBeVisible({ timeout: 8_000 })
      await expectNoErrorBoundary(window)
    })
  }

  // One editor of each protocol from the New (+) dropdown. Import / cURL open a
  // modal instead of an editor tab, so assert on the modal for those.
  for (const label of NEW_DROPDOWN_PROTOCOLS) {
    uiTest(`protocol editor renders: ${label.source}`, async ({ window }) => {
      await navigateSidebar(window, 'apis')
      await openNewDropdownItem(window, label)
      if (/Import|cURL/i.test(label.source)) {
        await expect(window.getByTestId('import-modal')).toBeVisible({ timeout: 8_000 })
        await expectNoErrorBoundary(window)
        await window.keyboard.press('Escape')
        return
      }
      await expect(window.getByTestId('workbench')).toBeVisible({ timeout: 8_000 })
      await expect(window.locator('[data-testid="endpoint-tab"]').first()).toBeVisible({
        timeout: 8_000,
      })
      await expectNoErrorBoundary(window)
    })
  }

  // Every standalone Tools-panel utility.
  for (const tool of TOOL_NAMES) {
    uiTest(`tool renders: ${tool}`, async ({ window }) => {
      await openTool(window, tool)
      await expect(window.getByTestId('workbench')).toBeVisible({ timeout: 8_000 })
      await expectNoErrorBoundary(window)
    })
  }

  // Each top-level modal.
  const MODALS: {
    name: string
    testId: string
    open: (w: import('@playwright/test').Page) => Promise<void>
  }[] = [
    { name: 'Import', testId: 'import-modal', open: (w) => pressModShortcut(w, 'o') },
    { name: 'Settings', testId: 'settings-modal', open: (w) => pressModShortcut(w, ',') },
    {
      name: 'Save project',
      testId: 'save-modal',
      open: (w) => pressModShortcut(w, 's', { shift: true }),
    },
    { name: 'Environment', testId: 'environment-modal', open: (w) => w.getByTestId('footer-env').click() },
    {
      name: 'Enterprise',
      testId: 'enterprise-modal',
      open: (w) => w.getByTestId('footer-enterprise').click(),
    },
    {
      name: 'Project detail',
      testId: 'project-detail-modal',
      open: (w) => w.getByTestId('nav-settings').click(),
    },
    { name: 'Shortcut cheatsheet', testId: 'shortcut-cheatsheet', open: (w) => w.keyboard.press('Shift+Slash') },
    {
      name: 'About',
      testId: 'about-modal',
      open: async (w) => {
        await openCommandPalette(w)
        await w.getByRole('option', { name: /About/i }).click()
      },
    },
  ]

  for (const { name, testId, open } of MODALS) {
    uiTest(`modal renders: ${name}`, async ({ window }) => {
      await navigateSidebar(window, 'apis')
      await open(window)
      await expect(window.getByTestId(testId)).toBeVisible({ timeout: 8_000 })
      await expectNoErrorBoundary(window)
      await window.keyboard.press('Escape')
    })
  }
})
