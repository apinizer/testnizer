/**
 * Issues #120 / #121 — AI Chat sends user-defined headers and works without
 * an API key. The fake LLM echoes `X-E2E-Echo` and the Authorization header
 * into its reply so the spec can see what reached the wire.
 */
import { expect } from '@playwright/test'
import { uiTest } from './_setup'
import {
  closeAllTabs,
  dismissOverlays,
  ensureCanonicalProject,
  openNewDropdownItem,
} from '../../helpers/ui/bootstrap'
import { getTestServerUrls } from '../../helpers/test-servers'

const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`

async function addHeaderRow(
  page: import('@playwright/test').Page,
  key: string,
  value: string,
): Promise<void> {
  const block = page.getByTestId('ai-chat-headers')
  // Fill the last (empty) row; the table always ends with a blank row.
  const rows = block.getByTestId(/^kv-row-/)
  const last = rows.last()
  await last.getByTestId('kv-key').fill(key)
  await last.locator('input').nth(1).fill(value)
}

uiTest.describe('Tur1 — AI Chat custom headers / optional key [issues #120, #121]', () => {
  uiTest(
    'sends custom headers with no API key; custom Authorization replaces Bearer',
    async ({ window }) => {
      await dismissOverlays(window)
      await ensureCanonicalProject(window)
      await closeAllTabs(window)
      const { llm } = getTestServerUrls()
      const tag = `ping-${uid()}`

      await openNewDropdownItem(window, /AI Chat/i)
      await window
        .getByPlaceholder(/chat completions|Endpoint URL|https:\/\/\.\.\./i)
        .fill(`${llm}/v1/chat/completions`)
      // API key deliberately left EMPTY (#121).
      await expect(window.getByPlaceholder('sk-...')).toHaveValue('')

      await window.getByTestId('ai-chat-headers').getByRole('button').first().click()
      await addHeaderRow(window, 'X-E2E-Echo', tag)

      const prompt = window.getByPlaceholder(/Ask anything|Bir şey sor/i)
      await prompt.fill('hello from e2e')
      const send = window.getByTitle(/^(Send|Gönder)$/)
      await expect(send).toBeEnabled()
      await send.click()

      // Reply echoes the custom header and reports no Authorization header was sent.
      await expect(window.getByText(new RegExp(`\\[echo=${tag}\\]`))).toBeVisible({
        timeout: 20_000,
      })
      await expect(window.getByText(/\[auth=none\]/)).toBeVisible()

      // A custom Authorization header goes out as-is (no duplicate Bearer).
      await addHeaderRow(window, 'Authorization', `Bearer custom-${tag}`)
      await prompt.fill('second')
      await send.click()
      await expect(window.getByText(new RegExp(`\\[auth=Bearer custom-${tag}\\]`))).toBeVisible({
        timeout: 20_000,
      })
    },
  )
})
