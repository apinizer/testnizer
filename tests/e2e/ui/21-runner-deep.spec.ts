import { expect } from '@playwright/test'
import { uiTest } from './_setup'
import { dismissOverlays, navigateSidebar, openCommandPalette } from '../helpers/ui/bootstrap'

uiTest.describe('Runner & suites (deep)', () => {
  uiTest.beforeEach(async ({ window }) => {
    await dismissOverlays(window)
  })

  uiTest('tests panel overview and scheduled nav', async ({ window }) => {
    await navigateSidebar(window, 'tests')
    await window.getByRole('button', { name: /Overview/i }).click()
    await window.getByRole('button', { name: /Scheduled Tasks/i }).click()
    await expect(window.getByText(/Scheduled|Tasks|Run/i).first()).toBeVisible()
  })

  uiTest('create test suite', async ({ window }) => {
    await navigateSidebar(window, 'tests')
    await window.getByRole('button', { name: /New Test Suite|\+/i }).first().click()
    const input = window.locator('input[placeholder*="suite"], input').first()
    await input.fill('E2E Suite')
    await input.press('Enter')
    await expect(window.getByText('E2E Suite').first()).toBeVisible({ timeout: 8_000 })
  })

  uiTest('collection runner modal start run against local stub', async ({ window }) => {
    await navigateSidebar(window, 'apis')
    await openCommandPalette(window)
    await window.getByRole('option', { name: /Open collection runner/i }).click()
    await expect(window.getByTestId('collection-runner-modal')).toBeVisible()
    await window.getByRole('button', { name: /Start run|Run/i }).first().click()
    await expect(window.getByText(/Passed|Failed|Running|Complete/i).first()).toBeVisible({
      timeout: 60_000,
    })
    await window.keyboard.press('Escape')
  })
})
