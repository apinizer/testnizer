/**
 * AI mock servers through the real UI (issue #221, Faz 2b) — the AI twin of
 * `mock-sse.spec.ts`.
 *
 *  1. Chat: New mock server → AI → OpenAI-compatible chat (port suggestion in
 *     the 3300 band) → the row lands in the AI sidebar section with its AI
 *     badge → the editor shows the SDK base URL → "Start & open in AI Chat
 *     tab" starts the server and opens a clean (not dirty) AI Chat tab on the
 *     Custom provider, model mock-model, the mock's chat URL and an EMPTY key
 *     field → a message gets the canned, templated reply and the metrics row
 *     reports tokens (the mock puts usage on the finish chunk).
 *  2. Errors: the same flow on the Errors preset; model error-429 shows the
 *     mock's 429 rate-limit error in the conversation.
 *
 * Every test creates its own server on a `randomMockPort()` port (the
 * per-worker 31000+ band, never the 3300 suggestion) and removes it in
 * afterEach: stop + delete through the sidebar, then Force Close All Tabs.
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

/** Servers created by the running test — removed in afterEach. */
let created: { id: string; name: string }[] = []

function aiRow(page: Page, name: string): Locator {
  return page
    .getByTestId('mock-ai-section')
    .locator('[data-testid^="mock-ai-row-"]')
    .filter({ hasText: name })
}

function activeTab(page: Page): Locator {
  return page.locator('[data-testid="endpoint-tab"][data-active="true"]')
}

async function createAiServer(
  page: Page,
  opts: { preset: 'chat' | 'errors'; name: string; port: number },
): Promise<string> {
  await navigateSidebar(page, 'mocks')
  await page.getByTestId('mock-new').click()
  const dialog = page.getByTestId('mock-new-dialog')
  await expect(dialog).toBeVisible({ timeout: 10_000 })

  await dialog.getByTestId('mock-new-type-ai').click()
  await expect(dialog.getByTestId('mock-new-type-ai')).toHaveAttribute('aria-checked', 'true')
  await dialog.getByTestId(`mock-new-preset-${opts.preset}`).click()
  await expect(dialog.getByTestId(`mock-new-preset-${opts.preset}`)).toHaveAttribute(
    'aria-checked',
    'true',
  )
  // Port suggestions for AI start at 3300 (HTTP 3001, MCP 3100, SSE 3200).
  await expect(dialog.getByTestId('mock-new-port')).toHaveValue(/^33\d{2}$/)

  await dialog.getByTestId('mock-new-name').fill(opts.name)
  await dialog.getByTestId('mock-new-port').fill(String(opts.port))
  await dialog.getByTestId('mock-new-create').click()
  await expect(dialog).toBeHidden({ timeout: 10_000 })

  const row = aiRow(page, opts.name)
  await expect(row).toHaveCount(1, { timeout: 10_000 })
  const testId = await row.getAttribute('data-testid')
  const id = testId?.replace(/^mock-ai-row-/, '') ?? ''
  expect(id).not.toBe('')
  created.push({ id, name: opts.name })
  return id
}

/** Click "Start & open in AI Chat tab"; the AI tab opens on Custom + mock-model. */
async function startAndOpenInAiChat(page: Page, name: string, port: number): Promise<void> {
  const open = page.getByTestId('mock-open-in-ai-chat')
  await expect(open).toHaveText(/Start & open in AI Chat tab/, { timeout: 10_000 })
  // Disabled until the endpoint list has loaded (it needs the chat endpoint).
  await expect(open).toBeEnabled({ timeout: 10_000 })
  await open.click()

  // The client tab is not titled like the editor tab (PM review #20).
  await expect(activeTab(page)).toHaveAttribute('data-tab-name', `${name} · client`, {
    timeout: 10_000,
  })
  await expect(page.getByText('Custom · mock-model')).toBeVisible({ timeout: 10_000 })
  await expect(page.getByPlaceholder(/chat completions endpoint/)).toHaveValue(
    `http://127.0.0.1:${port}/v1/chat/completions`,
  )
  await expect(aiRow(page, name).getByTestId('mock-ai-row-status')).toHaveText(/running/i, {
    timeout: 10_000,
  })
}

async function expectTabClean(page: Page): Promise<void> {
  await expect(activeTab(page)).toHaveAttribute('data-dirty', 'false')
  await expect(activeTab(page).getByTestId('tab-dirty')).toHaveCount(0)
  // A late markDirty (an effect after the prefill) would show up here.
  await page.waitForTimeout(1_500)
  await expect(activeTab(page)).toHaveAttribute('data-dirty', 'false')
}

async function send(page: Page, text: string): Promise<void> {
  await page.getByPlaceholder(/Ask anything/).fill(text)
  await page.getByTitle(/^Send$/).click()
}

async function ipcStopAndDelete(page: Page, id: string): Promise<void> {
  await page
    .evaluate(async (sid) => {
      const w = window as Window & {
        api?: {
          mock?: {
            server?: {
              stop: (id: string) => Promise<unknown>
              delete: (id: string) => Promise<unknown>
            }
          }
        }
      }
      await w.api?.mock?.server?.stop(sid)
      await w.api?.mock?.server?.delete(sid)
    }, id)
    .catch(() => {})
}

uiTest.describe('Tur1 — AI mock servers [issue #221]', () => {
  uiTest.beforeEach(async ({ window }) => {
    created = []
    await dismissOverlays(window)
    await ensureCanonicalProject(window)
    await closeAllTabs(window)
    await navigateSidebar(window, 'mocks')
  })

  uiTest.afterEach(async ({ window }) => {
    await navigateSidebar(window, 'mocks').catch(() => {})
    for (const s of created) {
      const row = aiRow(window, s.name)
      try {
        if (await row.getByTestId('mock-ai-stop').isVisible()) {
          await row.getByTestId('mock-ai-stop').click()
          await expect(row.getByTestId('mock-ai-start')).toBeVisible({ timeout: 10_000 })
        }
        await row.getByTestId('mock-ai-delete').click()
        await window.getByTestId('delete-confirm-btn').click()
        await expect(row).toHaveCount(0, { timeout: 10_000 })
      } catch {
        await ipcStopAndDelete(window, s.id)
      }
    }
    created = []
    await closeAllTabs(window)
  })

  uiTest(
    'Chat: create, AI badge, SDK base URL, Start & open in AI Chat tab, canned reply with usage',
    async ({ window }) => {
      const name = `Chat-${uid()}`
      const port = randomMockPort()
      await createAiServer(window, { preset: 'chat', name, port })

      // Sidebar: in the AI section with the AI badge, not in the HTTP one.
      await expect(aiRow(window, name).getByTestId('mock-ai-badge')).toHaveText('AI')
      await expect(
        window.getByTestId('mock-http-section').locator('[data-testid^="mock-http-row-"]').filter({
          hasText: name,
        }),
      ).toHaveCount(0)

      // Editor header: AI badge, SDK base URL, the stopped-state label.
      await expect(window.getByTestId('mock-kind-badge')).toHaveText('AI')
      await expect(window.getByTestId('mock-sdk-base-url')).toHaveText(
        `http://127.0.0.1:${port}/v1`,
      )
      // The LLM row of the selected chat response.
      await expect(window.getByTestId('mock-llm-options')).toBeVisible({ timeout: 10_000 })
      await expect(window.getByTestId('mock-llm-provider')).toHaveValue('openai')

      await startAndOpenInAiChat(window, name, port)
      await expectTabClean(window)
      // No saved provider key travels to the mock (§D.3.5).
      await expect(window.getByPlaceholder('sk-...')).toHaveValue('')

      await send(window, 'ping from e2e')
      await expect(
        window.getByTestId('ai-bubble-text').filter({
          hasText: 'Hello from the mock LLM. You said: ping from e2e',
        }),
      ).toHaveCount(1, { timeout: 15_000 })
      const tokens = window.getByTestId('ai-metrics-tokens').last()
      await expect(tokens).toBeVisible({ timeout: 10_000 })
      await expect(tokens).toHaveText(/^\d+ tokens$/)
    },
  )

  uiTest('Errors: model error-429 shows the mock’s rate-limit error', async ({ window }) => {
    const name = `Errors-${uid()}`
    const port = randomMockPort()
    await createAiServer(window, { preset: 'errors', name, port })
    await startAndOpenInAiChat(window, name, port)

    await window.getByPlaceholder('model-id').fill('error-429')
    await send(window, 'trigger the limit')
    // The error lands on the assistant turn of the conversation (not the
    // Settings summary, which also reads "error-429").
    const turnError = window.getByTestId('ai-turn-error').last()
    await expect(turnError).toBeVisible({ timeout: 15_000 })
    await expect(turnError).toContainText('429')
    await expect(turnError).toContainText('Rate limit reached')
    await expect(window.getByTestId('ai-metrics-status').last()).toHaveText('429')
  })
})
