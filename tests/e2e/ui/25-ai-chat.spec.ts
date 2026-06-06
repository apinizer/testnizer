import { expect } from '@playwright/test'
import { uiTest } from './_setup'
import { dismissOverlays, openNewDropdownItem } from '../helpers/ui/bootstrap'
import { getTestServerUrls } from '../helpers/test-servers'

uiTest.describe('AI Chat (fake LLM)', () => {
  uiTest('sends prompt and receives stub reply', async ({ window }) => {
    const { llm } = getTestServerUrls()
    await dismissOverlays(window)
    await openNewDropdownItem(window, /AI Chat/i)
    await window
      .getByPlaceholder(/chat completions|Endpoint URL|https:\/\/\.\.\./i)
      .fill(`${llm}/v1/chat/completions`)
    await window.getByPlaceholder('sk-...').fill('e2e-test-key')
    await window.getByPlaceholder(/Ask anything/i).fill('Say hello E2E')
    await window.getByRole('button', { name: /^Send$|^Gönder$/i }).click()
    await expect(window.getByText(/E2E stub reply|hello E2E/i).first()).toBeVisible({ timeout: 20_000 })
  })
})
