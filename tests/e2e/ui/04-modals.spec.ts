import { expect } from '@playwright/test'
import { uiTest } from './_setup'
import { dismissOverlays, navigateSidebar, openCommandPalette } from '../helpers/ui/bootstrap'
import { pressModShortcut } from '../helpers/ui/keyboard'

uiTest.describe('Modals', () => {
  uiTest.beforeEach(async ({ window }) => {
    await dismissOverlays(window)
    await navigateSidebar(window, 'apis')
  })

  const modalCases: { name: string; open: (w: import('@playwright/test').Page) => Promise<void>; testId: string }[] = [
    {
      name: 'Import',
      testId: 'import-modal',
      open: async (w) => {
        await pressModShortcut(w, 'o')
      },
    },
    {
      name: 'Settings',
      testId: 'settings-modal',
      open: async (w) => {
        await pressModShortcut(w, ',')
      },
    },
    {
      name: 'Save project',
      testId: 'save-modal',
      open: async (w) => {
        await pressModShortcut(w, 's', { shift: true })
      },
    },
    {
      name: 'Environment',
      testId: 'environment-modal',
      open: async (w) => {
        await w.getByTestId('footer-env').click()
      },
    },
    {
      name: 'About',
      testId: 'about-modal',
      open: async (w) => {
        await openCommandPalette(w)
        await w.getByRole('option', { name: /About/i }).click()
      },
    },
    {
      name: 'Shortcut cheatsheet',
      testId: 'shortcut-cheatsheet',
      open: async (w) => {
        await w.keyboard.press('Shift+Slash')
      },
    },
    {
      name: 'Project detail',
      testId: 'project-detail-modal',
      open: async (w) => {
        await w.getByTestId('nav-settings').click()
      },
    },
    {
      name: 'Enterprise',
      testId: 'enterprise-modal',
      open: async (w) => {
        await w.getByTestId('footer-enterprise').click()
      },
    },
  ]

  for (const { name, testId, open } of modalCases) {
    uiTest(`${name} modal opens and closes with Escape`, async ({ window }) => {
      await open(window)
      await expect(window.getByTestId(testId)).toBeVisible({ timeout: 8_000 })
      await window.keyboard.press('Escape')
      await expect(window.getByTestId(testId)).toBeHidden({ timeout: 5_000 })
    })
  }

  uiTest('Import modal shows format grid', async ({ window }) => {
    await pressModShortcut(window, 'o')
    const modal = window.getByTestId('import-modal')
    await expect(modal).toBeVisible()
    await expect(modal.getByRole('button', { name: 'OpenAPI/Swagger' })).toBeVisible()
    await expect(modal.getByRole('button', { name: 'Postman' })).toBeVisible()
    await expect(modal.getByRole('button', { name: 'WSDL WSDL' })).toBeVisible()
    await window.keyboard.press('Escape')
  })
})
