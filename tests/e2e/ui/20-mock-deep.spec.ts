import { expect } from '@playwright/test'
import { uiTest } from './_setup'
import { dismissOverlays, navigateSidebar } from '../helpers/ui/bootstrap'

uiTest.describe('Mock servers (deep)', () => {
  uiTest.beforeEach(async ({ window }) => {
    await dismissOverlays(window)
    await navigateSidebar(window, 'mocks')
  })

  uiTest('create mock server', async ({ window }) => {
    await window.getByRole('button', { name: 'New mock server' }).click()
    await window.getByPlaceholder(/Server name|Sunucu adı/i).fill('E2E Mock')
    await window.getByRole('button', { name: /^Create$|^Oluştur$/i }).click()
    await expect(window.getByText('E2E Mock').first()).toBeVisible({ timeout: 10_000 })
  })

  uiTest('mock server editor tabs', async ({ window }) => {
    const row = window.getByText(/Mock|Server/i).first()
    if (await row.isVisible()) {
      await row.click()
      for (const tab of [/Endpoints/i, /Settings/i, /Logs/i]) {
        const btn = window.getByRole('button', { name: tab }).first()
        if (await btn.isVisible()) await btn.click()
      }
    }
  })
})
