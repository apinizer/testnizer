import { expect } from '@playwright/test'
import { uiTest } from './_setup'
import { dismissOverlays, openNewDropdownItem } from '../helpers/ui/bootstrap'
import { getTestServerUrls } from '../helpers/test-servers'

uiTest.describe('AI Chat (fake LLM)', () => {
  uiTest('sends prompt and receives stub reply', async ({ window }) => {
    const { llm } = getTestServerUrls()
    await dismissOverlays(window)
    await openNewDropdownItem(window, /AI/i)
    await window.getByPlaceholder(/endpoint|url/i).first().fill(`${llm}/v1/chat/completions`)
    await window.locator('textarea').first().fill('Say hello E2E')
    await window.getByRole('button', { name: /Send/i }).click()
    await expect(window.getByText(/E2E stub reply|hello E2E/i).first()).toBeVisible({ timeout: 20_000 })
  })
})
