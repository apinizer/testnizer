import { expect } from '@playwright/test'
import { uiTest } from './_setup'
import { E2E_PROJECT_NAME } from '../helpers/ui/bootstrap'

uiTest.describe('Bootstrap flow', () => {
  uiTest('EULA accepted and workbench is ready', async ({ window }) => {
    await expect(window.getByTestId('workbench')).toBeVisible()
    await expect(window.getByTestId('nav-apis')).toBeVisible()
  })

  uiTest('test project is open', async ({ window }) => {
    const body = await window.locator('body').innerText()
    expect(body).toContain(E2E_PROJECT_NAME)
  })
})
