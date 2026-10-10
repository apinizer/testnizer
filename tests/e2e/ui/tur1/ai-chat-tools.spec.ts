/**
 * Issue #180 — AI Chat uses an MCP server as tools, end to end.
 *
 * The fake LLM (tests/e2e/servers/fake-llm.ts) asks for the e2e MCP server's
 * `echo` tool (streamed tool_calls fragments) whenever a request offers it,
 * then answers with the tool result. Flow: add the e2e MCP server ad hoc in
 * the Tools tab → Send → the approval card appears → Allow once → the tool
 * result is shown in the call card → the final answer renders, with the
 * per-message metrics row (#198). Approval is on by default: nothing runs
 * before the click.
 */
import { expect } from '@playwright/test'
import { uiTest } from './_setup'
import {
  dismissOverlays,
  ensureCanonicalProject,
  navigateSidebar,
  openNewDropdownItem,
} from '../../helpers/ui/bootstrap'
import { getTestServerUrls } from '../../helpers/test-servers'

uiTest.describe('Tur1 — AI Chat MCP tools [issue #180]', () => {
  uiTest.beforeEach(async ({ window }) => {
    await dismissOverlays(window)
    await ensureCanonicalProject(window)
    await navigateSidebar(window, 'apis')
  })

  uiTest(
    'the model calls an MCP tool after Allow once and answers with its result',
    async ({ window }) => {
      const { llm, mcp } = getTestServerUrls()
      await openNewDropdownItem(window, /AI Chat/i)
      await window
        .getByPlaceholder(/chat completions|Endpoint URL|https:\/\/\.\.\./i)
        .fill(`${llm}/v1/chat/completions`)

      // Tools tab: one ad-hoc Streamable HTTP server — the e2e MCP server.
      await window.getByTestId('ai-tools-toggle').click()
      await window.getByTestId('ai-tools-add-adhoc').click()
      await window.getByTestId('ai-tool-server-url').fill(mcp)

      await window.getByPlaceholder(/Ask anything/i).fill('Please echo something')
      await window.getByRole('button', { name: /^Send$|^Gönder$/i }).click()

      // Approval on by default: the call waits for the user.
      const approval = window.getByTestId('ai-tool-approval')
      await expect(approval).toBeVisible({ timeout: 20_000 })
      await expect(window.getByTestId('ai-tool-args').first()).toContainText('from-llm')
      await approval.getByTestId('ai-approve-once').click()

      // Final answer built from the real tool result.
      await expect(window.getByText(/Final answer after tool: from-llm/).first()).toBeVisible({
        timeout: 20_000,
      })
      const call = window.getByTestId('ai-tool-call').first()
      await expect(call).toHaveAttribute('data-status', 'done')
      await call.getByRole('button').first().click()
      await expect(call.getByTestId('ai-tool-result')).toHaveText('from-llm')

      // Per-message metrics: status + tokens. The 1st call reported 11+7, the
      // 2nd none → the reported sum with a "partial" marker (issue #198).
      await expect(window.getByTestId('ai-metrics-status').last()).toHaveText('200')
      await expect(window.getByTestId('ai-metrics-tokens').last()).toHaveText(/^18 /)
      await expect(window.getByTestId('ai-metrics-partial').last()).toHaveAttribute('title', /#1 /)
    },
  )

  uiTest('Deny: the tool never runs and the model gets the denial', async ({ window }) => {
    const { llm, mcp } = getTestServerUrls()
    await openNewDropdownItem(window, /AI Chat/i)
    await window
      .getByPlaceholder(/chat completions|Endpoint URL|https:\/\/\.\.\./i)
      .fill(`${llm}/v1/chat/completions`)
    await window.getByTestId('ai-tools-toggle').click()
    await window.getByTestId('ai-tools-add-adhoc').click()
    await window.getByTestId('ai-tool-server-url').fill(mcp)

    await window.getByPlaceholder(/Ask anything/i).fill('Echo please')
    await window.getByRole('button', { name: /^Send$|^Gönder$/i }).click()
    const approval = window.getByTestId('ai-tool-approval')
    await expect(approval).toBeVisible({ timeout: 20_000 })
    await approval.getByTestId('ai-approve-deny').click()

    await expect(
      window.getByText(/Final answer after tool: The user denied this tool call\./).first(),
    ).toBeVisible({
      timeout: 20_000,
    })
    await expect(window.getByTestId('ai-tool-call').first()).toHaveAttribute(
      'data-status',
      'denied',
    )
  })
})
