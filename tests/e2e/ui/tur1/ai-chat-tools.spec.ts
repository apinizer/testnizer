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
import { expect, type Locator } from '@playwright/test'
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

  // Issue #228 — with Settings and Tools expanded the conversation used to get
  // ~25 px and the approval card's buttons were clipped to half height. The
  // body is now a config ↔ conversation split with a conversation floor, and a
  // card that waits for the user is scrolled into view inside the conversation.
  for (const size of [
    { width: 1400, height: 900 },
    { width: 1024, height: 700 },
  ]) {
    uiTest(
      `approval card fully visible and clickable with Settings + Tools expanded at ${size.width}x${size.height} [issue #228]`,
      async ({ app, window }) => {
        const { llm, mcp } = getTestServerUrls()
        // Resize the real window (setViewportSize does not resize the BrowserWindow).
        const original = await app.evaluate(({ BrowserWindow }, s) => {
          const w = BrowserWindow.getAllWindows()[0]
          const [width, height] = w.getContentSize()
          w.setContentSize(s.width, s.height)
          return { width, height }
        }, size)
        try {
          await expect
            .poll(() => window.evaluate(() => [innerWidth, innerHeight]))
            .toEqual([size.width, size.height])
          await openNewDropdownItem(window, /AI Chat/i)
          await window
            .getByPlaceholder(/chat completions|Endpoint URL|https:\/\/\.\.\./i)
            .fill(`${llm}/v1/chat/completions`)
          await window.getByTestId('ai-tools-toggle').click()
          await window.getByTestId('ai-tools-add-adhoc').click()
          await window.getByTestId('ai-tool-server-url').fill(mcp)
          // Both sections stay expanded for the whole flow — nothing is collapsed.
          await expect(window.getByTestId('ai-settings-toggle')).toHaveAttribute(
            'aria-expanded',
            'true',
          )
          await expect(window.getByTestId('ai-tools-toggle')).toHaveAttribute(
            'aria-expanded',
            'true',
          )
          await expect(window.getByTestId('ai-tools-body')).toBeVisible()

          const ask = window.getByPlaceholder(/Ask anything/i)
          await ask.fill('Please echo something')
          await ask.press('Enter')

          const approval = window.getByTestId('ai-tool-approval')
          await expect(approval).toBeVisible({ timeout: 20_000 })
          await window.waitForTimeout(300)
          // Geometry BEFORE any click: Playwright scrolls a click target into
          // view first, which would hide the bug.
          for (const id of ['ai-approve-once', 'ai-approve-conversation', 'ai-approve-deny']) {
            await expectFullyHittable(approval.getByTestId(id), id)
          }
          // The conversation keeps a usable height; the editor itself never scrolls
          // (its title row stays on screen) and the composer stays visible.
          const conversationHeight = await window
            .getByTestId('ai-conversation')
            .evaluate((el) => el.getBoundingClientRect().height)
          expect(conversationHeight).toBeGreaterThanOrEqual(150)
          expect(await window.getByTestId('ai-chat-editor').evaluate((el) => el.scrollTop)).toBe(0)
          await expect(window.getByTestId('ai-chat-editor').getByText(/^AI Chat$/)).toBeInViewport()
          await expect(ask).toBeInViewport()

          await approval.getByTestId('ai-approve-once').click()
          const reply = window.getByText(/Final answer after tool: from-llm/).first()
          await expect(reply).toBeVisible({ timeout: 20_000 })
          await window.waitForTimeout(300)
          await expectFullyHittable(reply, 'final reply')
          await expect(window.getByTestId('ai-settings-toggle')).toHaveAttribute(
            'aria-expanded',
            'true',
          )
        } finally {
          await app.evaluate(({ BrowserWindow }, s) => {
            BrowserWindow.getAllWindows()[0]?.setContentSize(s.width, s.height)
          }, original)
        }
      },
    )
  }
})

/**
 * The element lies inside the window and is the topmost hit at its centre and
 * near its top and bottom edges — i.e. not clipped by an overflow ancestor nor
 * covered by another layer.
 */
async function expectFullyHittable(target: Locator, what: string): Promise<void> {
  const r = await target.evaluate((el) => {
    const b = el.getBoundingClientRect()
    const cx = b.left + b.width / 2
    const hit = (y: number): boolean => {
      const h = document.elementFromPoint(cx, y)
      return !!h && (h === el || el.contains(h))
    }
    return {
      top: b.top,
      bottom: b.bottom,
      left: b.left,
      right: b.right,
      height: b.height,
      vw: window.innerWidth,
      vh: window.innerHeight,
      centre: hit(b.top + b.height / 2),
      nearTop: hit(b.top + 2),
      nearBottom: hit(b.bottom - 2),
    }
  })
  const where = `${what}: ${JSON.stringify(r)}`
  expect(r.height, where).toBeGreaterThan(12)
  expect(r.top, where).toBeGreaterThanOrEqual(0)
  expect(r.left, where).toBeGreaterThanOrEqual(0)
  expect(r.bottom, where).toBeLessThanOrEqual(r.vh)
  expect(r.right, where).toBeLessThanOrEqual(r.vw)
  expect(r.centre && r.nearTop && r.nearBottom, where).toBe(true)
}
