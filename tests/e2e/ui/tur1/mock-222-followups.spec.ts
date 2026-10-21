/**
 * Issue #222 items 1–3 through the real UI.
 *
 *  1. Mock MCP: on a stopped server the header button reads "Start & open in
 *     MCP tab"; a click starts the server and opens the MCP tab on its URL.
 *  2. HTTP mock Settings → "Server type": SSE → HTTP on a Ticker server warns
 *     first (its sse response is not an HTTP body type), keeps the endpoint,
 *     keeps a running server running, and moves the row to the HTTP section;
 *     HTTP → SSE on a blank server changes at once (no confirm).
 *  3. AI (Anthropic preset): "Start & open in AI Chat (Anthropic)" opens an
 *     AI Chat tab on the Anthropic provider against the mock's /v1/messages,
 *     with an empty key field and the "saved key is not sent" note, and the
 *     mock answers.
 *
 * Every test creates its own server on a `randomMockPort()` port and removes
 * it in afterEach through IPC (stop + delete), then Force Close All Tabs.
 */
import { expect, type Locator, type Page } from '@playwright/test'
import { uiTest } from './_setup'
import {
  closeAllTabs,
  dismissOverlays,
  ensureCanonicalProject,
  navigateSidebar,
} from '../../helpers/ui/bootstrap'
import { randomMockPort } from '../../helpers/ui/mock-flow'

const uid = (): string => `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`

type Kind = 'http' | 'sse' | 'ai' | 'mcp'

/** Servers created by the running test — removed in afterEach. */
let created: { id: string; kind: Kind }[] = []

function row(page: Page, section: Kind, name: string): Locator {
  return page
    .getByTestId(`mock-${section}-section`)
    .locator(`[data-testid^="mock-${section}-row-"]`)
    .filter({ hasText: name })
}

function activeTab(page: Page): Locator {
  return page.locator('[data-testid="endpoint-tab"][data-active="true"]')
}

async function createServer(
  page: Page,
  opts: { kind: Kind; preset: string; name: string; port: number },
): Promise<string> {
  await navigateSidebar(page, 'mocks')
  await page.getByTestId('mock-new').click()
  const dialog = page.getByTestId('mock-new-dialog')
  await expect(dialog).toBeVisible({ timeout: 10_000 })
  await dialog.getByTestId(`mock-new-type-${opts.kind}`).click()
  await dialog.getByTestId(`mock-new-preset-${opts.preset}`).click()
  await expect(dialog.getByTestId(`mock-new-preset-${opts.preset}`)).toHaveAttribute(
    'aria-checked',
    'true',
  )
  await dialog.getByTestId('mock-new-name').fill(opts.name)
  await dialog.getByTestId('mock-new-port').fill(String(opts.port))
  await dialog.getByTestId('mock-new-create').click()
  await expect(dialog).toBeHidden({ timeout: 10_000 })

  const r = row(page, opts.kind, opts.name)
  await expect(r).toHaveCount(1, { timeout: 10_000 })
  const testId = (await r.getAttribute('data-testid')) ?? ''
  const id = testId.replace(new RegExp(`^mock-${opts.kind}-row-`), '')
  expect(id).not.toBe('')
  created.push({ id, kind: opts.kind })
  return id
}

async function ipcStopAndDelete(page: Page, s: { id: string; kind: Kind }): Promise<void> {
  await page
    .evaluate(
      async ({ id, mcp }) => {
        type Api = {
          stop: (id: string) => Promise<unknown>
          delete: (id: string) => Promise<unknown>
        }
        const w = window as Window & {
          api?: { mock?: { server?: Api }; mockMcp?: { server?: Api } }
        }
        const api = mcp ? w.api?.mockMcp?.server : w.api?.mock?.server
        await api?.stop(id)
        await api?.delete(id)
      },
      { id: s.id, mcp: s.kind === 'mcp' },
    )
    .catch(() => {})
}

uiTest.describe('Tur1 — mock follow-ups [issue #222]', () => {
  uiTest.beforeEach(async ({ window }) => {
    created = []
    await dismissOverlays(window)
    await ensureCanonicalProject(window)
    await closeAllTabs(window)
    await navigateSidebar(window, 'mocks')
  })

  uiTest.afterEach(async ({ window }) => {
    for (const s of created) await ipcStopAndDelete(window, s)
    created = []
    await closeAllTabs(window)
    // The Mocks panel re-reads its lists on the next visit.
    await navigateSidebar(window, 'apis').catch(() => {})
  })

  uiTest(
    '1. Mock MCP: Start & open in MCP tab starts the server, then opens it',
    async ({ window }) => {
      const name = `McpOpen-${uid()}`
      const port = randomMockPort()
      await createServer(window, { kind: 'mcp', preset: 'echo', name, port })
      const editor = window.getByTestId('mock-mcp-editor')
      await expect(editor).toBeVisible({ timeout: 10_000 })

      const open = editor.getByTestId('mock-mcp-open-in-mcp')
      await expect(open).toHaveText(/Start & open in MCP tab/)
      await open.click()

      await expect(window.getByTestId('mcp-url')).toHaveValue(new RegExp(`:${port}/mcp$`), {
        timeout: 10_000,
      })
      // PM review #20: titled apart from the editor tab, and connected at once.
      await expect(activeTab(window)).toHaveAttribute('data-tab-name', `${name} · client`)
      await expect(window.getByTestId('mcp-connect')).toHaveText(/Disconnect/i, {
        timeout: 15_000,
      })
      await navigateSidebar(window, 'mocks')
      await expect(row(window, 'mcp', name).getByTestId('mock-mcp-row-status')).toHaveText(
        /running/i,
        { timeout: 10_000 },
      )

      // A second click focuses the same MCP tab — no duplicate.
      await window.locator(`[data-testid="endpoint-tab"][data-tab-name="${name}"]`).click()
      await expect(editor).toBeVisible({ timeout: 10_000 })
      await editor.getByTestId('mock-mcp-open-in-mcp').click()
      await expect(activeTab(window)).toHaveAttribute('data-tab-name', `${name} · client`, {
        timeout: 10_000,
      })
      await expect(
        window.locator(`[data-testid="endpoint-tab"][data-tab-name="${name} · client"]`),
      ).toHaveCount(1)
      await window.getByTestId('mcp-connect').click()
    },
  )

  uiTest(
    '2. Server type: SSE → HTTP confirms, keeps endpoint + running state, moves the row',
    async ({ window }) => {
      const name = `TypeSwap-${uid()}`
      const port = randomMockPort()
      await createServer(window, { kind: 'sse', preset: 'ticker', name, port })
      await expect(window.getByTestId('mock-kind-badge')).toHaveText('SSE', { timeout: 10_000 })

      // Running before the change; it must stay running (no restart needed).
      await window.getByTestId('mock-start').click()
      await expect(row(window, 'sse', name).getByTestId('mock-sse-row-status')).toHaveText(
        /running/i,
        { timeout: 10_000 },
      )

      await window.getByTestId('mock-tab-settings').click()
      await expect(window.getByTestId('mock-settings-type-sse')).toHaveAttribute(
        'aria-checked',
        'true',
      )
      await window.getByTestId('mock-settings-type-http').click()
      const confirm = window.getByTestId('mock-settings-type-confirm')
      await expect(confirm).toBeVisible({ timeout: 10_000 })
      // PM review #21: a real singular and the body type's label.
      await expect(confirm).toContainText('1 response uses')
      await expect(confirm).toContainText('(SSE stream)')
      await expect(confirm).toContainText('Nothing is deleted')
      await window.getByTestId('mock-settings-type-confirm-ok').click()
      await expect(confirm).toBeHidden()

      await expect(window.getByTestId('mock-settings-type-http')).toHaveAttribute(
        'aria-checked',
        'true',
        { timeout: 10_000 },
      )
      await expect(window.getByTestId('mock-kind-badge')).toHaveText('HTTP')
      await expect(row(window, 'http', name)).toHaveCount(1, { timeout: 10_000 })
      await expect(row(window, 'sse', name)).toHaveCount(0)
      await expect(row(window, 'http', name).getByTestId('mock-http-row-status')).toHaveText(
        /running/i,
      )

      // The endpoint is still there.
      await window.getByTestId('mock-tab-endpoints').click()
      await expect(window.getByText('/events').first()).toBeVisible({ timeout: 10_000 })
    },
  )

  uiTest('2b. Server type: HTTP → SSE on a blank server changes at once', async ({ window }) => {
    const name = `TypeBlank-${uid()}`
    const port = randomMockPort()
    await createServer(window, { kind: 'http', preset: 'blank', name, port })
    await window.getByTestId('mock-tab-settings').click()
    await window.getByTestId('mock-settings-type-sse').click()
    await expect(window.getByTestId('mock-settings-type-sse')).toHaveAttribute(
      'aria-checked',
      'true',
      { timeout: 10_000 },
    )
    await expect(window.getByTestId('mock-settings-type-confirm')).toHaveCount(0)
    await expect(row(window, 'sse', name)).toHaveCount(1, { timeout: 10_000 })
  })

  uiTest(
    '3. AI Anthropic: Start & open in AI Chat (Anthropic) — no saved key, mock answers',
    async ({ window }) => {
      const name = `Anthropic-${uid()}`
      const port = randomMockPort()
      await createServer(window, { kind: 'ai', preset: 'anthropic', name, port })

      // Anthropic-only server: no disabled OpenAI button, the Anthropic one instead.
      await expect(window.getByTestId('mock-open-in-ai-chat')).toHaveCount(0)
      const open = window.getByTestId('mock-open-in-ai-chat-anthropic')
      await expect(open).toHaveText(/Start & open in AI Chat \(Anthropic\)/, { timeout: 10_000 })
      await open.click()

      await expect(activeTab(window)).toHaveAttribute('data-tab-name', `${name} · client`, {
        timeout: 10_000,
      })
      await expect(window.getByText('Anthropic · mock-model')).toBeVisible({ timeout: 10_000 })
      await expect(window.getByPlaceholder(/chat completions endpoint/)).toHaveValue(
        `http://127.0.0.1:${port}/v1/messages`,
      )
      await expect(window.getByPlaceholder('sk-...')).toHaveValue('')
      await expect(window.getByTestId('ai-saved-key-disabled-note')).toBeVisible()

      await window.getByPlaceholder(/Ask anything/).fill('ping anthropic')
      await window.getByTitle(/^Send$/).click()
      // The Anthropic event stream is read by the Anthropic provider (the Custom
      // provider would show an empty answer).
      await expect(
        window.getByTestId('ai-bubble-text').filter({
          hasText: 'Hello from the mock LLM. You said: ping anthropic',
        }),
      ).toHaveCount(1, { timeout: 15_000 })
      await expect(window.getByTestId('ai-turn-error')).toHaveCount(0)
    },
  )
})
